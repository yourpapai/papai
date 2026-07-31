<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# `/turns/:id` Scope Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `GET /turns/:id` REST route from returning turns that belong to contexts the signed-in operator is not authorized to see.

**Architecture:** The SSE event path already filters every event through `isVisibleToAdmin(scope, adminVisibility)` in `state-collector.ts`. The REST route `handleTurnLookup` (`src/debug/server.ts`) bypasses that filter and returns any turn from the global `recentTurns` / `inFlightTurns` buffers. We add a thin exported wrapper `isScopeVisibleToCurrentAdmin(scope)` that closes over the module-private `adminVisibility`, then call it inside `handleTurnLookup` so the REST egress enforces the same visibility contract as the SSE egress. Non-visible (and unknown) turns return `404` so existence is not confirmed.

**Tech Stack:** TypeScript (strict, `.js` import paths), Bun test runner (`bun:test`), Zod v4 (existing `TurnSchema`).

---

## Background — the confirmed finding

Verified by reading the code directly:

- `handleTurnLookup` (`src/debug/server.ts:128-137`) calls `findTurnById(turnId)` and returns `jsonResponse(turn)` with **no** `redactLogEntry` and **no** `isVisibleToAdmin` check.
- `findTurnById` (`src/debug/turn-assembly.ts:87-89`) searches `inFlightTurns.get(id) ?? recentTurns.find(...)` across **all** scopes — no owner filter.
- The same data over SSE _is_ filtered: `onEvent` (`src/debug/state-collector.ts:141-142`) drops events where `isVisibleToAdmin(event.scope, adminVisibility)` is false. So the two egress points disagree — the REST route violates the privacy contract the SSE route enforces.
- A returned `Turn` (`TurnSchema`, `src/debug/turn-assembly.ts:27-37`) carries cross-tenant `scope` identity (`userId`/`groupId`/`threadId`) plus free-text `error` and `toolCalls[].failureReason` — the exact free-text fields `redactLogEntry` deliberately drops elsewhere. It does **not** carry message bodies / tool args / tool results.
- Turn IDs for other scopes are harvestable by the same operator: `handleLogs` (`src/debug/server.ts:92-102`) returns redacted entries from the global ring buffer with `turnId` preserved in `ALLOWED_FIELDS`. So the route is practically reachable, not just theoretical. Severity: **medium** (trusted single operator principal, bounded data).

**Out of scope for this plan (do not implement here):**

- Redacting the free-text `error` / `failureReason` on _owned_ turns — the operator is allowed to see their own context, so the scope check alone closes the leak.
- Scope-filtering `/logs` itself — logs are already redacted; only the unredacted `turnId` enables harvest. Track separately.
- The broader DX/redaction research recommendations (static-`msg` lint, `ALLOWED_FIELDS` expansion, keyed-hash correlation). Separate plans.

---

## File Structure

| File                                              | Responsibility                                                                                                                                                                           | Change              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `src/debug/state-collector.ts`                    | Owns `adminVisibility` (module-private) and `isVisibleToAdmin`. Add a wrapper that forwards the current admin visibility so callers outside the module need not touch the private state. | Modify              |
| `src/debug/server.ts`                             | `handleTurnLookup` enforces the visibility check before returning a turn.                                                                                                                | Modify (`:128-137`) |
| `tests/debug/scope-visibility.test.ts`            | Unit test for the new wrapper against `init()`.                                                                                                                                          | Create              |
| `tests/debug/server.test.ts`                      | HTTP integration test: owned turn → 200, foreign turn → 404.                                                                                                                             | Modify              |
| `docs/deployment/dashboard-access.md`             | Document that `/turns/:id` is scope-filtered to the operator's own contexts.                                                                                                             | Modify (`:42`)      |
| `docs/adr/0223-turns-lookup-scope-enforcement.md` | Record the decision.                                                                                                                                                                     | Create              |

---

## Task 1: Add the `isScopeVisibleToCurrentAdmin` wrapper

**Files:**

- Modify: `src/debug/state-collector.ts` (add export after `isVisibleToAdmin`, currently `:77-83`)
- Test: `tests/debug/scope-visibility.test.ts` (create)

The wrapper closes over the module-private `adminVisibility` so `server.ts` never imports mutable module state. It accepts the loose `Turn['scope']` shape (Zod-inferred: `{ kind: 'user'|'group'|'global'; userId?: string; groupId?: string; threadId?: string }`) and forwards to the canonical `isVisibleToAdmin`, which is left unchanged. The single cast is safe because a persisted `turn.scope` originates from `event.scope` (a real `Scope`) at runtime; it is documented at the cast site.

- [ ] **Step 1: Write the failing test**

Create `tests/debug/scope-visibility.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { init, isScopeVisibleToCurrentAdmin } from '../../src/debug/state-collector.js'

describe('isScopeVisibleToCurrentAdmin', () => {
  test("returns true for the current admin's own user scope, false for others", () => {
    init('admin-a')

    expect(isScopeVisibleToCurrentAdmin({ kind: 'user', userId: 'admin-a' })).toBe(true)
    expect(isScopeVisibleToCurrentAdmin({ kind: 'user', userId: 'someone-else' })).toBe(false)
  })

  test('returns true for global scope and false for any group scope (group visibility disabled)', () => {
    init('admin-a')

    expect(isScopeVisibleToCurrentAdmin({ kind: 'global' })).toBe(true)
    expect(isScopeVisibleToCurrentAdmin({ kind: 'group', groupId: 'g1' })).toBe(false)
  })

  test('returns false for null/undefined or a malformed scope', () => {
    init('admin-a')

    expect(isScopeVisibleToCurrentAdmin(null)).toBe(false)
    expect(isScopeVisibleToCurrentAdmin(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/scope-visibility.test.ts`
Expected: FAIL — `isScopeVisibleToCurrentAdmin` is not an export of `state-collector.ts` (import error / `undefined is not a function`).

- [ ] **Step 3: Add the wrapper**

In `src/debug/state-collector.ts`, add a `Turn` type import next to the existing `turn-assembly` import (currently `:12`):

```typescript
import { recentTurns, recentNotifications, recentToolFailures, handleTurnAssembly } from './turn-assembly.js'
import type { Turn } from './turn-assembly.js'
```

Then, immediately after the existing `isVisibleToAdmin` function (ends at `:83`), add:

```typescript
/**
 * Visibility check for a persisted turn's scope against the process's current admin.
 * Closes over the module-private `adminVisibility` so REST handlers can enforce the
 * same contract as the SSE path without importing mutable module state.
 */
export function isScopeVisibleToCurrentAdmin(scope: Turn['scope'] | null | undefined): boolean {
  // A persisted turn.scope is set from the original event.scope, so at runtime it is a
  // real Scope; the Zod-inferred type is just looser than the event-bus union.
  return isVisibleToAdmin(scope as Parameters<typeof isVisibleToAdmin>[0], adminVisibility)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/debug/scope-visibility.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and lint the touched files**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun run lint`
Expected: no new errors in `state-collector.ts` or the new test.

- [ ] **Step 6: Commit**

```bash
git add src/debug/state-collector.ts tests/debug/scope-visibility.test.ts
git commit -m "feat(debug): add isScopeVisibleToCurrentAdmin visibility wrapper"
```

---

## Task 2: Enforce visibility in `handleTurnLookup`

**Files:**

- Modify: `src/debug/server.ts` (`handleTurnLookup` at `:128-137`; import at `:21`)
- Modify: `tests/debug/server.test.ts` (add tests after the existing `/turns/:id` 404 test at `:358-362`)

- [ ] **Step 1: Write the failing integration tests**

In `tests/debug/server.test.ts`, add two imports near the existing imports (the file already imports from `../../src/debug/log-buffer.js` and `../../src/debug/server.js`):

```typescript
import { recentTurns } from '../../src/debug/state-collector.js'
import type { Turn } from '../../src/debug/turn-assembly.js'
```

Then add these tests immediately after the existing `test('GET /turns/:id returns 404 for unknown turnId', ...)` block (ends `:362`). The server under test was started with admin id `'test-admin'` (see `beforeAll` → `startDebugServer('test-admin', ...)` at `:147`):

```typescript
test('GET /turns/:id returns 200 for a turn in the admin own user scope', async () => {
  const ownedTurn: Turn = {
    turnId: 'turn-owned',
    scope: { kind: 'user', userId: 'test-admin' },
    startedAt: 1,
    status: 'ok',
    incomingMessageCount: 1,
    toolCalls: [],
  }
  recentTurns.push(ownedTurn)

  const res = await fetch(`http://localhost:${TEST_PORT}/turns/turn-owned`, { headers: authHeaders() })
  expect(res.status).toBe(200)
  const body = JSON.parse(await res.text()) as Turn
  expect(body.turnId).toBe('turn-owned')
})

test('GET /turns/:id returns 404 for a turn in another user scope (no cross-tenant leak)', async () => {
  const foreignTurn: Turn = {
    turnId: 'turn-foreign',
    scope: { kind: 'user', userId: 'someone-else' },
    startedAt: 1,
    status: 'error',
    incomingMessageCount: 1,
    toolCalls: [],
    error: 'sensitive error text that must not leak',
  }
  recentTurns.push(foreignTurn)

  const res = await fetch(`http://localhost:${TEST_PORT}/turns/turn-foreign`, { headers: authHeaders() })
  expect(res.status).toBe(404)
  const text = await res.text()
  expect(text).not.toContain('sensitive error text')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/debug/server.test.ts -t '/turns/:id'`
Expected: the new `another user scope` test FAILS — current `handleTurnLookup` returns `200` with the foreign turn body (so `expect(res.status).toBe(404)` fails and/or the body contains `sensitive error text`). The `own user scope` test passes already.

- [ ] **Step 3: Enforce the check in `handleTurnLookup`**

In `src/debug/server.ts`, extend the existing import from `./state-collector.js` (currently `:21`):

```typescript
import { addClient, init, removeClient, findTurnById, isScopeVisibleToCurrentAdmin } from './state-collector.js'
```

Replace the body of `handleTurnLookup` (`:128-137`):

```typescript
function handleTurnLookup(url: URL): Response {
  const turnId = url.pathname.slice('/turns/'.length)
  if (turnId !== '') {
    const turn = findTurnById(turnId)
    // Enforce the same visibility contract as the SSE path: a turn outside the
    // operator's own contexts must not be reachable by REST id lookup. Return 404
    // (not 403) so the route does not confirm the existence of a foreign turn.
    if (turn !== undefined && isScopeVisibleToCurrentAdmin(turn.scope)) {
      return jsonResponse(turn)
    }
  }
  return new Response('Not found', { status: 404 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/debug/server.test.ts -t '/turns/:id'`
Expected: PASS — own-scope turn returns 200; foreign-scope turn returns 404 and the body does not contain the sensitive string; the pre-existing unknown-id 404 test still passes.

- [ ] **Step 5: Run the full debug test suite for regressions**

Run: `bun test tests/debug/`
Expected: PASS (no regressions in `server.test.ts`, `turn-assembly.test.ts`, `state-collector*.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/debug/server.ts tests/debug/server.test.ts
git commit -m "fix(debug): scope-filter GET /turns/:id to the operator's own contexts"
```

---

## Task 3: Document the boundary and record the decision

**Files:**

- Modify: `docs/deployment/dashboard-access.md` (`:42`)
- Create: `docs/adr/0223-turns-lookup-scope-enforcement.md`

- [ ] **Step 1: Update the dashboard-access doc**

In `docs/deployment/dashboard-access.md`, replace the `/turns/*` bullet (`:42`):

```markdown
- `/turns/*` (turn lookup)
```

with:

```markdown
- `/turns/*` (turn lookup — additionally **scope-filtered**: only turns in the operator's own contexts are returned; a turn in any other user/group context returns `404`, matching the SSE event filter)
```

- [ ] **Step 2: Confirm 0223 is the next free ADR number**

Run: `ls docs/adr/ | grep -oE '^[0-9]+' | sort -n | tail -1`
Expected: `0222` (so `0223` is the next free number). If it prints a higher number, name the file with `<that+1>` instead and adjust the title.

- [ ] **Step 3: Create the ADR**

Create `docs/adr/0223-turns-lookup-scope-enforcement.md`:

```markdown
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
```

- [ ] **Step 4: Run the full check**

Run: `bun check:full`
Expected: PASS (lint, typecheck, and tests all green).

- [ ] **Step 5: Commit**

```bash
git add docs/deployment/dashboard-access.md docs/adr/0223-turns-lookup-scope-enforcement.md
git commit -m "docs(debug): document /turns/:id scope enforcement (ADR-0223)"
```

---

## Self-Review notes

- **Spec coverage:** the confirmed finding (REST `/turns/:id` bypasses the SSE visibility filter) is closed by Task 2; Task 1 supplies the reusable check; Task 3 documents it. Explicitly-out-of-scope items (owned-turn error redaction, `/logs` scope-filtering, DX/redaction research) are listed and deferred.
- **Type consistency:** `isScopeVisibleToCurrentAdmin` is the exact name exported in Task 1, imported in Task 2, and unit-tested in Task 1. Its parameter is `Turn['scope'] | null | undefined`; `turn.scope` (from `findTurnById`) matches. The wrapper's single cast targets `Parameters<typeof isVisibleToAdmin>[0]` so it stays correct if `isVisibleToAdmin`'s signature ever changes. `Turn` is the type exported from `src/debug/turn-assembly.ts:52`.
- **No placeholders:** every code and command step is concrete; the ADR number is pre-checked (0222 latest → 0223) with a verification step in case the tree moved.

```

```
