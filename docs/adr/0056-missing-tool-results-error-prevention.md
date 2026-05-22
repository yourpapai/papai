<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0056: Missing Tool Results Error Prevention

## Status

Accepted

## Date

2025-04-13

## Context

The Vercel AI SDK throws `AI_MissingToolResultsError` when conversation history contains `tool-call` messages without corresponding `tool-result` messages. This can occur when:

1. A tool's `execute()` function throws an unhandled exception
2. The application crashes or restarts between tool call and result persistence
3. Race conditions with parallel tool executions
4. Duplicate `toolCallId` values from some LLM providers

Once this error occurs, the conversation enters an invalid state and all subsequent `generateText()` calls fail, making the bot unresponsive until the conversation is cleared. There was no recovery path — the entire conversation had to be discarded.

## Decision Drivers

- **Resilience:** A single failed tool call should never permanently break a conversation
- **Non-breaking recovery:** Synthetic results must allow the conversation to continue normally
- **Observability:** Both prevention and recovery layers need structured logging
- **Minimal API surface:** The fix should not require changes to individual tool implementations
- **Structured errors:** Consistent error format enables the LLM to understand and react to failures

## Considered Options

### Option 1: Two-layer defense (tool wrapping + pre-flight validation)

Wrap every tool `execute()` in try/catch to return structured errors (Layer 1), and validate conversation history before each LLM call to inject synthetic results for any missing tool results (Layer 2).

- **Pros:** Defense in depth — Layer 1 prevents most issues, Layer 2 catches edge cases (crash recovery, corruption); non-breaking recovery
- **Cons:** Two new modules, slightly increased per-call overhead for validation scan

### Option 2: Tool wrapping only

Wrap tool `execute()` functions but skip pre-flight validation.

- **Pros:** Simpler implementation, fewer files
- **Cons:** Cannot recover from crash-induced or corruption-induced missing results; conversations still break in those scenarios

### Option 3: Retry failed tool executions

Automatically retry tool calls that throw exceptions.

- **Pros:** Transparent recovery for transient failures
- **Cons:** Retrying side-effectful operations (create task, send message) is unsafe; increases latency; does not address crash/corruption scenarios

### Option 4: Conversation reset on error

Detect `AI_MissingToolResultsError` and clear the conversation history.

- **Pros:** Simple, guaranteed recovery
- **Cons:** Users lose all conversation context; poor user experience; does not prevent the error, only reacts to it

## Decision

Implement the two-layer defense (Option 1).

### Layer 1: Tool Execution Wrapping

File: `src/tools/wrap-tool-execution.ts`

Every tool's `execute` function is wrapped via `wrapToolSet()` in `src/tools/index.ts`. The wrapper:

- Catches all thrown exceptions (Error and non-Error)
- Delegates to `buildToolFailureResult()` from `src/tool-failure.ts` for structured error classification
- Returns a `ToolFailureResult` with `success: false`, error classification, user/agent messages, and retryability
- Logs at error level with tool name, call ID, and error details

### Layer 2: Pre-flight Validation

File: `src/llm-orchestrator-validation.ts`

Before each `generateText()` call in the orchestrator:

1. Scan messages for `tool-call` parts, collect their `toolCallId` values
2. Scan for matching `tool-result` parts
3. For any tool call without a matching result, inject a synthetic `tool-result` message via `createInterruptedToolFailureResult()`
4. Log at warn level with count and IDs of missing results

### Files Changed

| File                                 | Change                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| `src/tools/wrap-tool-execution.ts`   | New — tool execution wrapper helper                            |
| `src/tool-failure.ts`                | New — structured error result types and builders               |
| `src/tools/index.ts`                 | `wrapToolSet()` iterates tools and wraps each `execute`        |
| `src/llm-orchestrator-validation.ts` | New — `validateToolResults()` pre-flight check                 |
| `src/llm-orchestrator.ts`            | Import and call `validateToolResults()` before `invokeModel()` |

## Consequences

### Positive

- Tool execution failures never throw past the wrapper — no `AI_MissingToolResultsError` from failed tools
- Crash or corruption recovery via synthetic result injection — conversations self-heal
- Structured `ToolFailureResult` gives the LLM actionable error context (retryable, userMessage, agentMessage)
- Error classification integrates with the existing `AppError` system
- No changes to individual tool implementations — wrapping is centralized

### Negative

- Slight overhead from message validation scan on every LLM call (linear in message count)
- Synthetic results mean the LLM sees "interrupted" errors that never actually ran — could confuse reasoning in rare cases
- Tool failures are now silent at the call site (return value instead of throw) — callers must check `success` field

## Implementation Status

**Implemented.** Verified in the codebase:

- `wrapToolExecution()` in `src/tools/wrap-tool-execution.ts` wraps execute functions with try/catch, delegates to `buildToolFailureResult()`
- `ToolFailureResult` interface in `src/tool-failure.ts` with `success`, `error`, `errorType`, `errorCode`, `userMessage`, `agentMessage`, `retryable`, `recovered`
- `buildToolFailureResult()` classifies errors via `extractAppError()`, falls back to `tool-execution`/`unknown` for unclassified errors
- `createInterruptedToolFailureResult()` produces synthetic results with `recovered: true` for Layer 2
- `isToolFailureResult()` type guard available for consumers
- `wrapToolSet()` in `src/tools/index.ts` wraps all tool execute functions via `wrapToolExecution()`
- `validateToolResults()` in `src/llm-orchestrator-validation.ts` scans messages and injects synthetic results for missing tool-result pairs
- Orchestrator calls `validateToolResults()` before `invokeModel()`

Divergence from original plan: The error result format is richer than planned — it includes `errorType`, `errorCode`, `userMessage`, `agentMessage`, `retryable`, and `details` fields (via `AppError` integration) rather than just `error`/`toolName`/`toolCallId`/`timestamp`. Synthetic results use Vercel AI SDK's `ToolResultPart` with `{ type: 'json', value }` output wrapping.

## Related Decisions

- [ADR-0020: Error Classification Improvements](0020-error-classification-improvements.md) — `AppError` system that `buildToolFailureResult()` integrates with
- [ADR-0007: Layered Architecture Enforcement](0007-layered-architecture-enforcement.md) — validation layer sits between history and LLM call
