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

The REST route `GET /turns/:id` (`handleTurnLookup`, `src/debug/server.ts`) returned
`findTurnById(turnId)` for any turn in the `recentTurns` / `inFlightTurns` buffers with
**no scope check of its own**, unlike the SSE path. A returned `Turn` carries `scope`
identity (`userId`/`groupId`/`threadId`) and free-text `error` / `toolCalls[].failureReason`
— the same free-text fields `redactLogEntry` drops elsewhere.

**Severity: low — a missing defense-in-depth check, not an active leak.** The buffers the
route reads from are populated **only** via `handleTurnAssembly`, which `onEvent`
(`state-collector.ts`) calls _after_ its `isVisibleToAdmin` gate — so foreign-scope turns
never enter `recentTurns` / `inFlightTurns` in the first place. In the current code
`/turns/:id` therefore could not actually return a turn outside the admin's own contexts;
the buffer holds only visible turns by construction. The defect is that the REST egress
relied on an invariant maintained by a different module instead of enforcing visibility
itself — fragile if any future code path populates those buffers without going through the
gated `onEvent`.

## Decision

Add `isScopeVisibleToCurrentAdmin(scope)` to `state-collector.ts`, a thin wrapper that
forwards the process-current `adminVisibility` to the canonical `isVisibleToAdmin`.
`handleTurnLookup` calls it before returning a turn and returns `404` (not `403`, to avoid
confirming existence) when the turn is absent or not visible. The two egress points now
enforce the same contract.

We intentionally do **not** redact the free-text `error`/`failureReason` for _owned_ turns:
the operator is authorized to see their own context, so the scope check alone is sufficient.

## Consequences

### Positive

- `GET /turns/:id` now enforces visibility itself rather than relying on an upstream
  population invariant — robust against any future path that fills the turn buffers
  outside the gated `onEvent`.
- REST and SSE egress now share one visibility rule via one wrapper (no logic duplication).

### Negative / Risks

- A turn whose `scope` is malformed/absent resolves to not-visible and returns `404`. This
  is the safe direction (default-deny) but can read as a spurious miss for a malformed turn.

## Related Decisions

- ADR-0197: Debug Observability Fixes (the `isVisibleToAdmin` invariant and egress redaction).
