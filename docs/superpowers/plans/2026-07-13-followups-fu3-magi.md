<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# FU3 Component D — magi Graceful Dedupe Under Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `magi/src/session/continuation.ts`'s `launchContinuation` turn a `(parent_session_id, idempotency_key)`
unique-constraint violation on `store.create` into a graceful "return the already-created child" instead of an
uncaught `SQLiteError` — closing the one gap flagged (but deferred) by `store.ts`'s own comment.

**Architecture:** Add a narrow `isUniqueConstraintViolation(err)` predicate to `continuation.ts` that matches only
the specific bun:sqlite error signature a partial-unique-index violation produces, then wrap the existing
`deps.store.create(createInput)` call in `launchContinuation` in a try/catch: on a matching error, re-query
`findChildByIdempotencyKey(parent.id, createInput.idempotencyKey)` and return that session if found; otherwise (or
on any non-matching error) re-throw. This is a single, self-contained change to one function, covered by one new
test file (`tests/session/continuation.test.ts` does not exist yet).

**Tech Stack:** Bun (`bun:sqlite`, `bun:test`), TypeScript (strict, no `any`, no optional chaining, explicit return
types — enforced by `oxlint`/`oxfmt`), magi's existing `SessionStore` (`src/session/store.ts`).

**Repo:** `/Users/ki/Projects/yourpapai/magi`, branch `main`. Commands: `bun test <path>` (or `bun test` for the
full suite), `bun run typecheck`, `bun run lint`, `bun run format` (auto-fixes `oxfmt` formatting — **run it before
every lint/commit**, since a fresh save is not `oxfmt`-formatted and `lint` does not auto-format).

---

## Ground truth established by direct verification (2026-07-13)

This plan was written by actually applying the change to a real magi checkout, running the full test/lint/typecheck
gate, and then reverting — not by reading the spec's pseudocode alone. The following facts are confirmed, not
assumed:

**The exact bun:sqlite unique-constraint error signature.** A probe script (`bun:sqlite`, `bun run <script>.ts`)
against a real partial unique index shaped exactly like `idx_sessions_parent_idempotency`
(`CREATE UNIQUE INDEX ... ON sessions(parent_session_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
throws:

```
SQLiteError: UNIQUE constraint failed: sessions.parent_session_id, sessions.idempotency_key
  errno: 2067
  byteOffset: -1
  code: "SQLITE_CONSTRAINT_UNIQUE"
```

- `err instanceof SQLiteError` is `true`, where `SQLiteError` is a **real exported class** from `bun:sqlite`
  (`import { SQLiteError } from 'bun:sqlite'`; confirmed via `Object.keys(await import('bun:sqlite'))` →
  `['Database', 'SQLiteError', 'Statement', '__esModule', 'constants', 'default']`).
- `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` (typed `code?: string` in `node_modules/bun-types/sqlite.d.ts:1291`).
- A **plain, unrelated** `Error` (e.g. `TypeError`) is `instanceof SQLiteError === false` and has `err.code ===
undefined` — confirmed by direct probe. So `instanceof SQLiteError` alone already excludes ordinary errors.

**Message text is NOT a safe discriminator — this is the important gotcha.** A `PRIMARY KEY` violation on the same
table (a _different_, unrelated constraint — e.g. reusing a session `id`) produces the **same** `"UNIQUE constraint
failed: ..."` message prefix:

```
SQLiteError: UNIQUE constraint failed: sessions.id
  code: "SQLITE_CONSTRAINT_PRIMARYKEY"
```

Only `.code` tells `SQLITE_CONSTRAINT_UNIQUE` (our target: the idempotency index) apart from
`SQLITE_CONSTRAINT_PRIMARYKEY` (an unrelated bug that must still surface as an uncaught error, e.g. an id
collision). **`isUniqueConstraintViolation` must match on `.code`, never on `err.message`.** Task 2 below adds a
regression test proving this narrowness with the real, distinct error.

**Both scope variables are available at the catch site.** `launchContinuation` already has `parent: Session` (so
`parent.id` is in scope) and `createInput: CreateSessionInput` (whose `.idempotencyKey: string | null | undefined`
field — set by `planFollowUp`/`planResume`, `magi/src/session/lifecycle.ts:149,189`, always to `input.idempotencyKey
?? null` — is the same key that was passed to `store.create`). No new parameter needs to be threaded through; the
existing `createInput.idempotencyKey` is exactly the value `findChildByIdempotencyKey` needs as its second
argument.

**The re-query returns the right type.** `SessionStore.findChildByIdempotencyKey(parentId: string, key: string):
Session | null` (`store.ts:196-206`) returns the same `Session` type `dedupedChild` (`continuation.ts:13-15`)
returns and that `launchContinuation`'s own return type (`Session | null`) already accepts — no type gymnastics
needed.

**oxlint gotchas hit while verifying (fix these, don't lint-disable):**

- `eslint(max-classes-per-file)` — this project's oxlint config allows **only 1 class per test file**. Do not add a
  second `class ... extends SessionStore { ... }` stub for the negative test; instead trigger a _different_, real
  constraint violation (a `PRIMARY KEY` collision) against a plain `SessionStore` instance — see Task 2.
- `vitest(no-conditional-in-test)` — an `if` (or other branch) directly inside a `test(...)` callback body is
  rejected. Any narrowing (e.g. `instanceof` checks on a caught error) must live in a **module-level helper
  function** called from the test, not inline in the test body.
- `typescript(no-unsafe-type-assertion)` — `caught as SQLiteError` on a `catch (err: unknown)` value is rejected
  as unsafe (the assertion narrows a wider type without a runtime check the linter can see). Use a real `instanceof`
  narrowing helper (see `assertSQLiteError` in Task 2) instead of an `as` cast.
- Every edit needs `bun run format` (oxfmt) before `bun run lint` — a freshly written file is not
  oxfmt-formatted, and `format:check`/`lint` do not auto-fix.

---

## File Structure

- **Modify:** `magi/src/session/continuation.ts` — add `isUniqueConstraintViolation` + wrap
  `deps.store.create(createInput)` in `launchContinuation` (`:26-43` today) in a try/catch.
- **Create:** `magi/tests/session/continuation.test.ts` — new file (no test currently imports
  `src/session/continuation.ts` directly; per `magi/CLAUDE.md`'s "tests mirror `src/`" convention this file must
  exist and import the module it covers).

No other files change. `magi/src/session/store.ts` is read-only ground truth for this plan (its comment at `:99-101`
already prescribes exactly this fix) — it is not modified.

---

## Task 1: catch the race, return the existing child

**Files:**

- Modify: `magi/src/session/continuation.ts`
- Test: `magi/tests/session/continuation.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `magi/tests/session/continuation.test.ts` with the following content. It simulates the race the `store.ts`
comment describes: `dedupedChild`'s own `findChildByIdempotencyKey` check (the first call, inside `runFollowUp`)
runs _before_ a concurrent writer's insert of the same `(parentId, key)` becomes visible, so it sees nothing; by
the time `launchContinuation`'s `store.create` runs, that row is already committed, so the **real** bun:sqlite
partial unique index throws a genuine `SQLiteError`. The second `findChildByIdempotencyKey` call (from the new
catch block) queries the same real DB and finds the row that "won" the race. `RaceSimStore` models exactly this
interleaving with a call counter — no error is hand-constructed; every error in this test is a real one thrown by
a real `bun:sqlite` unique-index violation.

```typescript
import { Database, SQLiteError } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import type { ProjectDefaults } from '../../src/project/config.js'
import { runFollowUp } from '../../src/session/continuation.js'
import type { ContinuationDeps } from '../../src/session/continuation.js'
import { SessionStore } from '../../src/session/store.js'
import { demoSpec } from '../support/fixtures.js'

function demoDefaults(): ProjectDefaults {
  return { workspaceImage: 'img:1', agentEntrypoint: ['claude-code-acp'], egressAllowlistDomains: [] }
}

// Narrowing helper kept out of the test body itself: oxlint's
// no-conditional-in-test rule forbids branching inside a `test()` callback.
function assertSQLiteError(err: unknown): SQLiteError {
  if (!(err instanceof SQLiteError)) {
    throw new Error('expected a SQLiteError')
  }
  return err
}

// Simulates the race the store.ts comment (:99-101) describes: our own
// findChildByIdempotencyKey check (called first, from dedupedChild) runs
// before a concurrent writer's insert of the same (parentId, key) becomes
// visible, so it sees nothing; by the time launchContinuation's store.create
// runs, that row is committed, so the real bun:sqlite partial unique index
// (idx_sessions_parent_idempotency) throws a genuine SQLiteError. The second
// findChildByIdempotencyKey call (from launchContinuation's catch) queries
// the real DB and finds the row.
class RaceSimStore extends SessionStore {
  private lookupCalls = 0

  override findChildByIdempotencyKey(
    parentId: string,
    key: string,
  ): ReturnType<SessionStore['findChildByIdempotencyKey']> {
    this.lookupCalls += 1
    if (this.lookupCalls === 1) {
      return null
    }
    return super.findChildByIdempotencyKey(parentId, key)
  }
}

describe('launchContinuation graceful dedupe under a unique-constraint race', (): void => {
  test('a constraint violation on create returns the existing child instead of throwing', (): void => {
    const store = new RaceSimStore(new Database(':memory:'))
    store.create({
      id: 'p1',
      project: 'demo',
      agent: 'claude',
      contextId: 'c',
      prompt: 'first',
      cwd: '',
      projectSpec: demoSpec(),
    })
    store.updateStatus('p1', 'done')
    // The "concurrent writer" that already won the race, inserted directly
    // against the store (bypassing dedupedChild) to model the interleaving.
    store.create({
      id: 'winner-child',
      project: 'demo',
      agent: 'claude',
      contextId: 'c',
      prompt: 'second',
      cwd: '',
      projectSpec: demoSpec(),
      parentSessionId: 'p1',
      idempotencyKey: 'race-key',
    })
    const parent = store.get('p1')!
    let registerRunCalls = 0
    const deps: ContinuationDeps = {
      store,
      defaults: demoDefaults(),
      registerRun: (): void => {
        registerRunCalls += 1
      },
    }
    const result = runFollowUp(deps, parent, demoSpec(), 'attempted-child', {
      parentSessionId: 'p1',
      prompt: 'second',
      idempotencyKey: 'race-key',
    })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('winner-child')
    expect(registerRunCalls).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/session/continuation.test.ts`

Expected: **FAIL**. Against the unmodified `continuation.ts`, `launchContinuation`'s bare
`deps.store.create(createInput)` call throws the real `SQLiteError: UNIQUE constraint failed:
sessions.parent_session_id, sessions.idempotency_key` uncaught, so `runFollowUp` throws instead of returning —
`bun test` reports the test as failed with that error, not the expected `result`.

- [ ] **Step 3: Implement `isUniqueConstraintViolation` + wrap `store.create`**

Edit `magi/src/session/continuation.ts`:

```typescript
import { SQLiteError } from 'bun:sqlite'

import { logger } from '../logger.js'
import { buildEphemeralProject } from '../project/config.js'
import type { ProjectConfig, ProjectDefaults, ProjectSpec } from '../project/config.js'
import { planFollowUp, planResume } from './lifecycle.js'
import { CONTINUABLE, RESUMABLE } from './state.js'
import type { FollowUpSessionInput, ResumeCredentials, Session, StartSessionInput } from './state.js'
import type { CreateSessionInput, SessionStore } from './store.js'

// A repeat call with the same (parentId, idempotencyKey) must return the
// child already minted by the first call rather than minting a second one —
// checked before the status gate so a retry still succeeds even if the
// parent's status has since moved on from CONTINUABLE/RESUMABLE.
function dedupedChild(store: SessionStore, parentId: string, idempotencyKey: string | undefined): Session | null {
  return idempotencyKey === undefined ? null : store.findChildByIdempotencyKey(parentId, idempotencyKey)
}

// Narrow match for the partial unique index violation on
// idx_sessions_parent_idempotency (store.ts:102-104) — bun:sqlite surfaces a
// constraint violation as a SQLiteError whose `code` is the SQLite3 extended
// error name. Never matches any other error (a different SQLiteError code, a
// plain Error, etc.), so launchContinuation's catch below re-throws anything
// that isn't this exact race.
function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof SQLiteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE'
}

export interface ContinuationDeps {
  store: SessionStore
  defaults: ProjectDefaults
  registerRun: (id: string, input: StartSessionInput, project: ProjectConfig, continueBranch: string | null) => void
}

// Shared "mint child id, create its row, seed prUrl/prNumber from the parent,
// launch it on the parent's branch" tail shared by follow-up and resume —
// only how the plan (createInput/startInput) is built differs between them.
function launchContinuation(
  deps: ContinuationDeps,
  parent: Session,
  childId: string,
  project: ProjectConfig,
  createInput: CreateSessionInput,
  startInput: StartSessionInput,
): Session | null {
  try {
    deps.store.create(createInput)
  } catch (err) {
    if (
      isUniqueConstraintViolation(err) &&
      createInput.idempotencyKey !== null &&
      createInput.idempotencyKey !== undefined
    ) {
      const existing = deps.store.findChildByIdempotencyKey(parent.id, createInput.idempotencyKey)
      if (existing !== null) {
        return existing
      }
    }
    throw err
  }
  if (parent.prUrl !== null) {
    deps.store.setPrUrl(childId, parent.prUrl)
  }
  if (parent.prNumber !== null) {
    deps.store.setPrNumber(childId, parent.prNumber)
  }
  deps.registerRun(childId, startInput, project, parent.branch)
  return deps.store.get(childId)
}
```

Only the top import block, the new `isUniqueConstraintViolation` function, and the body of `launchContinuation`
change. `runFollowUp` and `runResume` (below `launchContinuation` in the same file) are untouched — both already
call the shared `launchContinuation` tail, so this one edit covers the "symmetric for follow-up and resume"
requirement from the spec's Decisions of record #5 automatically.

- [ ] **Step 4: Run `bun run format` then the test again to verify it passes**

Run: `bun run format` (oxfmt will reformat the `if (...)` condition's line-wrapping — this is expected and
required before lint/commit), then: `bun test tests/session/continuation.test.ts`

Expected: **PASS** — `2 expect() calls` at this point become `5` once Task 2's test is added; right now expect
`1 pass, 0 fail`.

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint`

Expected: both exit 0 with no errors. (If lint complains about anything in `continuation.ts`, re-run `bun run
format` first — a common false alarm is stale formatting, not a real lint violation.)

- [ ] **Step 6: Commit**

```bash
git add src/session/continuation.ts tests/session/continuation.test.ts
git commit -m "$(cat <<'EOF'
fix(session): graceful dedupe when launchContinuation's create races the idempotency index (FU3 Component D)

store.create's insert can lose a race against a concurrent writer minting
the same (parent_session_id, idempotency_key) pair — today that surfaces as
an uncaught SQLiteError instead of the intended dedupe. Catch the narrow
SQLITE_CONSTRAINT_UNIQUE violation and return the already-created child via
findChildByIdempotencyKey, matching the fix store.ts's own comment
prescribes. Unreachable single-process today; makes the mechanism sound
under a future multi-process MAGI_DB deployment.
EOF
)"
```

---

## Task 2: prove the match is narrow (regression test)

This task adds no new production code — Task 1's `isUniqueConstraintViolation` already discriminates correctly.
This is a **regression test**: it fails to compile/run only if a future edit accidentally widens the match (e.g.
to "any `SQLiteError`" or to a message-substring check), which would silently swallow unrelated bugs like an id
collision. Because a `PRIMARY KEY` violation on `sessions.id` shares the exact same `"UNIQUE constraint failed:
..."` message text as our target index violation (confirmed by direct probe — see "Ground truth" above) but a
**different** `.code` (`SQLITE_CONSTRAINT_PRIMARYKEY` vs `SQLITE_CONSTRAINT_UNIQUE`), it is the sharpest available
proof that the match is code-based, not message-based.

**Files:**

- Modify: `magi/tests/session/continuation.test.ts`

- [ ] **Step 1: Add the narrow-match test**

Add this second `test(...)` inside the existing `describe(...)` block in `magi/tests/session/continuation.test.ts`
(after the Task 1 test, still inside the same `describe`):

```typescript
test('a non-constraint SQLiteError from create still propagates (narrow match, not just any SQLiteError)', (): void => {
  // A PRIMARY KEY violation is a different bun:sqlite error CODE
  // (SQLITE_CONSTRAINT_PRIMARYKEY) from the one isUniqueConstraintViolation
  // matches (SQLITE_CONSTRAINT_UNIQUE) — proves the catch doesn't swallow
  // every SQLiteError, only the specific partial-unique-index violation.
  const store = new SessionStore(new Database(':memory:'))
  store.create({
    id: 'p1',
    project: 'demo',
    agent: 'claude',
    contextId: 'c',
    prompt: 'first',
    cwd: '',
    projectSpec: demoSpec(),
  })
  store.updateStatus('p1', 'done')
  // Pre-occupy the id our follow-up will try to mint, with no
  // idempotencyKey collision, so dedupedChild's first check finds nothing
  // and launchContinuation's store.create hits a PRIMARY KEY violation
  // instead of the unique-index one.
  store.create({
    id: 'dup-child',
    project: 'demo',
    agent: 'claude',
    contextId: 'c',
    prompt: 'other',
    cwd: '',
    projectSpec: demoSpec(),
    parentSessionId: 'p1',
  })
  const parent = store.get('p1')!
  const deps: ContinuationDeps = {
    store,
    defaults: demoDefaults(),
    registerRun: (): void => {},
  }
  let caught: unknown = null
  try {
    runFollowUp(deps, parent, demoSpec(), 'dup-child', {
      parentSessionId: 'p1',
      prompt: 'second',
      idempotencyKey: 'other-key',
    })
  } catch (err) {
    caught = err
  }
  const err = assertSQLiteError(caught)
  // Both a PRIMARY KEY and a UNIQUE index violation produce the SAME
  // "UNIQUE constraint failed" message text in bun:sqlite — a message-substring
  // match would wrongly treat this as our target race. Only the `code` field
  // tells them apart, which is exactly what isUniqueConstraintViolation checks.
  expect(err.code).toBe('SQLITE_CONSTRAINT_PRIMARYKEY')
  expect(err.message).toContain('UNIQUE constraint failed')
})
```

`assertSQLiteError` is the module-level helper already added in Task 1's version of the test file — do not inline
the `instanceof` check in the test body (oxlint's `no-conditional-in-test` forbids branching directly inside a
`test()` callback; see the "Ground truth" gotchas above).

- [ ] **Step 2: Run the test file and confirm both tests pass**

Run: `bun test tests/session/continuation.test.ts`

Expected: **PASS** — `2 pass, 0 fail, 5 expect() calls`. (This test passes immediately; it is not a red→green
step, since Task 1's implementation already handles this case correctly — it exists to pin that behavior down.)

- [ ] **Step 3: Format, lint, typecheck, and run the full suite**

Run: `bun run format && bun run lint && bun run typecheck && bun test`

Expected: `format` reports no remaining issues (or auto-fixes silently), `lint` exits 0, `typecheck` exits 0, and
the full suite passes with no regressions (verified during plan-writing: `578 pass, 0 fail` across 78 files with
this exact change applied).

- [ ] **Step 4: Commit**

```bash
git add tests/session/continuation.test.ts
git commit -m "$(cat <<'EOF'
test(session): pin isUniqueConstraintViolation to SQLITE_CONSTRAINT_UNIQUE only (FU3 Component D)

A PRIMARY KEY violation produces the same "UNIQUE constraint failed" message
text as our target partial-unique-index violation but a different bun:sqlite
error code — proves the graceful-dedupe catch discriminates on `.code`, not
message text, and never swallows an unrelated constraint bug.
EOF
)"
```

---

## Self-review

**Spec coverage.** Component D's two requirements are both covered: (1) "wrap the `deps.store.create(createInput)`
call so a unique-constraint violation ... is caught and turned into a re-query that returns the already-created
child" — Task 1. (2) "The catch is narrow — only the partial-unique-index violation ... never swallowing an
unrelated error" — Task 2 proves this with a real, distinct bun:sqlite error rather than an assertion about the
code alone. The spec's testing strategy line ("Constraint violation on `create` → re-query returns the existing
child, not a throw; a non-constraint error still propagates") maps 1:1 to Task 1 / Task 2.

**Placeholder scan.** No TBD/TODO, no "add appropriate error handling," no unshown code — every step has the
complete file content or complete diff, copied verbatim from the change that was actually applied, tested, linted,
typechecked, and reverted during plan-writing.

**Type consistency.** `isUniqueConstraintViolation(err: unknown): boolean`, `ContinuationDeps`,
`CreateSessionInput.idempotencyKey: string | null | undefined`, `SessionStore.findChildByIdempotencyKey(parentId:
string, key: string): Session | null`, and `Session` are used identically across Task 1's implementation and both
tests — these are the real, unmodified signatures from `magi/src/session/store.ts` and `magi/src/session/state.ts`,
not invented ones.

## Spec ambiguity notes

- The spec's Component D pseudocode writes `if (isUniqueConstraintViolation(err) && idempotencyKey !== undefined)`
  as if `idempotencyKey` were a local variable already in scope in `launchContinuation`. In the real code, the only
  available idempotency key at that point is `createInput.idempotencyKey`, typed `string | null | undefined` (not
  `string | undefined`) — so the implementation checks both `!== null` and `!== undefined` rather than the spec's
  single `!== undefined`. This is a faithful narrowing of the same intent (skip the re-query when there's no key to
  look up), not a deviation from it.
- The spec's "Test" note for Component D offers two options ("a pre-existing child ... or a stubbed store that
  throws the constraint on `create` then returns the child on re-query"). The first option (pre-existing child
  created up front) does **not** exercise the new catch path at all: `dedupedChild`'s check inside `runFollowUp`
  (which runs _before_ `launchContinuation` is ever called) would already find that child and return early — this
  is exactly what `manager.test.ts:1058` already tests, and it is not new coverage for Component D. This plan uses
  the second option (a store whose `findChildByIdempotencyKey` returns `null` on its first call and the real
  answer on subsequent calls), which is the only one of the two that actually drives execution through
  `launchContinuation`'s new try/catch.
