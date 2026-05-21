<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Missing Tool Results Error Prevention Design

## Summary

Implement a two-layer defense system to prevent `AI_MissingToolResultsError` from breaking the bot when tool calls fail or conversation history becomes corrupted.

## Problem

The Vercel AI SDK throws `AI_MissingToolResultsError` when conversation history contains `tool-call` messages without corresponding `tool-result` messages. This can occur when:

1. A tool's `execute()` function throws an unhandled exception
2. The application crashes/restarts between tool call and result persistence
3. Race conditions with parallel tool executions
4. Duplicate `toolCallId` values from some LLM providers (Azure OpenAI)

Once this error occurs, the conversation enters an invalid state and all subsequent `generateText()` calls fail, making the bot unresponsive until the conversation is cleared.

## Solution Overview

Two-layer defense combining **Tool-Level Error Wrapping** (prevention) and **Pre-flight Validation** (recovery).

## Layer 1: Tool-Level Error Wrapping

### Purpose

Ensure tool `execute()` functions never throw unhandled exceptions by wrapping them in a standardized error handler.

### Implementation Location

`src/tools/index.ts` - Wrap tool creation to automatically apply error handling.

### Behavior

- Wrap every tool's `execute` function in try/catch
- On any exception, return a structured error result instead of throwing
- Preserve the original error message in the result
- Log the error for monitoring/debugging

### Error Result Format

```typescript
{
  success: false,
  error: string,           // Original error message
  toolName: string,        // Tool identifier
  toolCallId: string,      // Call identifier from options
  timestamp: string        // ISO timestamp
}
```

## Layer 2: Pre-flight Validation

### Purpose

Before calling `generateText()`, validate that all tool calls have matching results and inject synthetic error results for any missing matches.

### Implementation Location

`src/llm-orchestrator.ts` - Add validation before `invokeModel()` calls.

### Behavior

1. Scan the `messages` array for `tool-call` content parts
2. Build a set of `toolCallId` values that have been called
3. Scan for `tool-result` parts and mark which calls have results
4. For any `tool-call` without a matching `tool-result`:
   - Inject a synthetic `tool-result` message at the appropriate position
   - Include error information indicating recovery
   - Log the detection for monitoring

### Synthetic Result Format

```typescript
{
  role: 'tool',
  content: [{
    type: 'tool-result',
    toolCallId: 'call-xxx',
    toolName: 'create_task',
    result: {
      error: 'Tool execution incomplete or interrupted',
      recovered: true,
      originalTimestamp?: string
    }
  }]
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Tool-Level Error Wrapping (src/tools/index.ts)   │
│  ─────────────────────────────────────────────────────────  │
│  Every tool.execute() wrapped in try/catch                  │
│  Returns structured error object on failure                 │
│  No unhandled exceptions → no missing results              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Pre-flight Validation (src/llm-orchestrator.ts)  │
│  ─────────────────────────────────────────────────────────  │
│  Before generateText():                                     │
│    1. Scan history for tool-call parts                      │
│    2. Check for matching tool-result parts                  │
│    3. Inject synthetic error results for missing matches    │
│    4. Log detection for monitoring                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   generateText()    │
                    │    (safe to call)   │
                    └─────────────────────┘
```

## Key Design Decisions

1. **Dual Layer Defense**: Tool wrapping prevents most issues; pre-flight catches edge cases
2. **Non-Breaking Recovery**: Synthetic results allow conversation to continue normally
3. **Structured Errors**: Consistent error format enables better debugging and monitoring
4. **Preservation of Information**: Original error messages are included in synthetic results
5. **Logging at Both Layers**: Enables identification of patterns and problematic tools

## Success Criteria

- [ ] No `AI_MissingToolResultsError` thrown during normal operation
- [ ] Failed tool executions return structured error results instead of throwing
- [ ] Pre-flight validation detects and repairs any incomplete tool call states
- [ ] Both layers log appropriately for monitoring
- [ ] Existing tests continue to pass
- [ ] New tests cover error wrapping and pre-flight validation

## Out of Scope

- Handling duplicate `toolCallId` from providers (separate middleware concern)
- Retrying failed tool executions (keep it simple: fail fast with error result)
- Modifying conversation persistence logic (work with existing history format)

## References

- [Vercel AI SDK Troubleshooting: Missing Tool Results Error](https://sdk.vercel.ai/docs/troubleshooting/missing-tool-results-error)
- [GitHub Issue #4584: ToolInvocation must have a result](https://github.com/vercel/ai/issues/4584)
- Vercel AI SDK v6.0.154 (current version in project)
