<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0007: Layered Architecture Enforcement

## Status

Accepted

## Date

2026-03-13

## Context

An architectural audit of 130+ source files revealed four violations of the project's intended layered architecture (presentation → orchestration → application/domain → infrastructure):

1. `bot.ts` contained 14+ private orchestration functions alongside Grammy wiring, making the presentation layer own orchestration and infrastructure logic.
2. `memory.ts` imported `@ai-sdk/openai-compatible` and called `createOpenAICompatible` directly, meaning the application/persistence layer owned AI SDK infrastructure construction.
3. Provider-specific Zod schemas lived at the project root (`schemas/kaneo/`, `schemas/youtrack/`), imported via fragile `../../../schemas/` paths from 27+ provider files, leaking implementation details outside provider module boundaries.
4. Both `commands/admin.ts` and `bot.ts` imported `providers/kaneo/provision.js` directly, giving the presentation layer a hard dependency on a specific provider.

All four issues were purely organizational — no behavior changes were needed, only structural corrections.

## Decision Drivers

- The LLM orchestration pipeline was untestable without a live Telegram bot connection.
- `memory.ts` should not need to know about LLM API credentials or SDK clients.
- Schema paths were brittle and would break on directory refactors.
- Presentation-layer code with provider-specific imports would make adding new providers harder and risked coupling Telegram-specific logic to Kaneo internals.

## Considered Options

### Option 1: No change / incremental cleanup

- **Pros**: Zero immediate risk.
- **Cons**: Violations compound over time; testing orchestration logic requires a bot instance.

### Option 2: Enforce layer boundaries via targeted refactors (chosen)

- **Pros**: Each violation can be fixed in isolation; improves testability; eliminates fragile import paths.
- **Cons**: Requires coordinated changes across multiple files; risk of regression.

### Option 3: Full rewrite to a hexagonal/ports-and-adapters architecture

- **Pros**: Would enforce strict boundaries via interfaces at every layer.
- **Cons**: Disproportionate effort for the current codebase size; introduces unnecessary abstraction.

## Decision

Four targeted refactors were applied:

1. **Extract `src/llm-orchestrator.ts`**: All non-Grammy logic was moved out of `bot.ts` — `processMessage`, `callLlm`, `maybeProvisionKaneo`, `buildProvider`, `getOrCreateTools`, `sendLlmResponse`, `persistFactsFromResults`, `withTypingIndicator`, `handleMessageError`, `buildOpenAI`, `checkRequiredConfig`, `buildSystemPrompt`, and the base system prompt constant. `bot.ts` became a thin wiring layer: bot instance, `checkAuthorization`, command registration, and the `message:text` handler.

2. **Decouple `memory.ts` from AI SDK**: `trimWithMemoryModel` was changed to accept a pre-built `LanguageModel` instance instead of a `ModelConfig` object. The `createOpenAICompatible` import, the `ModelConfig` type, and the private `buildMemoryModel` function were removed from `memory.ts`. Model construction was moved to `conversation.ts`, which already reads LLM config credentials.

3. **Relocate schemas into provider directories**: `schemas/kaneo/` (13 files) moved to `src/providers/kaneo/schemas/` and `schemas/youtrack/` (11 files) moved to `src/providers/youtrack/schemas/`. Import paths across all provider files were updated. The root-level `schemas/` directory was deleted.

4. **Extract `provisionAndConfigure` from `provision.ts`**: A higher-level `provisionAndConfigure(userId, username)` function was added to `src/providers/kaneo/provision.ts`, encapsulating both the API call and the post-provisioning side effects (`setConfig`, `setKaneoWorkspace`, `clearCachedTools`). Presentation-layer callers (`llm-orchestrator.ts`, `commands/admin.ts`) now call this single function without needing to know Kaneo-specific setup steps.

## Rationale

Each fix aligns with a clear architectural principle. Extracting the orchestration module enables unit testing without a Telegram bot. Passing a pre-built model into `trimWithMemoryModel` separates concerns correctly: `conversation.ts` is already the right layer to build models since it reads config. Moving schemas inside provider directories makes module boundaries enforceable by import path conventions. Encapsulating provisioning side effects removes provider-specific knowledge from the presentation layer.

## Consequences

### Positive

- LLM orchestration logic is independently testable via `tests/llm-orchestrator.test.ts`.
- `bot.ts` is now a thin adapter that any platform (Telegram, Mattermost) can replicate without copying orchestration logic.
- `memory.ts` has no dependency on `@ai-sdk/openai-compatible`, reducing its coupling surface.
- Schema files live next to the code that uses them, consistent with the documented architecture in CLAUDE.md.
- Adding a new task provider does not require touching presentation-layer code.

### Negative

- `llm-orchestrator.ts` still imports `providers/kaneo/provision.js` directly (Kaneo-specific), meaning the orchestration layer retains provider awareness. This is an accepted interim trade-off until a fully provider-agnostic provisioning abstraction is designed.
- More files means more import paths to maintain.

## Implementation Status

**Status**: Implemented

Evidence:

- `src/llm-orchestrator.ts` exists and exports `processMessage`. It contains `callLlm`, `buildProvider`, `getOrCreateTools`, `maybeProvisionKaneo`, `handleMessageError`, `persistFactsFromResults`, `sendLlmResponse`, `buildSystemPrompt`, `buildOpenAI`, and `checkRequiredConfig`.
- `src/bot.ts` imports only `processMessage` from `./llm-orchestrator.js` and is reduced to authorization and command wiring.
- `src/memory.ts` imports `type LanguageModel` from `ai` (not `@ai-sdk/openai-compatible`) and `trimWithMemoryModel` accepts `model: LanguageModel`.
- `src/conversation.ts` imports `createOpenAICompatible` and defines `buildModel`, passing the result to `trimWithMemoryModel`.
- `src/providers/kaneo/schemas/` contains 13 schema files; `src/providers/youtrack/schemas/` contains 8 schema files. No root-level `schemas/` directory exists.
- `src/providers/kaneo/provision.ts` exports `provisionAndConfigure`. `src/llm-orchestrator.ts` imports and calls it.

## Related Plans

- `/docs/plans/done/2026-03-13-layered-architecture-refactoring.md`
