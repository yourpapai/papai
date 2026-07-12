<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# FU4 — magi-restart Orphan Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a magi restart (crash or graceful) survivable for in-flight sessions when `MAGI_DB` points at a
file: a new boot-time pass flips any session stranded mid-flight to `interrupted` (or `queued` rows to `failed`),
so nerv's existing cause-blind P2 resume policy picks them back up automatically — and warn loudly at boot when
`MAGI_DB` is `:memory:`/unset, since in that mode the DB itself evaporates on exit and the pass has nothing to act
on.

**Architecture:** One new pure module, `magi/src/session/restart-orphans.ts`, exporting
`markRestartOrphans(store: SessionStore): RestartOrphanSummary` — it lists sessions in the four "live" statuses via
the existing `SessionStore.listByStatus`, transitions each to `interrupted`, lists `queued` sessions and
transitions each to `failed`, and returns/logs the counts. `magi/src/main.ts`'s `runServe` gets two new synchronous
calls, inserted right after `assertServeReady` and before every other boot-time action (rate limiter, hub, the
fire-and-forget `sweepOrphanWorkspaces`/`fireSessionStateReaper`, and `startServer`): a new exported
`warnIfEphemeralDb(raw: string | undefined): void` (Component A) and `markRestartOrphans(ctx.store)` (Component
B). No schema change, no new persistence, no wire change, no nerv/papai code (nerv's `interrupted`-status resume
path and reconcile sweep are already cause-blind — see the design doc's "Premise" section).

**Tech Stack:** Bun (`bun:sqlite`, `bun:test`), TypeScript (strict, no `any`, no optional chaining (`?.`), explicit
return types, no semicolons, single quotes, 120-col — enforced by `oxlint`/`oxfmt`), magi's existing `SessionStore`
(`src/session/store.ts`) and `SessionManager`/`resumeSession` (`src/session/manager.ts`, `src/session/
continuation.ts`) as read-only ground truth.

**Repo:** `/Users/ki/Projects/yourpapai/magi`, branch `main` (currently clean; baseline is 578 tests green — this
plan's 3 tasks add 6 new tests for 584 green). Commands: `bun test <path>` (or `bun test` for the full suite),
`bun run typecheck`, `bun run lint`, `bun run format` (auto-fixes `oxfmt` formatting — **run it before every
lint/commit**, since a fresh save is not `oxfmt`-formatted and `lint` does not auto-format).

---

## Ground truth established by direct verification (2026-07-13)

This plan was written by actually applying every task's change to a real magi checkout in stages (test-first, RED,
then GREEN), running the full `typecheck`/`lint`/`format:check`/`test` gate at the end, and then reverting — not by
reading the spec's pseudocode alone. Every "Expected" output below (including RED failure text and exact `N pass`
/ `N expect() calls` counts) is a real, observed `bun test` run, not an estimate.

**1. Transition legality — `magi/src/session/state.ts:39-50` (`TRANSITIONS`), read in full.** The `SessionStatus`
union (`:5-15`) and `canTransition(from, to): boolean` (`:52-54`, a plain `TRANSITIONS[from].includes(to)` lookup,
no side effects) are the only transition machinery. The exact legal set:

```
queued:               -> preparing, failed, cancelled
preparing:             -> running, failed, cancelled, interrupted
running:               -> waiting_permission, waiting_input, finishing, failed, cancelled, interrupted
waiting_permission:    -> running, failed, cancelled, interrupted
waiting_input:         -> running, finishing, done, failed, cancelled
finishing:             -> done, failed, cancelled, interrupted
done / failed / cancelled: -> (terminal, no legal transitions)
interrupted:            -> preparing, failed, cancelled
```

All four `preparing`/`running`/`waiting_permission`/`finishing` → `interrupted` transitions **are legal** (each
source row lists `interrupted` in `TRANSITIONS`). `queued -> failed` **is legal** — `queued`'s row is
`['preparing', 'failed', 'cancelled']`, `failed` is directly in it. **No fallback to `cancelled` is needed** and no
table edit is needed; decision 4 in the design doc is directly implementable as written.

**2. `SessionStore`'s status-update API — `magi/src/session/store.ts`, read in full.** `listByStatus(statuses:
SessionStatus[]): Session[]` (`:213-231`) is a plain `SELECT ... WHERE status IN (...)`, no filtering beyond that.
`updateStatus(id: string, status: SessionStatus): void` (`:145-152`) is a **raw, unvalidated**
`UPDATE sessions SET status = $status, updated_at = $updatedAt WHERE id = $id` — it does **not** call
`canTransition` and will happily write an illegal transition. The validation lives one layer up, in
`SessionManager`'s **private** `transition(id, to)` method (`magi/src/session/manager.ts:56-65`): it reads the
current row, checks `canTransition(current.status, to)`, and only then calls `store.updateStatus`; on an illegal
transition it `logger.warn`s and does nothing. That private method isn't reachable from a free function that only
has a `SessionStore` (the spec's signature is `markRestartOrphans(store)`, not `markRestartOrphans(manager)`, and
`runServe` doesn't construct a `SessionManager` until after this pass would need to run). **Decision:** replicate
the same pattern inline — call `canTransition(session.status, target)` as a guard before every `store.updateStatus`
call, `logger.warn` and skip on failure. This can't fire in practice (the source statuses passed to
`listByStatus` and the fixed target are exactly the legal pairs confirmed in #1, and this is a synchronous,
single-threaded boot pass with no concurrent writer), but it's the same defense-in-depth `SessionManager.transition`
already uses, at zero extra cost, and turns a future accidental edit to `TRANSITIONS` into a loud warning instead of
a silently-illegal row. **The per-row update does not go through any store-level validator (there isn't one) — the
guard is the caller's own `canTransition` check, same as `SessionManager.transition`.**

**3. `runServe` placement — `magi/src/main.ts`, read in full.** `runServe(ctx: RuntimeContext)` (`:140-180`) does,
in this exact order today: read+validate `MAGI_API_TOKEN`, `assertServeReady(ctx.policy)`, build a rate limiter,
build a `SessionHub`, build `ServerDeps` (which constructs the `SessionManager` from `ctx.store` and friends), then
(only `if (ctx.kind === 'geofront'`) fire-and-forget `sweepOrphanWorkspaces`, then fire-and-forget
`fireSessionStateReaper(ctx)`, then `startServer(deps, port)`. `ctx: RuntimeContext` (interface at `:112-123`) is
passed into `runServe` from `main()` (`:241-264`) and already carries `store: SessionStore` — `ctx.store` is in
scope for the whole function body, no new plumbing needed. **The insertion point is immediately after
`assertServeReady(ctx.policy)` and before `const rateLimiter = createRateLimiter(...)`** — this is both the
earliest point after the fail-closed policy guard and strictly before the rate limiter/hub/deps construction, the
`sweepOrphanWorkspaces`/`fireSessionStateReaper` fire-and-forget calls, and `startServer`, exactly matching the
design doc's ordering rationale (marked rows must leave the reaper's `ACTIVE` set before the reaper/sweep run, and
no resume/follow-up can reach an un-marked row because the server hasn't started accepting requests yet).
`process.env['MAGI_DB']` is resolved once, in `main()` at `:248` (`new SessionStore(new Database(process.env
['MAGI_DB'] ?? ':memory:'))`), not inside `runServe` — so Component A's check reads `process.env['MAGI_DB']`
directly again at the `runServe` call site (the `SessionStore`/`Database` object exposes no path accessor). `logger`
(pino, from `./logger.js`) is already imported and used in `main.ts` (e.g. the `fireSessionStateReaper` catch
handler), so no new import is needed for it — only a new import of `markRestartOrphans` from
`./session/restart-orphans.js`. **`runServe` itself is not exported** (only `assertServeReady`,
`readReadyTimeoutMs`, `sessionStateRootFrom`, etc. are, and `tests/main.test.ts` only imports those) — so
`warnIfEphemeralDb` is written as its own small exported pure function (same pattern as `assertServeReady`), taking
an explicit `raw: string | undefined` parameter rather than reading `process.env` internally, so it's directly
unit-testable without needing to invoke `runServe` (which would require a live `MAGI_API_TOKEN`, a real
`startServer` port bind, etc.). `runServe`'s own placement of the two new calls is verified by reading the diff in
Task 2, Step 3 below — it cannot be unit-tested directly since `runServe` isn't exported and calls the
port-binding `startServer`.

**4. `preparing`+ rows always have `branch`/`projectSpec` set — `magi/src/session/manager.ts`, read in full.**
`store.create` (called from `startSession`, `:106-114`) always writes `projectSpec` (it's a required, non-nullable
field on `CreateSessionInput`/the `sessions.project_spec` column) — so **every** row, including one still at
`queued`, already has `projectSpec` set. `branch` is `null` until `runLifecycle` (`:167-216`) reaches
`:182-184`: `this.store.setCwd(id, prepared.worktreePath); this.store.setBranch(id, prepared.branch);
this.transition(id, 'preparing')` — branch is set **immediately before** the transition to `preparing`, and nothing
in the rest of the lifecycle (`running`, `waiting_permission`, `finishing`) ever clears it. So **every row at
`preparing` or later always has both `branch` and `projectSpec` set** — a row marked `interrupted` by this pass is
always genuinely resumable (passes `resumeSession`'s guard at `manager.ts:140-147`: `parent.branch === null ||
parent.projectSpec === null` → refuse). Only `queued` rows can lack `branch` (never `projectSpec`), which is
exactly why decision 4 marks them `failed` instead of `interrupted` — confirmed correct, no row needs different
handling than the design doc already specifies.

**5. Test harness for "reopen a file-backed DB to simulate a restart" — `tests/session/store.test.ts` +
`tests/workspace/git-workspace.test.ts`, read in full.** No existing magi test opens a file-backed `bun:sqlite`
`Database` and reopens it (confirmed — every `store.test.ts`/`manager.test.ts` case uses `new Database(':memory:')`).
The established deterministic-enough temp-path pattern (used throughout `tests/workspace/`, `tests/session/
manager.test.ts`, etc., and confirmed to contain no bare `Date.now()`/`Math.random()` calls — `mkdtemp` itself
handles uniqueness at the OS level) is `mkdtempSync(join(tmpdir(), '<prefix>-'))`. Task 1 below opens
`new Database(dbPath)` where `dbPath = join(mkdtempSync(join(tmpdir(), 'magi-restart-')), 'sessions.db')`, seeds
rows and closes that `Database` (`.close()`), then opens a **second** `new Database(dbPath)` / `new
SessionStore(...)` over the same file to simulate the restart, exactly as the design doc's testing-strategy section
prescribes.

**oxlint/tsc gotchas hit while verifying (all real — confirmed via an actual `bun run lint`/`bun run typecheck` run
against every file below, 0 warnings/errors):**

- No optional chaining (`?.`) anywhere — `oxc/no-optional-chaining` is `error`. Use `array[array.length - 1]` +
  `expect(x).toBeDefined()` + non-null assertion (`x!`) instead, same pattern `store.test.ts` already uses
  (`expect(first!.id)`).
- `noUnusedLocals`/`noUnusedParameters` (`tsconfig.json`) are both `true`. Every helper added in a task must be
  used (called or exported) in that same task/commit — never add a helper before its consumer exists in the same
  step.
- The repo's TDD hook blocks writing a `src/**` file unless a matching test file already exists this session and
  imports it — so every task below writes the test file **first**, confirms the RED failure, then writes the
  source file.
- `bun run format` (oxfmt) must run **before** `bun run lint`/commit — a freshly saved file is not oxfmt-formatted
  and neither `lint` nor `format:check` auto-fixes.
- No semicolons, single quotes (oxfmt-enforced) — all code blocks below already follow this.

---

## File Structure

- **Create:** `magi/src/session/restart-orphans.ts` — `markRestartOrphans(store)` + `RestartOrphanSummary`, the
  Component B boot pass (Task 1).
- **Create:** `magi/tests/session/restart-orphans.test.ts` — covers `markRestartOrphans` (Task 1) and the
  recovery-path-intact contract test against `SessionManager.resumeSession` (Task 3).
- **Modify:** `magi/src/main.ts` — new exported `warnIfEphemeralDb` (Component A) + wiring both new calls into
  `runServe` (Task 2).
- **Modify:** `magi/tests/main.test.ts` — new `describe('warnIfEphemeralDb', ...)` block (Task 2).

No other files change.

---

## Task 1: `markRestartOrphans` — the boot-time status pass

**Files:**

- Create: `magi/src/session/restart-orphans.ts`
- Test: `magi/tests/session/restart-orphans.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `magi/tests/session/restart-orphans.test.ts` with the following content. It simulates a restart by opening a
file-backed `SessionStore`, seeding one row per `SessionStatus` (setting `branch` + status directly for every
non-`queued` row, matching how a real in-flight row looks per Ground Truth #4), closing that `Database`, then
opening a **second** `SessionStore` over the same file (the "process restarted" store) and running the pass against
it:

```typescript
import { Database } from 'bun:sqlite'
import { describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { logger } from '../../src/logger.js'
import type { ProjectSpec } from '../../src/project/config.js'
import { markRestartOrphans } from '../../src/session/restart-orphans.js'
import type { SessionStatus } from '../../src/session/state.js'
import { SessionStore } from '../../src/session/store.js'

const DEMO_SPEC: ProjectSpec = {
  name: 'demo',
  repoUrl: 'https://github.com/octo/demo.git',
  baseBranch: 'main',
  permissionPreset: 'cautious',
  agent: 'claude',
}

function seed(store: SessionStore, id: string, status: SessionStatus): void {
  store.create({
    id,
    project: 'demo',
    agent: 'claude',
    contextId: 'ctx',
    prompt: 'p',
    cwd: '/tmp',
    projectSpec: DEMO_SPEC,
  })
  if (status !== 'queued') {
    store.setBranch(id, `acp/${id}`)
    store.updateStatus(id, status)
  }
}

describe('markRestartOrphans', (): void => {
  test('marks live statuses interrupted and queued failed across a simulated restart, leaving the rest untouched', (): void => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'magi-restart-')), 'sessions.db')
    const db1 = new Database(dbPath)
    const store1 = new SessionStore(db1)

    seed(store1, 'q1', 'queued')
    seed(store1, 'p1', 'preparing')
    seed(store1, 'r1', 'running')
    seed(store1, 'wp1', 'waiting_permission')
    seed(store1, 'fl1', 'finishing')
    seed(store1, 'wi1', 'waiting_input')
    seed(store1, 'd1', 'done')
    seed(store1, 'fa1', 'failed')
    seed(store1, 'c1', 'cancelled')
    seed(store1, 'it1', 'interrupted')

    db1.close()

    const db2 = new Database(dbPath)
    const store2 = new SessionStore(db2)

    const summary = markRestartOrphans(store2)

    expect(summary).toEqual({ interrupted: 4, failed: 1 })
    expect(store2.get('q1')!.status).toBe('failed')
    expect(store2.get('p1')!.status).toBe('interrupted')
    expect(store2.get('r1')!.status).toBe('interrupted')
    expect(store2.get('wp1')!.status).toBe('interrupted')
    expect(store2.get('fl1')!.status).toBe('interrupted')
    expect(store2.get('wi1')!.status).toBe('waiting_input')
    expect(store2.get('d1')!.status).toBe('done')
    expect(store2.get('fa1')!.status).toBe('failed')
    expect(store2.get('c1')!.status).toBe('cancelled')
    expect(store2.get('it1')!.status).toBe('interrupted')

    db2.close()
  })

  test('no-ops on an empty table and logs { interrupted: 0, failed: 0 }', (): void => {
    const store = new SessionStore(new Database(':memory:'))
    const info = spyOn(logger, 'info')
    const before = info.mock.calls.length

    const summary = markRestartOrphans(store)

    expect(summary).toEqual({ interrupted: 0, failed: 0 })
    expect(info.mock.calls.length - before).toBe(1)
    const lastCall = info.mock.calls[info.mock.calls.length - 1]
    expect(lastCall).toBeDefined()
    expect(lastCall![0]).toEqual({ interrupted: 0, failed: 0 })
    info.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/session/restart-orphans.test.ts`

Expected: **FAIL** (module doesn't exist yet) — real observed output:

```
error: Cannot find module '../../src/session/restart-orphans.js' from '/Users/ki/Projects/yourpapai/magi/tests/session/restart-orphans.test.ts'
 0 pass
 1 fail
 1 error
```

- [ ] **Step 3: Implement `markRestartOrphans`**

Create `magi/src/session/restart-orphans.ts`:

```typescript
import { logger } from '../logger.js'
import { canTransition } from './state.js'
import type { SessionStatus } from './state.js'
import type { SessionStore } from './store.js'

export interface RestartOrphanSummary {
  interrupted: number
  failed: number
}

// Statuses left mid-flight by a magi process death (crash or graceful exit —
// neither drains a live turn to terminal). All four are valid `interrupted`
// predecessors per the TRANSITIONS table in state.ts.
const INTERRUPT_SOURCES: readonly SessionStatus[] = ['preparing', 'running', 'waiting_permission', 'finishing']

// A row that never reached `preparing` has no branch/projectSpec set
// (manager.ts sets both immediately before the preparing transition), so it
// fails resumeSession's guard and is unresumable. `queued -> failed` is a
// legal transition (state.ts TRANSITIONS.queued).
const FAIL_SOURCES: readonly SessionStatus[] = ['queued']

function markAll(store: SessionStore, sources: readonly SessionStatus[], target: SessionStatus): number {
  let count = 0
  for (const session of store.listByStatus([...sources])) {
    if (canTransition(session.status, target)) {
      store.updateStatus(session.id, target)
      count++
    } else {
      logger.warn(
        { id: session.id, from: session.status, to: target },
        'markRestartOrphans: illegal transition skipped',
      )
    }
  }
  return count
}

// Boot-time pass: flips DB status for sessions stranded mid-flight by a magi
// process restart. Must run synchronously before the server accepts requests
// so no resume/follow-up can race an un-marked row (see
// docs/superpowers/specs/2026-07-13-followups-fu4-magi-restart-orphan-recovery-design.md).
// Status-only: the existing sweepOrphanWorkspaces + resume-rebuilds-fresh
// already cover container/worktree reclamation.
export function markRestartOrphans(store: SessionStore): RestartOrphanSummary {
  const interrupted = markAll(store, INTERRUPT_SOURCES, 'interrupted')
  const failed = markAll(store, FAIL_SOURCES, 'failed')
  logger.info({ interrupted, failed }, 'markRestartOrphans: boot orphan-recovery pass complete')
  return { interrupted, failed }
}
```

- [ ] **Step 4: Run `bun run format` then the test again to verify it passes**

Run: `bun run format`, then: `bun test tests/session/restart-orphans.test.ts`

Expected: **PASS** — real observed output: `2 pass`, `0 fail`, `15 expect() calls`.

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint`

Expected: both exit 0, no errors (confirmed clean against this exact file).

- [ ] **Step 6: Commit**

```bash
git add src/session/restart-orphans.ts tests/session/restart-orphans.test.ts
git commit -m "$(cat <<'EOF'
feat(session): add markRestartOrphans boot-time orphan-recovery pass (FU4 Component B)

A magi restart (crash or graceful) strands any session that was
preparing/running/waiting_permission/finishing mid-flight — nothing today
marks those rows, so they're invisible to both the reaper (its ACTIVE set
excludes them) and to nerv's resume policy (gated on `interrupted`).
markRestartOrphans flips those four statuses to interrupted and queued
(unresumable, no branch/projectSpec yet) to failed, reusing the existing
listByStatus + canTransition-guarded updateStatus. Not yet wired into
runServe — that's FU4 Component A/wiring, next commit.
EOF
)"
```

---

## Task 2: Component A (`MAGI_DB` warning) + wire `markRestartOrphans` into `runServe`

**Files:**

- Modify: `magi/src/main.ts`
- Test: `magi/tests/main.test.ts` (modify)

- [ ] **Step 1: Write the failing test**

Edit `magi/tests/main.test.ts` — add `spyOn` to the `bun:test` import, import `logger`, add `warnIfEphemeralDb` to
the `../src/main.js` import list, and append a new `describe` block:

```typescript
import { describe, expect, it, spyOn, test } from 'bun:test'

import { logger } from '../src/logger.js'
import {
  assertServeReady,
  buildNotifier,
  buildPolicy,
  loadDefaults,
  readReadyTimeoutMs,
  selectRuntime,
  sessionStateRootFrom,
  sessionStateTtlMsFrom,
  warnIfEphemeralDb,
} from '../src/main.js'
import { NoopNotifier } from '../src/notify/noop.js'
import { HttpNotifier } from '../src/notify/notifier.js'
import { GeofrontRuntime } from '../src/runtime/geofront/geofront-runtime.js'
import { StubRuntime } from '../src/runtime/stub/stub-runtime.js'
```

Append at the end of the file, after the existing `describe('assertServeReady', ...)` block:

```typescript
describe('warnIfEphemeralDb', (): void => {
  test('warns when MAGI_DB is undefined', (): void => {
    const warn = spyOn(logger, 'warn')
    const before = warn.mock.calls.length
    warnIfEphemeralDb(undefined)
    expect(warn.mock.calls.length - before).toBe(1)
    warn.mockRestore()
  })

  test('warns when MAGI_DB is exactly ":memory:"', (): void => {
    const warn = spyOn(logger, 'warn')
    const before = warn.mock.calls.length
    warnIfEphemeralDb(':memory:')
    expect(warn.mock.calls.length - before).toBe(1)
    warn.mockRestore()
  })

  test('does not warn when MAGI_DB is a file path', (): void => {
    const warn = spyOn(logger, 'warn')
    const before = warn.mock.calls.length
    warnIfEphemeralDb('/data/magi/sessions.db')
    expect(warn.mock.calls.length - before).toBe(0)
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/main.test.ts`

Expected: **FAIL** (export doesn't exist yet) — real observed output:

```
SyntaxError: Export named 'warnIfEphemeralDb' not found in module '/Users/ki/Projects/yourpapai/magi/src/main.ts'.
 0 pass
 1 fail
 1 error
```

- [ ] **Step 3: Implement `warnIfEphemeralDb` and wire both calls into `runServe`**

Edit `magi/src/main.ts` — add the import next to the other `./session/*` imports:

```typescript
import { createBroadcastRecorderFactory } from './session/broadcast-recorder.js'
import { SessionHub } from './session/hub.js'
import { SessionManager } from './session/manager.js'
import { reapExpiredState } from './session/reaper.js'
import { markRestartOrphans } from './session/restart-orphans.js'
```

Then, immediately above `runServe` and inside it, immediately after `assertServeReady(ctx.policy)` and before
`const rateLimiter = createRateLimiter(...)`:

```typescript
// Warns (never blocks) when MAGI_DB would leave the sessions table ephemeral,
// so restart-orphan recovery (markRestartOrphans) has nothing to recover from
// after a restart. Reads the same value main() resolves for `new Database(...)`.
export function warnIfEphemeralDb(raw: string | undefined): void {
  if (raw === undefined || raw === ':memory:') {
    logger.warn(
      { magiDb: raw ?? ':memory:' },
      'MAGI_DB is unset or ":memory:" - session state will not survive a magi restart; restart-orphan recovery is inert until MAGI_DB points at a file',
    )
  }
}

function runServe(ctx: RuntimeContext): void {
  const token = process.env['MAGI_API_TOKEN']
  if (token === undefined || token.length === 0) {
    throw new Error('MAGI_API_TOKEN is required to serve')
  }
  assertServeReady(ctx.policy)
  warnIfEphemeralDb(process.env['MAGI_DB'])
  markRestartOrphans(ctx.store)
  const rateLimiter = createRateLimiter(
```

(Only the new function, the new import, and these two new lines inside `runServe` change — everything else in
`runServe`, including the rest of `createRateLimiter(...)` onward, is untouched.)

Placement check (not unit-testable — `runServe` isn't exported and calls the port-binding `startServer`): confirm
by reading the diff that `warnIfEphemeralDb(...)` and `markRestartOrphans(ctx.store)` both appear **after**
`assertServeReady(ctx.policy)` and **before** `const rateLimiter = ...`, i.e. strictly before the `SessionHub`,
`ServerDeps`/`SessionManager` construction, the `if (ctx.kind === 'geofront')` `sweepOrphanWorkspaces` block,
`fireSessionStateReaper(ctx)`, and `startServer(deps, ...)`.

- [ ] **Step 4: Run `bun run format` then the test again to verify it passes**

Run: `bun run format`, then: `bun test tests/main.test.ts`

Expected: **PASS** — real observed output: `24 pass`, `0 fail`, `32 expect() calls` (21 pre-existing + 3 new).

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint`

Expected: both exit 0, no errors (confirmed clean against this exact diff).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts tests/main.test.ts
git commit -m "$(cat <<'EOF'
feat(main): warn on ephemeral MAGI_DB and run markRestartOrphans before serving (FU4 Component A)

MAGI_DB defaults to :memory: (main.ts's only `new Database(...)`), which
silently makes restart-orphan recovery inert (the sessions table evaporates
on exit). warnIfEphemeralDb logs a loud, non-fatal boot warning in that case.
markRestartOrphans (previous commit) is now wired into runServe, run
synchronously right after the fail-closed policy guard and strictly before
the rate limiter/hub/manager construction, the fire-and-forget
sweepOrphanWorkspaces/fireSessionStateReaper sweeps, and startServer — so
status is consistent before either sweep runs and before the server accepts
any resume/follow-up request.
EOF
)"
```

---

## Task 3: recovery-path-intact contract test

**Files:**

- Modify: `magi/tests/session/restart-orphans.test.ts` (append)

No source change in this task — it's a contract/regression test proving Task 1's output (a row marked
`interrupted`, with `branch`/`projectSpec` set per Ground Truth #4) is accepted by the **existing**, unmodified
`SessionManager.resumeSession`/`runResume` path (P2 machinery, untouched by FU4). Expected to pass on the first
run since both pieces it composes already exist and are already tested independently — this locks down the
integration point the design doc's testing-strategy section calls out ("Recovery path intact").

- [ ] **Step 1: Add the test**

Edit `magi/tests/session/restart-orphans.test.ts` — extend the import block and add two small local helpers, then
append a new `describe` block at the end of the file.

Extend the imports at the top of the file:

```typescript
import { logger } from '../../src/logger.js'
import { NoopNotifier } from '../../src/notify/noop.js'
import { PermissionEngine } from '../../src/permission/engine.js'
import type { ProjectDefaults, ProjectSpec } from '../../src/project/config.js'
import { StubRuntime } from '../../src/runtime/stub/stub-runtime.js'
import { SessionManager } from '../../src/session/manager.js'
import { markRestartOrphans } from '../../src/session/restart-orphans.js'
import type { SessionStatus } from '../../src/session/state.js'
import { SessionStore } from '../../src/session/store.js'
import { FakeWorkspace, demoSpec, stubForgeProvider } from '../support/fixtures.js'
```

Add these two helpers just above the existing `seed` function:

```typescript
function demoDefaults(): ProjectDefaults {
  return {
    workspaceImage: 'img:1',
    agentEntrypoint: ['claude-code-acp'],
    egressAllowlistDomains: [],
  }
}

async function pollDone(manager: SessionManager, id: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const session = manager.getSession(id)
    if (session !== null && session.status === 'done') {
      return
    }
    await Bun.sleep(10)
  }
  throw new Error(`session ${id} did not reach done`)
}
```

Append at the end of the file, after the existing `describe('markRestartOrphans', ...)` block:

```typescript
describe('markRestartOrphans -> resumeSession (recovery path intact)', (): void => {
  test('a row marked interrupted by the boot pass is accepted by the existing resumeSession/runResume path', async (): Promise<void> => {
    const store = new SessionStore(new Database(':memory:'))
    const manager = new SessionManager(
      store,
      new StubRuntime(),
      new FakeWorkspace(),
      new PermissionEngine({}),
      demoDefaults(),
      stubForgeProvider,
      new NoopNotifier(),
    )
    const parent = store.create({
      id: 'orphan-1',
      project: 'demo',
      agent: 'claude',
      contextId: 'ctx',
      prompt: 'do the thing',
      cwd: '/tmp',
      projectSpec: demoSpec(),
    })
    store.setBranch(parent.id, 'acp/orphan-1')
    store.updateStatus(parent.id, 'running')

    const summary = markRestartOrphans(store)
    expect(summary.interrupted).toBe(1)
    expect(store.get(parent.id)!.status).toBe('interrupted')

    const child = manager.resumeSession(parent.id, { forgeToken: 'tok' })
    expect(child).not.toBeNull()
    expect(child!.parentSessionId).toBe(parent.id)
    await pollDone(manager, child!.id)
  })
})
```

`demoSpec`, `FakeWorkspace`, and `stubForgeProvider` are reused from `tests/support/fixtures.ts` (already used the
same way by `tests/session/manager.test.ts`) rather than redefined here.

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test tests/session/restart-orphans.test.ts`

Expected: **PASS** on first run (no source change this task) — real observed output: `3 pass`, `0 fail`,
`19 expect() calls` (15 from Task 1's two tests + 4 new).

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bun run lint`

Expected: both exit 0, no errors (confirmed clean against this exact file).

- [ ] **Step 4: Full suite + format check**

Run: `bun run format && bun test`

Expected: **PASS**, real observed output: `584 pass`, `0 fail`, `1153 expect() calls` across `79` files (578
pre-existing + 6 new: 2 from Task 1 + 3 from Task 2 + 1 from Task 3).

- [ ] **Step 5: Commit**

```bash
git add tests/session/restart-orphans.test.ts
git commit -m "$(cat <<'EOF'
test(session): assert markRestartOrphans output is accepted by the existing resumeSession path (FU4)

Contract test, no source change: a row flipped to interrupted by
markRestartOrphans (with branch/projectSpec already set, per manager.ts's
setBranch-before-preparing ordering) passes resumeSession's guard and
launches a resumed child exactly like a P2 crash-detected interrupted
session would — proving FU4's boot pass and P2's existing resume path
compose correctly with zero nerv/papai changes.
EOF
)"
```

---

## Self-review

**Spec coverage:**

- Component A (`MAGI_DB` warning) → Task 2, Step 3 (`warnIfEphemeralDb`).
- Component B (boot orphan-mark pass: live→`interrupted`, `queued`→`failed`, structured summary log) → Task 1
  (`markRestartOrphans`).
- `runServe` wiring, synchronous, before `startServer` and ahead of the fire-and-forget sweeps → Task 2, Step 3 +
  placement check.
- Testing strategy's four bullets: "boot pass over a reopened file DB" → Task 1 Step 1's first test;
  "no-op on empty table" → Task 1 Step 1's second test; "recovery path intact" → Task 3; "warning" → Task 2 Step 1.
- Decisions of record 1-5 (magi-only/warn-don't-enforce/status-only/`queued`→`failed`/`waiting_input` untouched)
  are all directly reflected: no nerv/papai files touched; `warnIfEphemeralDb` never throws; `markRestartOrphans`
  never touches worktrees/containers; `FAIL_SOURCES = ['queued']`; `waiting_input` is absent from both
  `INTERRUPT_SOURCES` and `FAIL_SOURCES` and Task 1's test explicitly asserts it's left untouched.
- Open assumptions 1-4 from the spec are resolved with file:line ground truth in the "Ground truth" section above;
  assumption 5 (test harness) is resolved and used in Task 1.

**Placeholder scan:** no `TBD`/`TODO`/"add appropriate handling"/"similar to Task N" — every step has complete,
copy-pasteable code and exact, previously-observed command output.

**Type/name consistency:** `markRestartOrphans(store: SessionStore): RestartOrphanSummary` is defined once (Task

1. and imported with that exact name/signature in Task 2 (`main.ts`) and Task 3 (test). `warnIfEphemeralDb(raw:
string | undefined): void` is defined once (Task 2) and only referenced there. `RestartOrphanSummary { interrupted:
number; failed: number }` is used identically in Task 1's assertions and Task 3's assertion (`summary.interrupted`).
   `INTERRUPT_SOURCES`/`FAIL_SOURCES` status-set literals in Task 1's implementation exactly match the four
   statuses/`queued` asserted in Task 1's test and the design doc's Component B list.
