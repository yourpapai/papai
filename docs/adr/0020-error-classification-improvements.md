<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0020: Error Classification Improvements (Phase 01)

## Status

Accepted

## Date

2026-03-20

## Context

Prior to this change, the error handling pipeline had six confirmed gaps that caused silent failures, unhelpful user-facing messages, and blind operational logging:

1. **Hardcoded entity IDs in 404 responses.** Both `classifyKaneoError` and `classifyYouTrackError` produced `ProviderError` objects with `taskId: 'unknown'`, `projectId: 'unknown'`, etc., on HTTP 404 responses, because neither function received the entity ID that the calling operation already held. Users saw messages like `Task "unknown" was not found.` instead of the actual ID.

2. **Untyped status validation errors.** `validateStatus()` in `src/providers/kaneo/task-status.ts` threw a plain `new Error(...)` when a status name did not match any project column. Plain `Error` instances bypass `isAppError()` and fall through `handleMessageError` to the generic fallback message, losing the list of available statuses entirely.

3. **Network failures misclassified as unexpected errors.** A `TypeError: fetch failed` or `ECONNREFUSED` from a native `fetch()` call was caught as `systemError.unexpected`, producing "An unexpected error occurred." Users received no indication that the task tracker itself was unreachable.

4. **Non-user-friendly message for malformed API responses.** `KaneoValidationError` (Zod schema mismatch on an API response) was classified as `providerError.validationFailed('response', …)`, whose message exposed internal field paths from the Zod error.

5. **No structured error logging with `userId`.** `handleMessageError` in `llm-orchestrator.ts` accepted a `_userId` parameter (unused — underscore-prefixed, indicating intentional suppression) and wrote no log entry on error, making it impossible to correlate failures with a specific user in production logs.

6. **`KaneoClassifiedError` not handled in orchestrator.** `handleMessageError` checked `isAppError(error)` first, then fell to the generic fallback. `KaneoClassifiedError` is an `Error` subclass carrying an `appError: AppError` payload — not itself an `AppError` — so it always hit the generic path, discarding the structured error and the friendly user message.

These gaps collectively meant that tool errors either surfaced no user-visible reply, or surfaced a generic reply that gave users no actionable information.

## Decision Drivers

- Users must receive actionable feedback for every bot interaction; the bot must never silently swallow errors.
- An unrecognised status name reply must include the list of valid options.
- A network-level failure reply must explicitly say the tracker is unavailable and suggest retrying.
- A malformed API response must not crash the bot and must produce a coherent reply.
- Every error log entry must contain `userId` (where available), the affected operation, and the error reason — no sensitive data.
- No new libraries should be added; all required functionality is available in existing packages.

## Considered Options

### Option 1: Single generic error type for all failures

Collapse all error variants into a single `{ message: string }` shape and map to a generic user message.

- **Pros**: Minimal code change.
- **Cons**: Loses structured context (entity ID, status list, error code) that the user and operator need. Does not fix silent failures. Cannot produce status-specific messages.

### Option 2: Discriminated union extensions with context propagation (chosen)

Extend the existing `ProviderError` discriminated union with two new codes (`status-not-found`, `invalid-response`), add an optional `context` parameter to both `classifyKaneoError` and `classifyYouTrackError`, detect network errors before the final fallback, and add `KaneoClassifiedError` / `YouTrackClassifiedError` / `ProviderClassifiedError` handling to `handleMessageError`.

- **Pros**: Each failure mode produces a distinct, testable error code. No new libraries. Preserves the existing `AppError` → `getUserMessage` pipeline. Structured logging adds `userId` without changing the logging infrastructure.
- **Cons**: Requires updating callers of `classifyKaneoError` to pass context. Adding new `ProviderError` codes requires exhaustive-switch updates in `getUserMessage`.

### Option 3: Retry and circuit-breaker patterns for network errors

Wrap all provider calls in retry logic; surface network errors only after exhausting retries.

- **Pros**: Reduces noise from transient failures.
- **Cons**: Disproportionate complexity for Phase 01; retry semantics belong in a later phase. Does not fix the other five gaps.

## Decision

Six targeted improvements were implemented:

1. **Entity ID propagation** — Added optional `context?: { taskId?: string; projectId?: string; commentId?: string; labelName?: string }` parameter to `classifyKaneoError` and `classifyYouTrackError`. Each 404 branch uses `context?.taskId ?? 'unknown'` etc. Provider operations (`getTask`, `updateTask`, `archiveTask`, `deleteTask`, etc.) pass the known entity ID when calling the classifier.

2. **Typed status-not-found error** — Added `| { type: 'provider'; code: 'status-not-found'; statusName: string; available: string[] }` to the `ProviderError` union and the `providerError.statusNotFound(statusName, available)` constructor in `src/providers/errors.ts`. `validateStatus()` now throws a `KaneoClassifiedError` carrying this code instead of a plain `Error`, with the available status list embedded in the payload. The user message is: `Status "${statusName}" is not recognised. Available statuses: ${available.join(', ')}.`

3. **Network error detection** — Both `classifyKaneoError` and `classifyYouTrackError` detect `TypeError` and `Error` instances whose message contains `fetch`, `network`, `econnrefused`, `enotfound`, or `connect` before reaching the final `systemError.unexpected` fallback, and classify them as `systemError.networkError(message)` instead.

4. **User-friendly response for malformed API responses** — Added `| { type: 'provider'; code: 'invalid-response' }` to the `ProviderError` union and `providerError.invalidResponse()` constructor. `classifyKaneoError` now uses `providerError.invalidResponse()` when classifying a `KaneoValidationError`, replacing `providerError.validationFailed('response', …)`. The user message is: `"The task tracker returned an unexpected response. Please try again."`

5. **Structured error logging with `userId`** — `handleMessageError` signature changed from `(reply, _userId, error)` to `(reply, contextId, error)`. A `log.error({ contextId, error: … }, 'Message handling failed')` entry is written before every reply, including the structured error payload when available.

6. **`KaneoClassifiedError` (and `YouTrackClassifiedError`, `ProviderClassifiedError`) handling in orchestrator** — `handleMessageError` was extended with `else if (error instanceof KaneoClassifiedError)`, `else if (error instanceof YouTrackClassifiedError)`, and `else if (error instanceof ProviderClassifiedError)` branches, each calling `getUserMessage(error.appError)` or `getUserMessage(error.error)` before falling to the generic message.

## Rationale

The discriminated union approach keeps the error type system as the single source of truth for both user messages (`getUserMessage`) and structured logging. Adding new codes to `ProviderError` forces exhaustive-switch updates in `getUserMessage`, making it impossible to silently skip a new error type. Context propagation to the classifier requires no new abstractions — the calling operation already holds the entity ID and simply passes it through. Network error detection by message content is the standard approach for fetch API failures because the browser and Bun fetch APIs do not expose a distinct error subtype for network-level failures.

## Consequences

### Positive

- Every 404 error from Kaneo and YouTrack operations includes the actual entity ID in the user-facing message.
- Invalid status name errors include the full list of valid statuses, enabling the user to self-correct without a follow-up query.
- Network-level failures produce a "tracker unavailable" message instead of a generic error, improving user trust.
- Malformed API responses produce a neutral "unexpected response" message that does not expose internal schema paths.
- Every `handleMessageError` invocation writes a structured pino log entry with `contextId` and error detail, enabling log-based incident diagnosis.
- `KaneoClassifiedError`, `YouTrackClassifiedError`, and `ProviderClassifiedError` are all handled in the orchestrator; no error escapes to the generic fallback solely because of its wrapper type.

### Negative

- All callers of `classifyKaneoError` and `classifyYouTrackError` must be updated to pass the `context` parameter, creating a coordination cost when adding new provider operations.
- Adding new `ProviderError` codes requires updating `getUserMessage` and `getProviderMessage`; failing to do so causes a TypeScript exhaustive-switch error, which is intentional but adds overhead per new code.
- `llm-orchestrator.ts` now imports both `KaneoClassifiedError` and `YouTrackClassifiedError`, retaining provider-specific knowledge at the orchestration layer. This is an accepted interim trade-off pending a fully provider-agnostic classified error abstraction.

## Implementation Status

**Status**: Implemented

Evidence:

### Story 1 — Entity ID propagation

- `src/providers/kaneo/classify-error.ts` exports `ClassificationContext` interface and `classifyKaneoError(error, context?)`. Each 404 branch uses `context?.taskId ?? 'unknown'`, `context?.projectId ?? 'unknown'`, `context?.labelName ?? 'unknown'`, `context?.commentId ?? 'unknown'`.
- `src/providers/youtrack/classify-error.ts` exports the same `ClassificationContext` pattern and `classifyYouTrackError(error, context?)`.
- Test file `tests/providers/kaneo/classify-error.test.ts` exists.

### Story 2 — Typed status-not-found error

- `src/providers/errors.ts` contains `| { type: 'provider'; code: 'status-not-found'; statusName: string; available: string[] }` in `ProviderError` and `providerError.statusNotFound(statusName, available)` constructor. `getProviderMessage` handles `'status-not-found'` with a message listing available options.
- `src/providers/errors.ts` contains `| { type: 'provider'; code: 'invalid-response' }` and `providerError.invalidResponse()` constructor.
- `src/providers/kaneo/task-status.ts` throws `new KaneoClassifiedError(…, providerError.statusNotFound(status, available))` in the no-match path.
- Test file `tests/providers/kaneo/task-status.test.ts` exists.

### Story 3 — Network error detection

- `src/providers/kaneo/classify-error.ts` detects `fetch`, `network`, `econnrefused`, `enotfound`, `connect` in `Error.message` before the final fallback and returns `systemError.networkError(error.message)`.
- `src/providers/youtrack/classify-error.ts` mirrors the same detection in `classifyGenericError`.

### Story 4 — User-friendly invalid-response message

- `src/providers/kaneo/classify-error.ts` classifies `KaneoValidationError` as `providerError.invalidResponse()`.
- `src/providers/errors.ts` `getProviderMessage('invalid-response')` returns `"The task tracker returned an unexpected response. Please try again."`.

### Story 5 — Structured diagnostic logging

- `src/llm-orchestrator.ts` `handleMessageError` signature uses `contextId` (not `_userId`). First statement is `log.error({ contextId, error: isAppError(error) ? error : error instanceof Error ? error.message : String(error) }, 'Message handling failed')`.

### Story 6 — KaneoClassifiedError handling

- `src/llm-orchestrator.ts` imports `KaneoClassifiedError`, `YouTrackClassifiedError`, and `ProviderClassifiedError`. `handleMessageError` has `else if (error instanceof KaneoClassifiedError)`, `else if (error instanceof YouTrackClassifiedError)`, and `else if (error instanceof ProviderClassifiedError)` branches before the generic fallback.

### Divergences from plan

- The plan's Story 6 (Task 6.2) named the parameter `_userId` with a note to remove the underscore prefix. In the implementation the parameter is named `contextId` (not `userId`), reflecting the broader architectural convention of the orchestrator working with conversation context IDs rather than raw user IDs.
- The plan did not anticipate `YouTrackClassifiedError` handling; the implementation adds it alongside `KaneoClassifiedError` for symmetry with the YouTrack provider.
- The planned test file `tests/providers/youtrack/classify-error.test.ts` is not confirmed present; only the Kaneo test files were verified.

## Related Decisions

- [ADR-0007: Layered Architecture Enforcement](0007-layered-architecture-enforcement.md) — established `handleMessageError` in `llm-orchestrator.ts` as the single orchestration-layer error handler.
- [ADR-0009: Multi-Provider Task Tracker Support](0009-multi-provider-task-tracker-support.md) — defined the `ProviderError` discriminated union and the `AppError` → `getUserMessage` pipeline that this ADR extends.

## Related Plans

- `/docs/plans/done/2026-03-20-phase-01-code-quality-reliability.md`
