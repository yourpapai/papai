<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0223: `/turns/:id` Scope Enforcement

## Status

Implemented

## Date

2026-06-28

## Context

The debug privacy contract (ADR-0197) is: the operator sees only events for his own
context plus genuinely context-free system events. The SSE event path enforces this in
`onEvent` (`src/debug/state-collector.ts`) by dropping every event that fails
`isVisibleToAdmin(scope, adminVisibility)`.

The REST route `GET /turns/:id` (`handleTurnLookup`, `src/debug/server.ts`) bypassed that
filter: it returned `findTurnById(turnId)` for any turn in the global `recentTurns` /
`inFlightTurns` buffers, regardless of scope. A returned `Turn` carries cross-tenant
`scope` identity (`userId`/`groupId`/`threadId`) and free-text `error` /
`toolCalls[].failureReason` — the same free-text fields `redactLogEntry` drops elsewhere.
Turn IDs for foreign scopes are harvestable by the same operator because `/logs` preserves
`turnId` through redaction. The route requires an authenticated operator session, so the
exposure is bounded to a trusted principal and excludes message bodies/tool args/results;
severity is medium, but it is a genuine breach of the stated invariant.

## Decision

Add `isScopeVisibleToCurrentAdmin(scope)` to `state-collector.ts`, a thin wrapper that
forwards the process-current `adminVisibility` to the canonical `isVisibleToAdmin`.
`handleTurnLookup` calls it before returning a turn and returns `404` (not `403`, to avoid
confirming existence) when the turn is absent or not visible. The two egress points now
enforce the same contract.

We intentionally do **not** redact the free-text `error`/`failureReason` for _owned_ turns:
the operator is authorized to see their own context, so the scope check alone closes the
leak. Scope-filtering `/logs` is tracked separately (logs are already redacted; only the
`turnId` is exposed).

## Consequences

### Positive

- `GET /turns/:id` no longer exposes cross-tenant turn identity or free-text errors.
- REST and SSE egress now share one visibility rule via one wrapper (no logic duplication).

### Negative / Risks

- A turn whose `scope` is malformed/absent resolves to not-visible and returns `404`. This
  is the safe direction (default-deny) but can read as a spurious miss for a malformed turn.

## Related Decisions

- ADR-0197: Debug Observability Fixes (the `isVisibleToAdmin` invariant and egress redaction).
