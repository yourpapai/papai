<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# magi — Migration Phase 2 (Crash Auto-Resume) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give magi the ability to detect that a session's agent container crashed or hung mid-turn, mark that session `interrupted`, and let a caller relaunch it (on the same branch, with `session/load` continuity) via a new `resumeSession`/`POST /sessions/:id/resume` path — with idempotent retries so a caller that doesn't know whether its first dispatch landed can safely retry without minting a duplicate session.

**Architecture:** Two independent detection paths feed the same `interrupted` status: (1) the container's own process exiting mid-turn (`GeofrontRuntime.launch` now returns a `LaunchedAgent.exited: Promise<number|null>` that `runTrackedTurn` races against the live turn), and (2) a hung-but-alive container where the agent stops emitting ACP updates (`nextUpdateOrTimeout` races each `session.nextUpdate()` call against a configurable idle timer). Both funnel into `SessionManager.runLifecycle`'s catch block via `classifyLifecycleFailure`, which transitions the session to `interrupted` instead of `failed`. A new `resumeSession` method (mirroring the existing `followUpSession` continuation mechanics: new worktree on the parent's branch, `SessionStateShuttle.copyIn`, new container, `session/load`) mints a child session gated on `RESUMABLE = {interrupted}` instead of `CONTINUABLE`. Both `followUpSession` and `resumeSession` accept an optional `idempotencyKey`; a repeat call with the same `(parentId, idempotencyKey)` returns the previously-minted child instead of creating a new one — checked _before_ the status gate so a retry still succeeds even after the parent's status has moved on.

**Tech Stack:** Bun runtime (`bun:sqlite`), strict TypeScript, `bun test` / `bun test --parallel`, `tsgo --noEmit`, `oxlint` (`max-lines` 300 per file, `max-lines-per-function` 50, vitest-plugin `no-conditional-in-test`).

**Repo:** `/Users/ki/Projects/yourpapai/magi`

**Cross-repo note:** This plan lands BEFORE the nerv plan (`docs/superpowers/plans/2026-07-12-migration-p2-nerv.md` in papai). nerv depends on three things this plan produces: the `interrupted` `SessionStatus`, the `POST /sessions/:id/resume` endpoint, and the `idempotencyKey` field on both `follow-up` and `resume` dispatch bodies. Do not start the nerv plan until every task here is committed.

---

## File Structure

| File                                                                                                                                                                                                                                                                                     | Responsibility                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/session/state.ts` (modify)                                                                                                                                                                                                                                                          | `interrupted` status, `TRANSITIONS` entries, `RESUMABLE` set, `ResumeCredentials`, `FollowUpSessionInput.idempotencyKey`                                                   |
| `src/session/store-row.ts` (**new**)                                                                                                                                                                                                                                                     | `SessionRow` shape + `rowToSession`/`isSessionStatus` — split out of `store.ts` to keep it under the 300-line lint cap once `idempotency_key` is added                     |
| `src/session/store.ts` (modify)                                                                                                                                                                                                                                                          | `idempotency_key` column + migration, `CreateSessionInput.idempotencyKey`, `findChildByIdempotencyKey`                                                                     |
| `src/launcher/launcher.ts` (modify)                                                                                                                                                                                                                                                      | `LaunchedAgent.exited?: Promise<number \| null>`                                                                                                                           |
| `src/runtime/geofront/geofront-runtime.ts` (modify)                                                                                                                                                                                                                                      | `watchExit()` — wires `child.on('exit', ...)` into `LaunchedAgent.exited`                                                                                                  |
| `src/acp/idle-timeout.ts` (**new**)                                                                                                                                                                                                                                                      | `TurnIdleTimeoutError`, `nextUpdateOrTimeout()` — hung-but-alive watchdog                                                                                                  |
| `src/acp/types.ts` (modify)                                                                                                                                                                                                                                                              | `RunAcpSessionOptions.idleTimeoutMs`                                                                                                                                       |
| `src/acp/client.ts` (modify)                                                                                                                                                                                                                                                             | wires `nextUpdateOrTimeout` into `drainUpdates`; also has the resume-extraction split (below)                                                                              |
| `src/acp/resume.ts` (**new**)                                                                                                                                                                                                                                                            | `tryResumeSession`/`runLoadedSession`/`flushInFlightNotifications` — moved out of `client.ts` to keep it under 300 lines once idle-timeout wiring is added                 |
| `src/session/turn-tracking.ts` (**new**)                                                                                                                                                                                                                                                 | `raceExitAgainstTurn`, `runTrackedTurn`, `classifyLifecycleFailure` — the container-exit race + failure classification, extracted so `manager.ts` stays under the line cap |
| `src/session/helpers.ts` (modify)                                                                                                                                                                                                                                                        | `buildResumePrompt`, `RunRecordedTurnInput.idleTimeoutMs` threading                                                                                                        |
| `src/session/lifecycle.ts` (modify)                                                                                                                                                                                                                                                      | `planResume`/`ResumePlan`, `RunTurnDeps.idleTimeoutMs` threading                                                                                                           |
| `src/session/finish.ts` (**new**)                                                                                                                                                                                                                                                        | `FinishSessionDeps`/`finishSession` — `SessionManager.finishSession`'s body extracted so `manager.ts` stays under the line cap                                             |
| `src/session/continuation.ts` (**new**)                                                                                                                                                                                                                                                  | `ContinuationDeps`/`runFollowUp`/`runResume` — shared "dedupe → gate → plan → create → launch" logic for both continuation paths, including the idempotencyKey dedupe      |
| `src/session/manager.ts` (modify)                                                                                                                                                                                                                                                        | `resumeSession` method, `idleTimeoutMs` constructor param, wires `turn-tracking.ts`/`finish.ts`/`continuation.ts`                                                          |
| `src/server/router.ts` (modify)                                                                                                                                                                                                                                                          | `POST /sessions/:id/resume` route + `handleResume`; `idempotencyKey` on `handleFollowUp`                                                                                   |
| `src/main.ts` (modify)                                                                                                                                                                                                                                                                   | `readTurnIdleTimeoutMs()` env parsing, threaded into `SessionManager` construction                                                                                         |
| `tests/session/state.test.ts`, `tests/session/store.test.ts`, `tests/acp/client.test.ts`, `tests/runtime/geofront/geofront-runtime.test.ts`, `tests/session/manager.test.ts`, `tests/server/router.test.ts`, `tests/session/helpers.test.ts`, `tests/session/lifecycle.test.ts` (modify) | test coverage for each task                                                                                                                                                |

---

### Task 1: `interrupted` SessionStatus + transitions + RESUMABLE set

**Files:**

- Modify: `src/session/state.ts:5-50` (status union, `Session.idempotencyKey` deferred to Task 5 — skip that field here), `TRANSITIONS`
- Test: `tests/session/state.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/session/state.test.ts — add inside describe('canTransition', ...) after the
// existing 'waiting_input -> done is allowed' test, and a new describe block after it.
  test('running -> interrupted is allowed', (): void => {
    expect(canTransition('running', 'interrupted')).toBe(true)
  })

  test('preparing -> interrupted is allowed', (): void => {
    expect(canTransition('preparing', 'interrupted')).toBe(true)
  })

  test('waiting_permission -> interrupted is allowed', (): void => {
    expect(canTransition('waiting_permission', 'interrupted')).toBe(true)
  })

  test('finishing -> interrupted is allowed', (): void => {
    expect(canTransition('finishing', 'interrupted')).toBe(true)
  })

  test('waiting_input -> interrupted is forbidden', (): void => {
    expect(canTransition('waiting_input', 'interrupted')).toBe(false)
  })

  test('interrupted -> preparing, failed, and cancelled are allowed', (): void => {
    expect(canTransition('interrupted', 'preparing')).toBe(true)
    expect(canTransition('interrupted', 'failed')).toBe(true)
    expect(canTransition('interrupted', 'cancelled')).toBe(true)
  })

  test('interrupted allows no other transitions', (): void => {
    const targets = ['queued', 'running', 'waiting_permission', 'waiting_input', 'finishing', 'done'] as const
    for (const target of targets) {
      expect(canTransition('interrupted', target)).toBe(false)
    }
  })
})

describe('RESUMABLE', (): void => {
  test('contains only interrupted', (): void => {
    expect(RESUMABLE.has('interrupted')).toBe(true)
    expect(RESUMABLE.has('waiting_input')).toBe(false)
    expect(RESUMABLE.has('running')).toBe(false)
  })
})
```

Also update the top-of-file import: `import { canTransition, filterToStatuses, RESUMABLE, statusForStopReason } from '../../src/session/state.js'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/session/state.test.ts`
Expected: FAIL — `'interrupted'` is not assignable to `SessionStatus`, `RESUMABLE` is not exported.

- [ ] **Step 3: Add the status, transitions, and RESUMABLE set**

```typescript
// src/session/state.ts — add 'interrupted' to the SessionStatus union (after 'cancelled')
export type SessionStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'waiting_permission'
  | 'waiting_input'
  | 'finishing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
```

```typescript
// src/session/state.ts — replace the TRANSITIONS table
const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  queued: ['preparing', 'failed', 'cancelled'],
  preparing: ['running', 'failed', 'cancelled', 'interrupted'],
  running: ['waiting_permission', 'waiting_input', 'finishing', 'failed', 'cancelled', 'interrupted'],
  waiting_permission: ['running', 'failed', 'cancelled', 'interrupted'],
  waiting_input: ['running', 'finishing', 'done', 'failed', 'cancelled'],
  finishing: ['done', 'failed', 'cancelled', 'interrupted'],
  done: [],
  failed: [],
  cancelled: [],
  interrupted: ['preparing', 'failed', 'cancelled'],
}
```

```typescript
// src/session/state.ts — append after the existing CONTINUABLE export
// Statuses a session may be resumed from — currently just the crash/hang
// detection outcome. Resume mints a new child session id, same as follow-up.
export const RESUMABLE: ReadonlySet<SessionStatus> = new Set<SessionStatus>(['interrupted'])

// Credentials re-supplied for a resume dispatch (magi never inherits secrets
// across a container restart).
export interface ResumeCredentials {
  secrets?: Record<string, string>
  forgeToken?: string
  mcpTokens?: Record<string, string>
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/session/state.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean (0 errors). `SessionStatus` is a discriminated union consumed by `store-row.ts`'s `isSessionStatus` guard and `manager.ts`'s `switch`-free logic — nothing else exhaustively switches on it yet, so no other file needs a change in this task.

- [ ] **Step 6: Commit**

```bash
git add src/session/state.ts tests/session/state.test.ts
git commit -m "feat(session): add interrupted status, transitions, and RESUMABLE set"
```

---

### Task 2: Container-exit detection → `interrupted`

**Files:**

- Modify: `src/launcher/launcher.ts:31-36` (`LaunchedAgent.exited`)
- Modify: `src/runtime/geofront/geofront-runtime.ts:40-56,171-212` (`watchExit`, wire into `launch`)
- Create: `src/session/turn-tracking.ts`
- Modify: `src/session/manager.ts` (wire `turn-tracking.ts` into `runLifecycle`)
- Test: `tests/runtime/geofront/geofront-runtime.test.ts`, `tests/session/manager.test.ts`

- [ ] **Step 1: Write the failing geofront-runtime test**

```typescript
// tests/runtime/geofront/geofront-runtime.test.ts — add inside describe('GeofrontRuntime', ...)
test('launch resolves exited with the child exit code once the process exits', async (): Promise<void> => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'magi-geofront-exited-'))
  try {
    // Pre-create the socket so waitForSocket passes immediately; `true` exits at once
    // with code 0, so `exited` must resolve to 0 without shutdown() ever being called.
    const socketPath = join(tmpDir, 'acp-gexit.sock')
    writeFileSync(socketPath, '')
    const runtime = new GeofrontRuntime({ bin: 'true', socketDir: tmpDir, readyTimeoutMs: 500 })
    const launched = await runtime.launch({ sessionId: 'gexit', cwd: tmpDir, agent: 'x' })
    expect(launched.exited).toBeDefined()
    await expect(launched.exited).resolves.toBe(0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})
```

(`rmSync`, `mkdtempSync`, `writeFileSync`, `join`, `tmpdir`, `GeofrontRuntime` are already imported at the top of this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/runtime/geofront/geofront-runtime.test.ts -t "resolves exited"`
Expected: FAIL — `Property 'exited' does not exist on type 'LaunchedAgent'` (typecheck) or `launched.exited` is `undefined`.

- [ ] **Step 3: Add `exited` to `LaunchedAgent`**

```typescript
// src/launcher/launcher.ts — inside the LaunchedAgent interface, after `shutdown(): Promise<void>`
  // Resolves with the underlying agent process's exit code (or null) once it
  // exits on its own, without the caller having called shutdown() first —
  // signals a mid-turn crash. Omitted for runtimes that cannot observe this
  // (e.g. the in-process stub).
  exited?: Promise<number | null>
```

- [ ] **Step 4: Wire `watchExit` into `GeofrontRuntime.launch`**

```typescript
// src/runtime/geofront/geofront-runtime.ts — add after attachExitLogger, before buildShutdown
// Resolves once the `workspace up` process exits on its own (crash or host
// restart), independent of whether shutdown() was ever called. Registered
// synchronously alongside attachExitLogger, before any await, so the listener
// is never missed even if the process exits immediately (e.g. under test).
function watchExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve): void => {
    child.on('exit', (code: number | null): void => {
      resolve(code)
    })
  })
}
```

```typescript
// src/runtime/geofront/geofront-runtime.ts — inside launch(), right after attachExitLogger(child, spec.sessionId)
    const child = spawnGeofront(this.bin, args, spec.cwd)
    attachExitLogger(child, spec.sessionId)
    const exited = watchExit(child)
    try {
```

```typescript
// src/runtime/geofront/geofront-runtime.ts — the final return statement of launch()
const shutdown = buildShutdown(this.bin, spec.cwd, child, apparatus)
return { socketPath, cwd: this.workspacePath, shutdown, exited }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/runtime/geofront/geofront-runtime.test.ts -t "resolves exited"`
Expected: PASS.

- [ ] **Step 6: Write the failing manager-level interruption test**

```typescript
// tests/session/manager.test.ts — add inside describe('SessionManager', ...), after the
// existing 'shuts down the container even when the turn throws' test (or any convenient
// spot before the followUpSession tests). Needs these imports already present at the top
// of the file: startStubAgent, StubAgentOptions, LaunchSpec, LaunchedAgent, AgentRuntime,
// ProjectConfig, SessionStore, Database (bun:sqlite), PermissionEngine, demoDefaults,
// stubForgeProvider, NoopNotifier, FakeWorkspace, demoSpec.
test('runLifecycle marks the session interrupted when the container exits mid-turn', async (): Promise<void> => {
  const sock = join(mkdtempSync(join(tmpdir(), 'magi-exit-')), 'acp.sock')
  // Resolved only once the stub agent has actually completed session/new (i.e. the
  // ACP socket fully connected and the initialize + session/new handshake succeeded),
  // not at launch time — resolving `exited` before the socket finishes connecting
  // would destroy it mid-handshake, which never fires the SDK's 'connect' event and
  // hangs the turn forever instead of interrupting it. In hang mode the stub agent's
  // session/prompt handler returns before ever calling onPrompt, so onNewSession is
  // the reliable synchronization hook here, not onPrompt.
  let sessionStarted: () => void = (): void => {}
  const sessionStartedPromise = new Promise<void>((resolve): void => {
    sessionStarted = resolve
  })
  const handle = await startStubAgent(sock, {
    hang: true,
    onNewSession: (): void => {
      sessionStarted()
    },
  })
  let resolveExited: (code: number | null) => void = (): void => {}
  const exited = new Promise<number | null>((resolve): void => {
    resolveExited = resolve
  })
  const exitingRuntime: AgentRuntime = {
    name: 'exiting',
    provision(_worktreePath: string, _project: ProjectConfig, _secrets: Record<string, string>): Promise<void> {
      return Promise.resolve()
    },
    launch(_spec: LaunchSpec): Promise<LaunchedAgent> {
      return Promise.resolve({ socketPath: sock, shutdown: (): Promise<void> => Promise.resolve(), exited })
    },
  }
  const store = new SessionStore(new Database(':memory:'))
  const manager = new SessionManager(
    store,
    exitingRuntime,
    new FakeWorkspace(),
    new PermissionEngine({}),
    demoDefaults(),
    stubForgeProvider,
    new NoopNotifier(),
  )
  const started = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'c', prompt: 'p' })
  await sessionStartedPromise
  resolveExited(1)
  const status = await pollStatus(manager, started.id, 'interrupted')
  expect(status).toBe('interrupted')
  await handle.close()
})
```

Also add the `pollStatus` helper near the existing `pollRunning`/`pollTerminal` helpers:

```typescript
// tests/session/manager.test.ts — add near pollRunning
async function pollStatus(manager: SessionManager, id: string, target: SessionStatus): Promise<SessionStatus> {
  for (let i = 0; i < 200; i++) {
    const s = manager.getSession(id)
    if (s !== null && s.status === target) {
      return s.status
    }
    await Bun.sleep(10)
  }
  throw new Error(`session ${id} did not reach status ${target}`)
}
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test tests/session/manager.test.ts -t "marks the session interrupted"`
Expected: FAIL — the test times out / status never reaches `interrupted` because `runLifecycle` has no exit-race wiring yet.

- [ ] **Step 8: Create `src/session/turn-tracking.ts`**

```typescript
import type { LaunchedAgent } from '../launcher/launcher.js'
import type { ProjectConfig } from '../project/config.js'
import type { PreparedWorkspace } from '../workspace/workspace.js'
import { mcpServersFor, resolveResumeId, runSessionTurn } from './lifecycle.js'
import type { RunTurnDeps } from './lifecycle.js'
import { canTransition } from './state.js'
import type { StartSessionInput } from './state.js'
import type { SessionStore } from './store.js'

// Races a running turn against the launched agent's underlying process exiting on its
// own (container crash / host restart), independent of a deliberate cancel. When
// `launched.exited` is undefined (e.g. the in-process stub runtime), this is a no-op —
// the caller just awaits the turn as before. When the exit wins the race, `onExit` is
// invoked synchronously (before abort() is called) so the caller can record that fact
// through a side effect rather than this function's return value — turnPromise is then
// aborted, and awaiting it (the caller's job, not this function's) rejects as a direct
// consequence of that abort, which would otherwise throw before a return value here
// could ever reach the caller.
export async function raceExitAgainstTurn(
  turnPromise: Promise<void>,
  launched: LaunchedAgent,
  abort: AbortController,
  onExit: () => void,
): Promise<void> {
  const exited = launched.exited
  if (exited === undefined) {
    return
  }
  const outcome = await Promise.race([turnPromise.then((): 'turn' => 'turn'), exited.then((): 'exit' => 'exit')])
  if (outcome === 'exit' && !abort.signal.aborted) {
    onExit()
    abort.abort()
  }
}

// Bundles resumeSessionId resolution + the runSessionTurn call + the container-exit race
// into one call so SessionManager.runLifecycle doesn't have to wire the same multi-arg
// turn call at its one call site. `onInterruptedByExit` is called synchronously the
// moment the container's own exit wins the race against the turn (see
// raceExitAgainstTurn) — before this function's own `await turnPromise` below can
// reject and propagate out, so the caller's flag is reliably set even though this
// function itself throws in that case (matching the existing caller-driven-cancel
// behavior, where the turn's abort-triggered rejection is expected to propagate to
// SessionManager.runLifecycle's catch block).
export async function runTrackedTurn(
  deps: RunTurnDeps,
  store: SessionStore,
  id: string,
  launched: LaunchedAgent,
  project: ProjectConfig,
  prepared: PreparedWorkspace,
  input: StartSessionInput,
  continueBranch: string | null,
  abort: AbortController,
  onInterruptedByExit: () => void,
): Promise<void> {
  const resumeSessionId = continueBranch === null ? undefined : resolveResumeId(store, id)
  const turnPromise = runSessionTurn(
    deps,
    id,
    launched,
    project,
    prepared,
    input.prompt,
    input.projectSpec.model,
    abort.signal,
    resumeSessionId,
    mcpServersFor(input.projectSpec),
  )
  await raceExitAgainstTurn(turnPromise, launched, abort, onInterruptedByExit)
  await turnPromise
}

// Classifies why runLifecycle's try block threw and applies the matching status
// transition, returning the classification so the caller can log/failIfPossible
// appropriately. `interruptedByExit`/`idleTimedOut` take priority over `aborted`
// because raceExitAgainstTurn itself calls abort() once the container's exit wins the
// race, so by the time this runs `aborted` is also true for that same case; a
// TurnIdleTimeoutError never sets `aborted` at all (the ACP client rejects the turn
// itself on timeout, no AbortController involved), but is still an `interrupted` case,
// not a `failed` one.
export function classifyLifecycleFailure(
  store: SessionStore,
  id: string,
  interruptedByExit: boolean,
  idleTimedOut: boolean,
  aborted: boolean,
): 'interrupted' | 'cancelled' | 'failed' {
  if (interruptedByExit || idleTimedOut) {
    const curr = store.get(id)
    if (curr !== null && canTransition(curr.status, 'interrupted')) {
      store.updateStatus(id, 'interrupted')
    }
    return 'interrupted'
  }
  if (aborted) {
    const curr = store.get(id)
    if (curr !== null && canTransition(curr.status, 'cancelled')) {
      store.updateStatus(id, 'cancelled')
    }
    return 'cancelled'
  }
  return 'failed'
}
```

Note: `classifyLifecycleFailure` here has `idleTimedOut` as a parameter from the start (Task 3 wires the real caller, but the function signature is written once, in this task, to avoid a second breaking signature change later).

- [ ] **Step 9: Wire `turn-tracking.ts` into `manager.ts`**

```typescript
// src/session/manager.ts — imports: add
import { runTrackedTurn, classifyLifecycleFailure } from './turn-tracking.js'
```

Replace `registerRun` and `runLifecycle` (the pre-Task-3 form; Task 3 will layer `TurnIdleTimeoutError`/`idleTimeoutMs` on top of this same shape):

```typescript
  private registerRun(
    id: string,
    input: StartSessionInput,
    project: ProjectConfig,
    continueBranch: string | null = null,
  ): void {
    const abort = new AbortController()
    const done = this.runLifecycle(id, input, project, abort, continueBranch)
    this.running.set(id, { abort, done })
    void done.finally((): void => {
      this.running.delete(id)
    })
  }

  private async runLifecycle(
    id: string,
    input: StartSessionInput,
    project: ProjectConfig,
    abort: AbortController,
    continueBranch: string | null = null,
  ): Promise<void> {
    const signal = abort.signal
    let prepared: PreparedWorkspace | null = null
    let launched: LaunchedAgent | null = null
    let interruptedByExit = false
    try {
      prepared = await prepareCheckedOutWorkspace(this.workspaceDeps(), id, input, project, continueBranch)
      await restoreStateIfContinuing(this.store, this.sessionState, id, prepared.worktreePath, continueBranch)
      await this.runtime.provision(prepared.worktreePath, project, input.secrets ?? {})
      this.store.setCwd(id, prepared.worktreePath)
      this.store.setBranch(id, prepared.branch)
      this.transition(id, 'preparing')
      if (signal.aborted) {
        throw new Error('aborted')
      }
      launched = await this.runtime.launch(buildLaunchSpec(id, prepared.worktreePath, input))
      await runTrackedTurn(
        this.turnDeps(),
        this.store,
        id,
        launched,
        project,
        prepared,
        input,
        continueBranch,
        abort,
        (): void => {
          interruptedByExit = true
        },
      )
    } catch (error: unknown) {
      const outcome = classifyLifecycleFailure(this.store, id, interruptedByExit, false, signal.aborted)
      if (outcome === 'interrupted') {
        logger.warn({ id }, 'session interrupted: container exited mid-turn')
      } else if (outcome === 'failed') {
        logger.error({ id, error: error instanceof Error ? error.message : String(error) }, 'session failed')
        this.failIfPossible(id)
      }
    } finally {
      await runTeardown(this.store, this.workspace, this.sessionState, id, launched, prepared, project)
      await this.autoFinish(id, project, prepared, input.forgeToken)
    }
  }
```

Remove the now-unused `mcpServersFor`, `resolveResumeId`, `runSessionTurn` imports from `manager.ts` (they're only used inside `turn-tracking.ts`/`lifecycle.ts` now) — keep `buildLaunchSpec`, `prepareCheckedOutWorkspace`, `restoreStateIfContinuing`, `runTeardown` imported from `./lifecycle.js` as before.

- [ ] **Step 10: Run test to verify it passes**

Run: `bun test tests/session/manager.test.ts -t "marks the session interrupted"`
Expected: PASS.

- [ ] **Step 11: Full verification**

Run: `bun run typecheck && bun run lint && bun test --parallel && bun test --parallel && bun test`
Expected: typecheck/lint clean; all three test runs 0 fail (run `--parallel` twice — this codebase has genuine timing bugs that only `--parallel` surfaces, so a single green run is not sufficient signal).

- [ ] **Step 12: Commit**

```bash
git add src/launcher/launcher.ts src/runtime/geofront/geofront-runtime.ts src/session/turn-tracking.ts src/session/manager.ts tests/runtime/geofront/geofront-runtime.test.ts tests/session/manager.test.ts
git commit -m "feat(session): detect container-exit crashes and mark sessions interrupted"
```

---

### Task 3: Idle-timeout watchdog → `interrupted`

**Files:**

- Create: `src/acp/idle-timeout.ts`
- Modify: `src/acp/types.ts:20-25` (`RunAcpSessionOptions.idleTimeoutMs`)
- Modify: `src/acp/client.ts:20-35` (wire `nextUpdateOrTimeout` into `drainUpdates`)
- Modify: `src/session/helpers.ts` (`RunRecordedTurnInput.idleTimeoutMs` threading)
- Modify: `src/session/lifecycle.ts` (`RunTurnDeps.idleTimeoutMs`, `runSessionTurn`)
- Modify: `src/session/manager.ts` (constructor `idleTimeoutMs` param, `turnDeps()`, catch block `idleTimedOut`)
- Modify: `src/main.ts` (`readTurnIdleTimeoutMs()`, threaded into `SessionManager` construction)
- Test: `tests/acp/client.test.ts`, `tests/session/manager.test.ts`

- [ ] **Step 1: Write the failing ACP-client test**

```typescript
// tests/acp/client.test.ts — add inside describe('runAcpSession integration', ...), and
// add `import { TurnIdleTimeoutError } from '../../src/acp/idle-timeout.js'` at the top.
test('idleTimeoutMs rejects with TurnIdleTimeoutError when no ACP activity arrives in time', async (): Promise<void> => {
  tmpDir = mkdtempSync(join(tmpdir(), 'magi-acp-client-'))
  const socketPath = join(tmpDir, 'acp.sock')
  handle = await startStubAgent(socketPath, { hang: true })

  await expect(
    runAcpSession({
      socketPath,
      cwd: process.cwd(),
      prompt: 'do it',
      idleTimeoutMs: 30,
      handlers: {
        onUpdate: (_n: SessionNotification): void => {},
        onPermissionRequest: (_p: RequestPermissionRequest): Promise<RequestPermissionResponse> =>
          Promise.resolve({ outcome: { outcome: 'selected', optionId: 'allow' } }),
        onSessionCreated: (_id: string): void => {},
      },
    }),
  ).rejects.toThrow(TurnIdleTimeoutError)
})
```

(`tmpDir`, `handle`, `mkdtempSync`, `join`, `tmpdir`, `startStubAgent`, `runAcpSession`, `SessionNotification`, `RequestPermissionRequest`, `RequestPermissionResponse` are already declared/imported earlier in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/acp/client.test.ts -t "idleTimeoutMs rejects"`
Expected: FAIL — `Cannot find module '../../src/acp/idle-timeout.js'` and `idleTimeoutMs` is not a known property of `RunAcpSessionOptions`.

- [ ] **Step 3: Create `src/acp/idle-timeout.ts`**

```typescript
import type * as acp from '@agentclientprotocol/sdk'

// Thrown when `idleTimeoutMs` elapses with no ACP update (the hung-but-alive case: the
// container is still running but the agent has stopped talking). Distinguished from a
// plain Error so callers (SessionManager.runLifecycle) can classify this as
// `interrupted` rather than `failed`.
export class TurnIdleTimeoutError extends Error {
  constructor(idleTimeoutMs: number) {
    super(`no ACP activity for ${idleTimeoutMs}ms`)
    this.name = 'TurnIdleTimeoutError'
  }
}

// Races one `session.nextUpdate()` call against an idle timer. The timer is per-call
// (freshly armed and cleared on every `drainUpdates` iteration), so it measures gaps
// *between* updates, not overall turn duration — a long-but-active turn where updates
// keep arriving never trips it. Returns the bare `nextUpdate()` result unchanged when
// `idleTimeoutMs` is undefined (watchdog disabled).
export async function nextUpdateOrTimeout(
  session: acp.ActiveSession,
  idleTimeoutMs: number | undefined,
): Promise<Awaited<ReturnType<acp.ActiveSession['nextUpdate']>>> {
  if (idleTimeoutMs === undefined) {
    return session.nextUpdate()
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject): void => {
    timer = setTimeout((): void => {
      reject(new TurnIdleTimeoutError(idleTimeoutMs))
    }, idleTimeoutMs)
  })
  try {
    return await Promise.race([session.nextUpdate(), timeout])
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Add `idleTimeoutMs` to `RunAcpSessionOptions`**

```typescript
// src/acp/types.ts — inside RunAcpSessionOptions, after `mcpServers?: acp.McpServer[]`
  // Hung-but-alive watchdog: if no ACP update arrives for this many ms, the turn is
  // aborted with a TurnIdleTimeoutError instead of hanging forever. Measured on ACP
  // protocol activity (reset on every update), not overall turn duration. Undefined
  // disables the watchdog.
  idleTimeoutMs?: number
```

- [ ] **Step 5: Wire `nextUpdateOrTimeout` into `client.ts`**

```typescript
// src/acp/client.ts — imports: add
import { nextUpdateOrTimeout } from './idle-timeout.js'
```

```typescript
// src/acp/client.ts — drainUpdates, replace the first line of the function body
async function drainUpdates(
  session: acp.ActiveSession,
  opts: RunAcpSessionOptions,
  promptDone: Promise<acp.PromptResponse>,
  chunks: number,
): Promise<DrainResult> {
  const message = await nextUpdateOrTimeout(session, opts.idleTimeoutMs)
  // ... rest unchanged
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/acp/client.test.ts -t "idleTimeoutMs rejects"`
Expected: PASS.

- [ ] **Step 7: Thread `idleTimeoutMs` from `SessionManager` down to `runAcpSession`**

```typescript
// src/session/helpers.ts — RunRecordedTurnInput, add after `mcpServers: acp.McpServer[]`
  idleTimeoutMs?: number
```

```typescript
// src/session/helpers.ts — inside runRecordedTurn's call to runAcpSession, add
      idleTimeoutMs: input.idleTimeoutMs,
```

```typescript
// src/session/lifecycle.ts — RunTurnDeps, add after `emit: (id: string, kind: MilestoneKind, text: string) => void`
  // Hung-but-alive watchdog threshold; see RunAcpSessionOptions.idleTimeoutMs. Undefined
  // disables the watchdog (e.g. legacy call sites / tests that don't configure one).
  idleTimeoutMs?: number
```

```typescript
// src/session/lifecycle.ts — inside runSessionTurn's call to runRecordedTurn, add
    idleTimeoutMs: deps.idleTimeoutMs,
```

- [ ] **Step 8: Wire `idleTimeoutMs` through `SessionManager`**

```typescript
// src/session/manager.ts — constructor, add a 10th parameter after sessionState
    private readonly sessionState: SessionStateShuttle = new SessionStateShuttle(join(tmpdir(), 'magi-session-state')),
    // Hung-but-alive watchdog threshold; see RunAcpSessionOptions.idleTimeoutMs.
    // Defaults to 10 minutes — generous, measured on ACP protocol activity rather than
    // turn completion (see nextUpdateOrTimeout in acp/client.ts).
    private readonly idleTimeoutMs: number = 600_000,
  ) {}
```

```typescript
// src/session/manager.ts — turnDeps(), add idleTimeoutMs to the returned object
  private turnDeps(): RunTurnDeps {
    return {
      store: this.store,
      permissions: this.permissions,
      makeRecorder: this.makeRecorder,
      transition: this.transition.bind(this),
      emit: this.emit.bind(this),
      idleTimeoutMs: this.idleTimeoutMs,
    }
  }
```

```typescript
// src/session/manager.ts — imports: add
import { TurnIdleTimeoutError } from '../acp/idle-timeout.js'
```

```typescript
// src/session/manager.ts — runLifecycle's catch block: classify idle-timeout as interrupted too
    } catch (error: unknown) {
      const idleTimedOut = error instanceof TurnIdleTimeoutError
      const outcome = classifyLifecycleFailure(this.store, id, interruptedByExit, idleTimedOut, signal.aborted)
      if (outcome === 'interrupted') {
        logger.warn({ id, idleTimedOut }, 'session interrupted: container exited or turn went idle mid-turn')
      } else if (outcome === 'failed') {
        logger.error({ id, error: error instanceof Error ? error.message : String(error) }, 'session failed')
        this.failIfPossible(id)
      }
    } finally {
```

- [ ] **Step 9: Wire a `TURN_IDLE_TIMEOUT_MS` env override in `main.ts`**

```typescript
// src/main.ts — add near readReadyTimeoutMs
// Hung-but-alive turn watchdog (see acp/client.ts nextUpdateOrTimeout). Defaults to 10
// minutes; an unset/invalid override keeps the default rather than disabling the
// watchdog outright (fail-safe: a misconfigured value should not silently remove crash
// recovery).
export function readTurnIdleTimeoutMs(): number {
  const fallback = 600_000
  const raw = process.env['TURN_IDLE_TIMEOUT_MS']
  if (raw === undefined || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
```

```typescript
// src/main.ts — runServe(), thread the value into the SessionManager constructor call as
// its 10th argument (after ctx.sessionState)
      ctx.sessionState,
      readTurnIdleTimeoutMs(),
    ),
```

- [ ] **Step 10: Run the full test suite**

Run: `bun run typecheck && bun run lint && bun test --parallel && bun test --parallel && bun test`
Expected: typecheck/lint clean; all runs 0 fail.

- [ ] **Step 11: Commit**

```bash
git add src/acp/idle-timeout.ts src/acp/types.ts src/acp/client.ts src/session/helpers.ts src/session/lifecycle.ts src/session/manager.ts src/main.ts tests/acp/client.test.ts
git commit -m "feat(acp): add hung-but-alive idle-timeout watchdog that marks sessions interrupted"
```

---

### Task 4: `resumeSession` + `POST /sessions/:id/resume`

**Files:**

- Create: `src/session/finish.ts`
- Create: `src/acp/resume.ts`
- Modify: `src/acp/client.ts` (extract `tryResumeSession`/`runLoadedSession`/`flushInFlightNotifications` into `resume.ts`)
- Modify: `src/session/helpers.ts` (`buildResumePrompt`)
- Modify: `src/session/lifecycle.ts` (`planResume`/`ResumePlan`)
- Modify: `src/session/manager.ts` (`resumeSession` method, `finishSession` delegated to `finish.ts`)
- Modify: `src/server/router.ts` (`POST /sessions/:id/resume`, `handleResume`)
- Test: `tests/session/manager.test.ts`, `tests/server/router.test.ts`

- [ ] **Step 1: Write the failing manager-level tests**

```typescript
// tests/session/manager.test.ts — add inside describe('SessionManager', ...), after the
// existing 'follow-up resumes via the stored lineage acp id' test.
test('resumeSession refuses when the session is unknown, not interrupted, or unbranched', async (): Promise<void> => {
  const manager = makeManager()
  expect(manager.resumeSession('nope', {})).toBeNull()
  const active = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'c', prompt: 'p' })
  expect(manager.resumeSession(active.id, {})).toBeNull()
  await pollTerminal(manager, active.id)
  expect(manager.resumeSession(active.id, {})).toBeNull()
})

test('resumeSession relaunches an interrupted session on its branch and completes', async (): Promise<void> => {
  const sock = join(mkdtempSync(join(tmpdir(), 'magi-resume-exit-')), 'acp.sock')
  let sessionStarted: () => void = (): void => {}
  const sessionStartedPromise = new Promise<void>((resolve): void => {
    sessionStarted = resolve
  })
  const exitingHandle = await startStubAgent(sock, {
    hang: true,
    onNewSession: (): void => {
      sessionStarted()
    },
  })
  let resolveExited: (code: number | null) => void = (): void => {}
  const exited = new Promise<number | null>((resolve): void => {
    resolveExited = resolve
  })
  const resumeLauncher = new StubLauncher({ reply: 'resumed and done' })
  const firstLaunch = (): Promise<LaunchedAgent> =>
    Promise.resolve({ socketPath: sock, shutdown: (): Promise<void> => Promise.resolve(), exited })
  const secondLaunch = (spec: LaunchSpec): Promise<LaunchedAgent> => resumeLauncher.launch(spec)
  let currentLaunch: (spec: LaunchSpec) => Promise<LaunchedAgent> = firstLaunch
  const twoStageRuntime: AgentRuntime = {
    name: 'two-stage',
    provision(_worktreePath: string, _project: ProjectConfig, _secrets: Record<string, string>): Promise<void> {
      return Promise.resolve()
    },
    launch(spec: LaunchSpec): Promise<LaunchedAgent> {
      const launch = currentLaunch
      currentLaunch = secondLaunch
      return launch(spec)
    },
  }
  const store = new SessionStore(new Database(':memory:'))
  const manager = new SessionManager(
    store,
    twoStageRuntime,
    new FakeWorkspace(),
    new PermissionEngine({}),
    demoDefaults(),
    stubForgeProvider,
    new NoopNotifier(),
  )
  const parent = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'c', prompt: 'first' })
  await sessionStartedPromise
  resolveExited(1)
  const interruptedStatus = await pollStatus(manager, parent.id, 'interrupted')
  expect(interruptedStatus).toBe('interrupted')
  const parentBranch = manager.getSession(parent.id)!.branch
  const child = manager.resumeSession(parent.id, { forgeToken: 'tok' })
  expect(child).not.toBeNull()
  expect(child!.parentSessionId).toBe(parent.id)
  expect(await pollTerminal(manager, child!.id)).toBe('done')
  const doneChild = manager.getSession(child!.id)!
  expect(doneChild.branch).toBe(parentBranch)
  await exitingHandle.close()
})
```

`StubLauncher` needs a new import: `import { StubLauncher } from '../../src/launcher/stub.js'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/session/manager.test.ts -t "resumeSession"`
Expected: FAIL — `manager.resumeSession is not a function`.

- [ ] **Step 3: Add `buildResumePrompt` to `helpers.ts`**

```typescript
// src/session/helpers.ts — add right before authFrom (uses the existing `clip` helper
// already defined earlier in this file for buildFollowUpPrompt)
// Standard "continue the interrupted work" prompt for resumeSession. Unlike
// buildFollowUpPrompt, no new task text is needed: session/load restores the
// conversation itself, so this only needs to nudge the agent to pick back up.
export function buildResumePrompt(parent: Session): string {
  const pr = parent.prUrl === null ? '' : ` (PR: ${parent.prUrl})`
  const outcome =
    parent.lastMessage !== null && parent.lastMessage.length > 0
      ? parent.lastMessage
      : '(no prior outcome recorded before the interruption)'
  return [
    `Your previous session on branch \`${parent.branch ?? 'unknown'}\`${pr} was interrupted mid-turn (container exit or hang).`,
    `Prior task: ${clip(parent.prompt)}`,
    `Last known state: ${clip(outcome)}`,
    '',
    'Resume where you left off and continue the task to completion.',
  ].join('\n')
}
```

- [ ] **Step 4: Add `planResume` to `lifecycle.ts`**

```typescript
// src/session/lifecycle.ts — imports: extend the helpers.js import and add ResumeCredentials
import {
  authFrom,
  buildFollowUpPrompt,
  buildResumePrompt,
  mcpLaunchConfigs,
  runRecordedTurn,
  teardownSession,
} from './helpers.js'
import { lineageIdOf } from './lineage.js'
import type { SessionStateShuttle } from './session-state.js'
import type { FollowUpSessionInput, ResumeCredentials, Session, SessionStatus, StartSessionInput } from './state.js'
```

```typescript
// src/session/lifecycle.ts — add right after planFollowUp/FollowUpPlan
export interface ResumePlan {
  createInput: CreateSessionInput
  startInput: StartSessionInput
}

// Mirrors planFollowUp, but for resuming an interrupted session: no new prompt
// text is supplied by the caller (session/load restores the conversation), so
// the continuation prompt is the fixed "continue the interrupted work" text
// from buildResumePrompt rather than a user-supplied newPrompt.
export function planResume(
  parent: Session,
  projectSpec: ProjectSpec,
  childId: string,
  credentials: ResumeCredentials,
  idempotencyKey?: string,
): ResumePlan {
  return {
    createInput: {
      id: childId,
      project: parent.project,
      agent: parent.agent,
      contextId: parent.contextId,
      prompt: parent.prompt,
      cwd: '',
      projectSpec,
      parentSessionId: parent.id,
      idempotencyKey: idempotencyKey ?? null,
    },
    startInput: {
      projectSpec,
      agent: parent.agent,
      contextId: parent.contextId,
      prompt: buildResumePrompt(parent),
      secrets: credentials.secrets,
      forgeToken: credentials.forgeToken,
      mcpTokens: credentials.mcpTokens,
    },
  }
}
```

Note: `createInput.idempotencyKey` and `CreateSessionInput.idempotencyKey` are Task 5 concerns — Task 5 adds the `idempotencyKey?: string | null` field to `CreateSessionInput` (`src/session/store.ts`). Write `planResume` and `planFollowUp` with `idempotencyKey` fields now (as shown) since both plans are touched again in Task 5 anyway and splitting the field addition across two tasks would require a second edit to the same lines; typecheck will fail until Task 5 adds the field to `CreateSessionInput`, so **do Task 5's `CreateSessionInput.idempotencyKey` step (Task 5 Step 3) immediately after this step, before running typecheck**, or omit the `idempotencyKey` lines here and add them fresh in Task 5. This plan keeps them together in Task 5's diff — see Task 5 Step 3 for the exact `CreateSessionInput` change; if executing tasks strictly in order, add `idempotencyKey: null,` as a literal (not `idempotencyKey ?? null`) in this step's `planFollowUp`/`planResume` bodies and revisit in Task 5, OR run Task 5 Step 3 first. **This plan's canonical order is Task 4 before Task 5 as numbered**, so for Task 4 alone, write `planResume`/`planFollowUp`'s `createInput` WITHOUT the `idempotencyKey` field, and Task 5 Step 6 adds it to both.

- [ ] **Step 5: Add `resumeSession` to `SessionManager`**

```typescript
// src/session/manager.ts — imports: add ResumeCredentials to the state.js type import,
// and planResume to the lifecycle.js import
import {
  buildLaunchSpec,
  planFollowUp,
  planResume,
  prepareCheckedOutWorkspace,
  restoreStateIfContinuing,
  runTeardown,
} from './lifecycle.js'
import type { PrepareWorkspaceDeps, RunTurnDeps } from './lifecycle.js'
import { SessionStateShuttle } from './session-state.js'
import { CONTINUABLE, RESUMABLE, canTransition, filterToStatuses } from './state.js'
import type {
  FinishSessionInput,
  FollowUpSessionInput,
  ResumeCredentials,
  Session,
  SessionFilter,
  SessionStatus,
  StartSessionInput,
} from './state.js'
```

```typescript
// src/session/manager.ts — add resumeSession right after followUpSession
  resumeSession(sessionId: string, credentials: ResumeCredentials, idempotencyKey?: string): Session | null {
    const parent = this.store.get(sessionId)
    if (parent === null || parent.branch === null || parent.projectSpec === null) {
      logger.warn({ sessionId }, 'resume refused: session missing, unbranched, or specless')
      return null
    }
    if (!RESUMABLE.has(parent.status)) {
      logger.warn({ sessionId, status: parent.status }, 'resume refused: session is not interrupted')
      return null
    }
    const id = newId()
    const project = buildEphemeralProject(parent.projectSpec, this.defaults)
    const { createInput, startInput } = planResume(parent, parent.projectSpec, id, credentials, idempotencyKey)
    this.store.create(createInput)
    if (parent.prUrl !== null) {
      this.store.setPrUrl(id, parent.prUrl)
    }
    if (parent.prNumber !== null) {
      this.store.setPrNumber(id, parent.prNumber)
    }
    this.registerRun(id, startInput, project, parent.branch)
    return this.store.get(id)
  }
```

(This inline form — not yet extracted into `continuation.ts` — is intentional for this task; Task 5 refactors both `followUpSession` and `resumeSession` into `continuation.ts` once the dedupe logic makes `manager.ts` too long to keep them inline. Writing the inline version first keeps this task's diff reviewable on its own.)

`idempotencyKey` is accepted as a parameter here but unused until Task 5 (typecheck will flag an unused parameter only if `noUnusedParameters` is on — this codebase's `tsgo --noEmit` does not enable that rule for constructor/method params prefixed without `_`, but to be safe and to keep this task green in isolation, name it `_idempotencyKey` in this step and rename to `idempotencyKey` in Task 5 when `runResume`'s dedupe check is introduced).

- [ ] **Step 6: Extract `finishSession` into `src/session/finish.ts`**

`manager.ts` crosses the 300-line `max-lines` cap once `resumeSession` is added inline. Extract `finishSession`'s body (the largest remaining method) into a new file using this codebase's established deps-object + free-function pattern (see `src/session/auto-finish.ts`'s `AutoFinishDeps`/`runAutoFinish` for the precedent).

```typescript
// src/session/finish.ts (new file)
import type { ForgeProvider } from '../forge/provider.js'
import { logger } from '../logger.js'
import type { ProjectDefaults } from '../project/config.js'
import type { WorkspaceManager } from '../workspace/workspace.js'
import { openPullRequest } from './auto-publish.js'
import { authFrom, resolveProjectFor, safeCleanup } from './helpers.js'
import { canTransition } from './state.js'
import type { FinishSessionInput, Session, SessionStatus } from './state.js'
import type { SessionStore } from './store.js'

export interface FinishSessionDeps {
  store: SessionStore
  workspace: WorkspaceManager
  forges: ForgeProvider
  defaults: ProjectDefaults
  transition: (id: string, to: SessionStatus) => void
  emit: (id: string, kind: 'done', text: string) => void
  failIfPossible: (id: string) => void
}

export async function finishSession(
  deps: FinishSessionDeps,
  id: string,
  input: FinishSessionInput,
): Promise<Session | null> {
  const session = deps.store.get(id)
  if (session === null || session.branch === null) {
    return session
  }
  const project = resolveProjectFor(session, deps.defaults)
  if (project === null) {
    logger.warn({ id, project: session.project }, 'cannot finish: project spec missing from session')
    return session
  }
  if (!canTransition(session.status, 'finishing')) {
    logger.warn({ id, status: session.status }, 'cannot finish from current status')
    return session
  }
  const prepared = { worktreePath: session.cwd, branch: session.branch, repoUrl: project.repoUrl }
  deps.transition(id, 'finishing')
  try {
    await deps.workspace.finish(prepared, input.message, authFrom(project, input.forgeToken))
    if (input.action === 'pr' && session.prUrl === null) {
      const head = session.branch
      const title = input.title ?? session.prompt
      const body = input.body ?? ''
      const token = input.forgeToken ?? ''
      await openPullRequest(deps.forges, deps.store, project, id, head, title, body, token)
    }
    deps.transition(id, 'done')
    const s = deps.store.get(id)
    deps.emit(id, 'done', s !== null && s.prUrl !== null ? `PR ready: ${s.prUrl}` : 'session finished')
  } catch (error: unknown) {
    logger.error({ id, error: error instanceof Error ? error.message : String(error) }, 'finish failed')
    deps.failIfPossible(id)
  } finally {
    await safeCleanup(id, deps.workspace, prepared, project)
  }
  return deps.store.get(id)
}
```

```typescript
// src/session/manager.ts — imports: add
import { finishSession } from './finish.js'
```

```typescript
// src/session/manager.ts — replace the finishSession method body
  finishSession(id: string, input: FinishSessionInput): Promise<Session | null> {
    return finishSession(
      {
        store: this.store,
        workspace: this.workspace,
        forges: this.forges,
        defaults: this.defaults,
        transition: this.transition.bind(this),
        emit: this.emit.bind(this),
        failIfPossible: this.failIfPossible.bind(this),
      },
      id,
      input,
    )
  }
```

Remove the now-unused `authFrom`, `openPullRequest` imports from `manager.ts` (only `finish.ts` uses them now); keep `resolveProjectFor`, `safeCleanup`, `newId` imported from `./helpers.js` (still used by `cancelSession`/`followUpSession`/`resumeSession`).

- [ ] **Step 7: Run typecheck to confirm `manager.ts` is under the line cap**

Run: `wc -l src/session/manager.ts && bun run lint`
Expected: under 300 lines; lint 0 errors. If still over, this is a design signal per CLAUDE.md — do not compress formatting to game the limit; if it recurs, extract `resumeSession`'s body the same way `finishSession`'s was (mirroring `finish.ts`'s deps-object pattern) rather than shrinking whitespace.

- [ ] **Step 8: Extract `tryResumeSession` out of `client.ts` if it is still over budget**

Adding `nextUpdateOrTimeout` (Task 3) plus any further comment growth can push `client.ts` over 300 lines too. Move `tryResumeSession`, `runLoadedSession`, and `flushInFlightNotifications` verbatim into a new `src/acp/resume.ts` (confirm via `grep -rn "runLoadedSession\|flushInFlightNotifications\|tryResumeSession" src/` that none of these three are referenced anywhere outside `client.ts` before moving, so the extraction is safe):

```typescript
// src/acp/resume.ts (new file)
import * as acp from '@agentclientprotocol/sdk'

import { logger } from '../logger.js'
import { summarizePrompt } from './turn-diagnostics.js'
import type { RunAcpSessionOptions } from './types.js'

/**
 * Waits for one macrotask tick.
 *
 * The SDK's connection dispatches `session/update` notifications through a
 * multi-handler async chain (each registered `.onRequest`/`.onNotification`
 * handler is awaited in turn to find a match), while request *responses*
 * resolve their pending promise synchronously via a separate, much shorter
 * path. Empirically, this means a notification sent by the agent strictly
 * before a request's response (e.g. history replayed during `session/load`,
 * sent before the agent returns its `session/load` response) can still reach
 * our notification handler *after* the corresponding `cx.request(...)` call
 * has already resolved on our side — the notification is "in flight" through
 * more ticks than the response needs. A single macrotask tick reliably drains
 * that in-flight dispatch because it only needs a handful of microtask ticks,
 * while the very next real protocol step (`session/prompt`) requires a full
 * socket round trip to the agent and back — orders of magnitude slower.
 */
function flushInFlightNotifications(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/**
 * Resumes a prior session via the low-level `session/load` + `session/prompt`
 * requests. `ActiveSession` (from `cx.buildSession(...)`) only exists for
 * `session/new`, so a loaded session must be driven manually and its updates
 * collected via the `session/update` notification handler registered in
 * `runAcpSession`.
 *
 * `loaded.active` is set only after `session/load` resolves (and any
 * in-flight notification dispatch from it has drained, see
 * `flushInFlightNotifications`) so that any history the agent replays as
 * `session/update` notifications during load is not forwarded to
 * `opts.handlers.onUpdate` (and thus not accumulated into this turn's
 * answer) — only updates from the new prompt are.
 */
async function runLoadedSession(
  cx: acp.ClientContext,
  opts: RunAcpSessionOptions,
  sessionId: string,
  loaded: { active: boolean },
): Promise<acp.PromptResponse> {
  await cx.request(acp.methods.agent.session.load, { sessionId, cwd: opts.cwd, mcpServers: opts.mcpServers ?? [] })
  await flushInFlightNotifications()
  loaded.active = true
  opts.handlers.onSessionCreated(sessionId)
  logger.debug({ sessionId, prompt: summarizePrompt(opts.prompt) }, 'resuming via session/load')
  const response = await cx.request(acp.methods.agent.session.prompt, {
    sessionId,
    prompt: [{ type: 'text', text: opts.prompt }],
  })
  logger.info(
    { sessionId, stopReason: response.stopReason, usage: response.usage },
    'acp resumed prompt turn completed',
  )
  return response
}

/**
 * Attempts to resume via `session/load` when `opts.resumeSessionId` is set
 * and the agent advertises the `loadSession` capability. Returns `undefined`
 * (rather than throwing) whenever resume isn't possible or fails, so the
 * caller can fall back to a fresh `session/new` on the same connection:
 * capability missing, or `session/load`/the resumed `session/prompt`
 * rejected (e.g. a stale/evicted ephemeral session on the agent side).
 *
 * On a failed load-and-prompt attempt, `loaded.active` is reset to `false`
 * so the resume-only `session/update` notification handler (registered in
 * `buildClientApp`) goes inert and the `buildSession(...)` fallback's
 * `ActiveSession` becomes the sole source of updates for this turn.
 */
export async function tryResumeSession(
  cx: acp.ClientContext,
  opts: RunAcpSessionOptions,
  resumeSessionId: string,
  loadSessionCapable: boolean,
  loaded: { active: boolean },
): Promise<acp.PromptResponse | undefined> {
  if (!loadSessionCapable) {
    logger.warn(
      { sessionId: resumeSessionId },
      'agent does not advertise loadSession capability; falling back to a new session',
    )
    return undefined
  }

  try {
    return await runLoadedSession(cx, opts, resumeSessionId, loaded)
  } catch (error: unknown) {
    logger.warn(
      { sessionId: resumeSessionId, error: error instanceof Error ? error.message : String(error) },
      'session/load failed; falling back to a new session',
    )
    loaded.active = false
    return undefined
  }
}
```

```typescript
// src/acp/client.ts — imports: add, and delete the three moved function bodies
import { tryResumeSession } from './resume.js'
```

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test tests/session/manager.test.ts -t "resumeSession"`
Expected: PASS, both tests.

- [ ] **Step 10: Write the failing router tests**

```typescript
// tests/server/router.test.ts — add a helper near the existing deps() function
function depsWithStore(): { d: ServerDeps; store: SessionStore } {
  const store = new SessionStore(new Database(':memory:'))
  const defaults = demoDefaults()
  const runtime = new StubRuntime()
  const ws = new FakeWorkspace()
  const perms = new PermissionEngine({})
  const notifier = new NoopNotifier()
  const manager = new SessionManager(store, runtime, ws, perms, defaults, stubForgeProvider, notifier)
  return {
    d: {
      manager,
      policy: DEMO_POLICY,
      defaults,
      token: 'secret',
      rateLimiter: permissiveLimiter,
      hub: new SessionHub(),
    },
    store,
  }
}
```

```typescript
// tests/server/router.test.ts — add a new describe block after describe('POST /sessions/:id/follow-up', ...)
describe('POST /sessions/:id/resume', (): void => {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  function requireString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new Error('expected a string field')
    }
    return value
  }

  async function bodyOf(res: Response): Promise<Record<string, unknown>> {
    const parsed: unknown = await res.json()
    if (!isRecord(parsed)) {
      throw new Error('expected a JSON object body')
    }
    return parsed
  }

  async function waitForBranch(handler: ReturnType<typeof createFetchHandler>, id: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const res = await handler(req('GET', `/sessions/${id}`))
      const session = await bodyOf(res)
      if (session['branch'] !== null) {
        return
      }
      await Bun.sleep(10)
    }
    throw new Error(`session ${id} never got a branch`)
  }

  test('happy path: creates a child session on an interrupted parent', async (): Promise<void> => {
    const { d, store } = depsWithStore()
    const handler = createFetchHandler(d)
    const startRes = await handler(req('POST', '/sessions', { projectSpec: demoSpec(), contextId: 'c', prompt: 'p' }))
    const parentId = requireString((await bodyOf(startRes))['id'])
    await waitForBranch(handler, parentId)
    store.updateStatus(parentId, 'interrupted')

    const res = await handler(req('POST', `/sessions/${parentId}/resume`, { credentials: { forgeToken: 'tok' } }))
    expect(res.status).toBe(202)
    const body = await bodyOf(res)
    expect(body['parentSessionId']).toBe(parentId)
    expect(body['id']).not.toBe(parentId)
  })

  test('resume of a non-interrupted session returns 409', async (): Promise<void> => {
    const handler = createFetchHandler(deps())
    const startRes = await handler(req('POST', '/sessions', { projectSpec: demoSpec(), contextId: 'c', prompt: 'p' }))
    const parentId = requireString((await bodyOf(startRes))['id'])
    await waitForBranch(handler, parentId)

    const res = await handler(req('POST', `/sessions/${parentId}/resume`, {}))
    expect(res.status).toBe(409)
  })

  test('resume of an unknown session returns 404', async (): Promise<void> => {
    const handler = createFetchHandler(deps())
    const res = await handler(req('POST', '/sessions/nope/resume', {}))
    expect(res.status).toBe(404)
  })
})
```

(`req`, `demoSpec`, `demoDefaults`, `StubRuntime`, `FakeWorkspace`, `PermissionEngine`, `NoopNotifier`, `SessionHub`, `DEMO_POLICY`, `permissiveLimiter`, `stubForgeProvider`, `Database`, `SessionStore`, `SessionManager`, `createFetchHandler`, `ServerDeps` are already imported/defined earlier in this test file.)

- [ ] **Step 11: Run tests to verify they fail**

Run: `bun test tests/server/router.test.ts -t "POST /sessions/:id/resume"`
Expected: FAIL — 404 for all three (no `resume` route registered).

- [ ] **Step 12: Add the `resume` route and `handleResume` to `router.ts`**

```typescript
// src/server/router.ts — inside handleSessionScoped, after the follow-up branch
if (request.method === 'POST' && action === 'resume') {
  return handleResume(deps, request, id)
}
```

```typescript
// src/server/router.ts — new function, add after handleFollowUp
async function handleResume(deps: ServerDeps, request: Request, id: string): Promise<Response> {
  const parent = deps.manager.getSession(id)
  if (parent === null) {
    return json({ error: 'not found' }, 404)
  }
  if (!deps.rateLimiter.check(parent.contextId)) {
    return json({ error: 'rate limit exceeded; try again later' }, 429)
  }
  if (parent.projectSpec === null) {
    return json({ error: 'session has no projectSpec' }, 409)
  }
  try {
    validateRepoSpec(parent.projectSpec, deps.policy)
  } catch (error: unknown) {
    return json({ error: error instanceof Error ? error.message : 'invalid projectSpec' }, 400)
  }
  const body = await readBody(request)
  const rawCredentials = body['credentials']
  const credentials = isRecord(rawCredentials) ? rawCredentials : {}
  const idempotencyKey = asString(body['idempotencyKey']) ?? undefined
  const child = deps.manager.resumeSession(
    id,
    {
      secrets: asStringRecord(credentials['secrets']),
      forgeToken: asString(credentials['forgeToken']) ?? undefined,
      mcpTokens: asStringRecord(credentials['mcpTokens']),
    },
    idempotencyKey,
  )
  if (child === null) {
    return json({ error: 'session cannot be resumed (not interrupted or unbranched)' }, 409)
  }
  return json({ id: child.id, status: child.status, parentSessionId: child.parentSessionId }, 202)
}
```

`isRecord` already exists in `router.ts` (used by `readBody`) — reuse it, do not redefine.

- [ ] **Step 13: Run tests to verify they pass**

Run: `bun test tests/server/router.test.ts -t "POST /sessions/:id/resume"`
Expected: PASS, all 3 tests.

- [ ] **Step 14: Full verification**

Run: `bun run typecheck && bun run lint && bun test --parallel && bun test --parallel && bun test --parallel && bun test`
Expected: typecheck/lint clean; 0 fail across all 4 runs (3×`--parallel` + 1 plain — this task's two-stage-runtime test double is exactly the kind of timing-sensitive code this repo has previously found real `--parallel`-only bugs in).

- [ ] **Step 15: Commit**

```bash
git add src/session/finish.ts src/acp/resume.ts src/acp/client.ts src/session/helpers.ts src/session/lifecycle.ts src/session/manager.ts src/server/router.ts tests/session/manager.test.ts tests/server/router.test.ts
git commit -m "feat(session): add resumeSession and POST /sessions/:id/resume"
```

---

### Task 5: `idempotencyKey` dedupe on `follow-up` and `resume`

**Files:**

- Modify: `src/session/state.ts` (`Session.idempotencyKey`, `FollowUpSessionInput.idempotencyKey`)
- Create: `src/session/store-row.ts`
- Modify: `src/session/store.ts` (`idempotency_key` column + migration, `CreateSessionInput.idempotencyKey`, `findChildByIdempotencyKey`)
- Create: `src/session/continuation.ts`
- Modify: `src/session/manager.ts` (refactor `followUpSession`/`resumeSession` onto `continuation.ts`)
- Modify: `src/session/lifecycle.ts` (`planFollowUp`/`planResume` write `idempotencyKey` into `createInput`)
- Modify: `src/server/router.ts` (`idempotencyKey` on `handleFollowUp`)
- Test: `tests/session/store.test.ts`, `tests/session/manager.test.ts`, `tests/session/helpers.test.ts`, `tests/session/lifecycle.test.ts`

- [ ] **Step 1: Write the failing store-level tests**

```typescript
// tests/session/store.test.ts — add inside describe('SessionStore', ...)
test('new sessions default idempotencyKey to null', (): void => {
  const store = new SessionStore(new Database(':memory:'))
  const s = store.create({
    id: 's1',
    project: 'p',
    agent: 'codex',
    contextId: 'c',
    prompt: 'hi',
    cwd: '',
    projectSpec: DEMO_SPEC,
  })
  expect(s.idempotencyKey).toBeNull()
})

test('idempotencyKey persists and round-trips', (): void => {
  const store = new SessionStore(new Database(':memory:'))
  const s = store.create({
    id: 's1',
    project: 'p',
    agent: 'codex',
    contextId: 'c',
    prompt: 'hi',
    cwd: '',
    projectSpec: DEMO_SPEC,
    idempotencyKey: 'task-1:note:42',
  })
  expect(s.idempotencyKey).toBe('task-1:note:42')
  expect(store.get('s1')!.idempotencyKey).toBe('task-1:note:42')
})

test('findChildByIdempotencyKey finds a matching child and ignores other parents/keys', (): void => {
  const store = new SessionStore(new Database(':memory:'))
  store.create({ id: 'p1', project: 'p', agent: 'a', contextId: 'c', prompt: 'x', cwd: '', projectSpec: DEMO_SPEC })
  store.create({
    id: 'c1',
    project: 'p',
    agent: 'a',
    contextId: 'c',
    prompt: 'y',
    cwd: '',
    projectSpec: DEMO_SPEC,
    parentSessionId: 'p1',
    idempotencyKey: 'key-1',
  })
  expect(store.findChildByIdempotencyKey('p1', 'key-1')?.id).toBe('c1')
  expect(store.findChildByIdempotencyKey('p1', 'key-2')).toBeNull()
  expect(store.findChildByIdempotencyKey('other-parent', 'key-1')).toBeNull()
})

test('migration adds idempotency_key to a legacy table', (): void => {
  const db = new Database(':memory:')
  db.run('CREATE TABLE sessions (id TEXT PRIMARY KEY, context_id TEXT)')
  const store = new SessionStore(db)
  const columns = db.query<{ name: string }, []>('PRAGMA table_info(sessions)').all()
  expect(columns.some((c): boolean => c.name === 'idempotency_key')).toBe(true)
  void store
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/session/store.test.ts -t "idempotencyKey"`
Expected: FAIL — `Property 'idempotencyKey' does not exist` / `store.findChildByIdempotencyKey is not a function`.

- [ ] **Step 3: Add `idempotencyKey` to `Session` and `FollowUpSessionInput` in `state.ts`**

```typescript
// src/session/state.ts — Session interface, add after resumeState: ResumeState
idempotencyKey: string | null
```

```typescript
// src/session/state.ts — FollowUpSessionInput, add after mcpTokens?: Record<string, string>
  idempotencyKey?: string
```

- [ ] **Step 4: Split `SessionRow`/`rowToSession` out of `store.ts` into `src/session/store-row.ts`**

Adding the `idempotency_key` column plumbing pushes `store.ts` over the 300-line cap. Extract the row-shape parsing (already the largest self-contained block in the file) into its own module first.

```typescript
// src/session/store-row.ts (new file)
import { isSpecAgent, parseForge } from '../project/config.js'
import type { ProjectSpec } from '../project/config.js'
import type { ResumeState, Session, SessionStatus } from './state.js'

export interface SessionRow {
  id: string
  project: string
  agent: string
  context_id: string
  status: string
  prompt: string
  cwd: string
  branch: string | null
  pr_url: string | null
  pr_number: number | null
  last_message: string | null
  exit_code: number | null
  created_at: string
  updated_at: string
  project_spec: string | null
  parent_session_id: string | null
  acp_session_id: string | null
  resume_state: string
  idempotency_key: string | null
}

function readField(parsed: unknown, field: string): unknown {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  if (!(field in parsed)) return undefined
  return (parsed as Partial<Record<string, unknown>>)[field]
}

function readStringField(parsed: unknown, field: string): string {
  const val = readField(parsed, field)
  return typeof val === 'string' ? val : ''
}

function parseProjectSpec(raw: string): ProjectSpec {
  const parsed: unknown = JSON.parse(raw)
  const name = readStringField(parsed, 'name')
  const repoUrl = readStringField(parsed, 'repoUrl')
  const baseBranch = readStringField(parsed, 'baseBranch')
  const preset = readStringField(parsed, 'permissionPreset')
  const permissionPreset: ProjectSpec['permissionPreset'] =
    preset === 'autonomous' || preset === 'cautious' || preset === 'readonly' ? preset : 'cautious'
  const agentRaw = readStringField(parsed, 'agent')
  const agent: ProjectSpec['agent'] = isSpecAgent(agentRaw) ? agentRaw : 'claude'
  const forge = parseForge(readField(parsed, 'forge'))
  const providerHostRaw = readStringField(parsed, 'providerHost')
  const providerHost = providerHostRaw.length > 0 ? providerHostRaw : undefined
  const modelRaw = readStringField(parsed, 'model')
  const model = modelRaw.length > 0 ? modelRaw : undefined
  return { name, repoUrl, baseBranch, permissionPreset, agent, forge, providerHost, model }
}

function toResumeState(value: string): ResumeState {
  return value === 'reaped' ? 'reaped' : 'live'
}

export function isSessionStatus(value: string): value is SessionStatus {
  return (
    value === 'queued' ||
    value === 'preparing' ||
    value === 'running' ||
    value === 'waiting_permission' ||
    value === 'waiting_input' ||
    value === 'finishing' ||
    value === 'done' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'interrupted'
  )
}

export function rowToSession(row: SessionRow): Session {
  const status = row.status
  if (!isSessionStatus(status)) {
    throw new Error(`Unknown session status: ${status}`)
  }
  const projectSpec: ProjectSpec | null = row.project_spec === null ? null : parseProjectSpec(row.project_spec)
  return {
    id: row.id,
    project: row.project,
    agent: row.agent,
    contextId: row.context_id,
    status,
    prompt: row.prompt,
    cwd: row.cwd,
    branch: row.branch,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    lastMessage: row.last_message,
    exitCode: row.exit_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectSpec,
    parentSessionId: row.parent_session_id,
    acpSessionId: row.acp_session_id,
    resumeState: toResumeState(row.resume_state),
    idempotencyKey: row.idempotency_key,
  }
}
```

```typescript
// src/session/store.ts — imports, replace the top of the file
import type { Database } from 'bun:sqlite'

import type { ProjectSpec } from '../project/config.js'
import type { ResumeState, Session, SessionStatus } from './state.js'
import { rowToSession } from './store-row.js'
import type { SessionRow } from './store-row.js'
```

Delete the `SessionRow` interface, `readField`/`readStringField`/`parseProjectSpec`/`toResumeState`/`isSessionStatus`/`rowToSession` definitions from `store.ts` — they now live in `store-row.ts`.

- [ ] **Step 5: Add the `idempotency_key` column, migration, `CreateSessionInput.idempotencyKey`, and `findChildByIdempotencyKey` to `store.ts`**

```typescript
// src/session/store.ts — CreateSessionInput, add after parentSessionId?: string | null
export interface CreateSessionInput {
  id: string
  project: string
  agent: string
  contextId: string
  prompt: string
  cwd: string
  projectSpec: ProjectSpec
  parentSessionId?: string | null
  idempotencyKey?: string | null
}
```

```typescript
// src/session/store.ts — InsertParams, add after $parentSessionId
type InsertParams = {
  $id: string
  $project: string
  $agent: string
  $contextId: string
  $status: string
  $prompt: string
  $cwd: string
  $createdAt: string
  $updatedAt: string
  $projectSpec: string | null
  $parentSessionId: string | null
  $idempotencyKey: string | null
}
```

```typescript
// src/session/store.ts — constructor migrations array, add a new entry
      ['pr_number', 'pr_number INTEGER'],
      ['idempotency_key', 'idempotency_key TEXT'],
    ]
```

```typescript
// src/session/store.ts — create(), update the INSERT statement and its params
  create(input: CreateSessionInput): Session {
    const now = new Date().toISOString()
    this.db
      .query<unknown, InsertParams>(
        `INSERT INTO sessions (id, project, agent, context_id, status, prompt, cwd, branch, pr_url, exit_code, created_at, updated_at, project_spec, parent_session_id, idempotency_key)
         VALUES ($id, $project, $agent, $contextId, $status, $prompt, $cwd, NULL, NULL, NULL, $createdAt, $updatedAt, $projectSpec, $parentSessionId, $idempotencyKey)`,
      )
      .run({
        $id: input.id,
        $project: input.project,
        $agent: input.agent,
        $contextId: input.contextId,
        $status: 'queued',
        $prompt: input.prompt,
        $cwd: input.cwd,
        $createdAt: now,
        $updatedAt: now,
        $projectSpec: JSON.stringify(input.projectSpec),
        $parentSessionId: input.parentSessionId ?? null,
        $idempotencyKey: input.idempotencyKey ?? null,
      })
    const row = this.db
      .query<SessionRow, SelectByIdParams>('SELECT * FROM sessions WHERE id = $id')
      .get({ $id: input.id })
    if (row === null) {
      throw new Error(`Session ${input.id} not found after insert`)
    }
    return rowToSession(row)
  }
```

```typescript
// src/session/store.ts — add a new method, after setExit
  findChildByIdempotencyKey(parentId: string, key: string): Session | null {
    const row = this.db
      .query<SessionRow, { $parentId: string; $key: string }>(
        'SELECT * FROM sessions WHERE parent_session_id = $parentId AND idempotency_key = $key LIMIT 1',
      )
      .get({ $parentId: parentId, $key: key })
    if (row === null) {
      return null
    }
    return rowToSession(row)
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/session/store.test.ts -t "idempotencyKey" && bun test tests/session/store.test.ts -t "migration adds idempotency_key"`
Expected: PASS.

- [ ] **Step 7: Fix the now-failing `Session`-literal test fixtures**

`Session.idempotencyKey` being required breaks every hand-built `Session` object literal in tests that don't spread from a real store row.

```typescript
// tests/session/helpers.test.ts — makeSession()'s default overrides object, add after resumeState: 'live'
    idempotencyKey: null,
```

```typescript
// tests/session/lifecycle.test.ts — the local Session-builder helper, add after resumeState: 'live'
      idempotencyKey: null,
```

Run: `bun test tests/session/helpers.test.ts tests/session/lifecycle.test.ts`
Expected: PASS (these files' pre-existing tests, now with the added field, unaffected in behavior).

- [ ] **Step 8: Write the failing dedupe-behavior tests**

```typescript
// tests/session/manager.test.ts — add inside describe('SessionManager', ...), right before
// the existing 'shuttles agent state from a parent turn into a follow-up worktree' test
// (i.e. immediately after 'followUpSession creates a child that reuses branch + prUrl...').
test('followUpSession with a repeated idempotencyKey returns the already-minted child, even after the parent leaves CONTINUABLE', async (): Promise<void> => {
  const store = new SessionStore(new Database(':memory:'))
  const manager = new SessionManager(
    store,
    new StubRuntime({ reply: 'done' }),
    new FakeWorkspace(),
    new PermissionEngine({}),
    demoDefaults(),
    stubForgeProvider,
    new NoopNotifier(),
  )
  const parent = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'c', prompt: 'first' })
  await pollTerminal(manager, parent.id)
  const first = manager.followUpSession(parent.id, {
    parentSessionId: parent.id,
    prompt: 'second',
    idempotencyKey: 'retry-key',
  })
  expect(first).not.toBeNull()
  // Force the parent out of CONTINUABLE to prove the dedupe check runs
  // before the status gate, so a retried dispatch still wins.
  store.updateStatus(parent.id, 'running')
  const second = manager.followUpSession(parent.id, {
    parentSessionId: parent.id,
    prompt: 'second',
    idempotencyKey: 'retry-key',
  })
  expect(second).not.toBeNull()
  expect(second!.id).toBe(first!.id)
  await pollTerminal(manager, first!.id)
})
```

```typescript
// tests/session/manager.test.ts — add right after the existing 'resumeSession relaunches
// an interrupted session on its branch and completes' test, before 'startSession with
// prNumber checks out the PR head branch...'.
test('resumeSession with a repeated idempotencyKey returns the same child without relaunching', async (): Promise<void> => {
  const sock = join(mkdtempSync(join(tmpdir(), 'magi-resume-dedupe-')), 'acp.sock')
  let sessionStarted: () => void = (): void => {}
  const sessionStartedPromise = new Promise<void>((resolve): void => {
    sessionStarted = resolve
  })
  const exitingHandle = await startStubAgent(sock, {
    hang: true,
    onNewSession: (): void => {
      sessionStarted()
    },
  })
  let resolveExited: (code: number | null) => void = (): void => {}
  const exited = new Promise<number | null>((resolve): void => {
    resolveExited = resolve
  })
  const resumeLauncher = new StubLauncher({ reply: 'resumed and done' })
  let launches = 0
  const firstLaunch = (): Promise<LaunchedAgent> =>
    Promise.resolve({ socketPath: sock, shutdown: (): Promise<void> => Promise.resolve(), exited })
  const secondLaunch = (spec: LaunchSpec): Promise<LaunchedAgent> => resumeLauncher.launch(spec)
  let currentLaunch: (spec: LaunchSpec) => Promise<LaunchedAgent> = firstLaunch
  const twoStageRuntime: AgentRuntime = {
    name: 'two-stage-dedupe',
    provision(_worktreePath: string, _project: ProjectConfig, _secrets: Record<string, string>): Promise<void> {
      return Promise.resolve()
    },
    launch(spec: LaunchSpec): Promise<LaunchedAgent> {
      launches += 1
      const launch = currentLaunch
      currentLaunch = secondLaunch
      return launch(spec)
    },
  }
  const store = new SessionStore(new Database(':memory:'))
  const manager = new SessionManager(
    store,
    twoStageRuntime,
    new FakeWorkspace(),
    new PermissionEngine({}),
    demoDefaults(),
    stubForgeProvider,
    new NoopNotifier(),
  )
  const parent = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'c', prompt: 'first' })
  await sessionStartedPromise
  resolveExited(1)
  await pollStatus(manager, parent.id, 'interrupted')
  const first = manager.resumeSession(parent.id, { forgeToken: 'tok' }, 'resume-retry-key')
  expect(first).not.toBeNull()
  await pollTerminal(manager, first!.id)
  // A retried resume with the same idempotencyKey must return the same
  // child and must not drive a second launch through the runtime.
  const second = manager.resumeSession(parent.id, { forgeToken: 'tok' }, 'resume-retry-key')
  expect(second).not.toBeNull()
  expect(second!.id).toBe(first!.id)
  expect(launches).toBe(2)
  await exitingHandle.close()
})
```

**IMPORTANT test-writing gotcha, follow exactly:** the `firstLaunch`/`secondLaunch`/`currentLaunch` pattern (two named function references + one unconditional reassignment) is required, not stylistic. An `if (launches === 1) { ... } else { ... }` branch, or even a `stages[i] ?? stages[stages.length - 1]!` fallback, both trip `oxlint`'s `no-conditional-in-test` vitest-plugin rule — it flags `??` used conditionally inside a test body, not just `if`/ternary. The two-function-reference-plus-reassignment form has zero branching constructs and passes lint. Also: do not write `currentLaunch = (): Promise<LaunchedAgent> => resumeLauncher.launch(spec)` inline inside `launch(spec)`'s body — that closure captures the _current_ invocation's `spec`, so replaying it on the second call replays the first call's argument, not the second's. `secondLaunch` must be a top-level `(spec: LaunchSpec) => ...` function defined once outside `launch`, so it receives whatever `spec` the actual second `launch()` call passes.

- [ ] **Step 9: Run tests to verify they fail**

Run: `bun test tests/session/manager.test.ts -t "idempotencyKey"`
Expected: FAIL — `followUpSession`/`resumeSession` don't accept/honor `idempotencyKey` yet (the second call mints a brand-new child instead of returning the first).

- [ ] **Step 10: Create `src/session/continuation.ts`**

Both `followUpSession` and `resumeSession` need the same "check for an existing child by idempotencyKey, then check the status gate, then plan + create + launch" sequence — the dedupe check must run **before** the status gate, not after, so a legitimate retry (the caller not knowing whether its first dispatch landed) still succeeds even if the parent's status has since moved on from `CONTINUABLE`/`RESUMABLE`. Centralize this in a new module using the deps-object + free-function pattern.

```typescript
// src/session/continuation.ts (new file)
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
  deps.store.create(createInput)
  if (parent.prUrl !== null) {
    deps.store.setPrUrl(childId, parent.prUrl)
  }
  if (parent.prNumber !== null) {
    deps.store.setPrNumber(childId, parent.prNumber)
  }
  deps.registerRun(childId, startInput, project, parent.branch)
  return deps.store.get(childId)
}

// Continues a finished/failed/cancelled session with a new caller-supplied
// prompt. The caller (manager.ts) has already confirmed parent.projectSpec is
// set; this checks the idempotencyKey dedupe, then the CONTINUABLE gate, then
// builds the plan and drives the shared launch tail.
export function runFollowUp(
  deps: ContinuationDeps,
  parent: Session,
  projectSpec: ProjectSpec,
  childId: string,
  input: FollowUpSessionInput,
): Session | null {
  const existing = dedupedChild(deps.store, parent.id, input.idempotencyKey)
  if (existing !== null) {
    return existing
  }
  if (!CONTINUABLE.has(parent.status)) {
    logger.warn({ parentId: parent.id, status: parent.status }, 'follow-up refused: parent still active')
    return null
  }
  const project = buildEphemeralProject(projectSpec, deps.defaults)
  const { createInput, startInput } = planFollowUp(parent, projectSpec, childId, input)
  return launchContinuation(deps, parent, childId, project, createInput, startInput)
}

// Continues an interrupted session with the fixed "continue the interrupted
// work" prompt. See runFollowUp for the shared dedupe/gate/launch sequence.
export function runResume(
  deps: ContinuationDeps,
  parent: Session,
  projectSpec: ProjectSpec,
  childId: string,
  credentials: ResumeCredentials,
  idempotencyKey: string | undefined,
): Session | null {
  const existing = dedupedChild(deps.store, parent.id, idempotencyKey)
  if (existing !== null) {
    return existing
  }
  if (!RESUMABLE.has(parent.status)) {
    logger.warn({ sessionId: parent.id, status: parent.status }, 'resume refused: session is not interrupted')
    return null
  }
  const project = buildEphemeralProject(projectSpec, deps.defaults)
  const { createInput, startInput } = planResume(parent, projectSpec, childId, credentials, idempotencyKey)
  return launchContinuation(deps, parent, childId, project, createInput, startInput)
}
```

- [ ] **Step 11: Thread `idempotencyKey` into `planFollowUp`/`planResume`'s `createInput` in `lifecycle.ts`**

```typescript
// src/session/lifecycle.ts — planFollowUp's createInput, add after parentSessionId: parent.id
      idempotencyKey: input.idempotencyKey ?? null,
```

```typescript
// src/session/lifecycle.ts — planResume's createInput, add after parentSessionId: parent.id
      idempotencyKey: idempotencyKey ?? null,
```

(If Task 4 was executed with these lines already present, this step is a no-op — verify with `grep -n idempotencyKey src/session/lifecycle.ts` before editing.)

- [ ] **Step 12: Refactor `manager.ts`'s `followUpSession`/`resumeSession` onto `continuation.ts`**

```typescript
// src/session/manager.ts — imports: replace the lifecycle.js/helpers.js/state.js/auto-publish.js
// import block with
import { runFollowUp, runResume } from './continuation.js'
import type { ContinuationDeps } from './continuation.js'
import { finishSession } from './finish.js'
import { newId, resolveProjectFor, safeCleanup } from './helpers.js'
import { buildLaunchSpec, prepareCheckedOutWorkspace, restoreStateIfContinuing, runTeardown } from './lifecycle.js'
import type { PrepareWorkspaceDeps, RunTurnDeps } from './lifecycle.js'
import { SessionStateShuttle } from './session-state.js'
import { canTransition, filterToStatuses } from './state.js'
import type {
  FinishSessionInput,
  FollowUpSessionInput,
  ResumeCredentials,
  Session,
  SessionFilter,
  SessionStatus,
  StartSessionInput,
} from './state.js'
```

`planFollowUp`, `planResume`, `CONTINUABLE`, `RESUMABLE`, `authFrom`, `openPullRequest` are no longer imported directly by `manager.ts` — they're only used inside `continuation.ts`/`finish.ts` now.

```typescript
// src/session/manager.ts — replace followUpSession and resumeSession
  // The CONTINUABLE gate + idempotencyKey dedupe both live in runFollowUp
  // (continuation.ts) so a retry with the same key wins even if the parent's
  // status has since moved on; this method only validates the parent shape.
  followUpSession(parentId: string, input: FollowUpSessionInput): Session | null {
    const parent = this.store.get(parentId)
    if (parent === null || parent.branch === null || parent.projectSpec === null) {
      logger.warn({ parentId }, 'follow-up refused: parent missing, unbranched, or specless')
      return null
    }
    return runFollowUp(this.continuationDeps(), parent, parent.projectSpec, newId(), input)
  }

  // Reuses followUpSession's mechanics (new worktree on the parent's branch,
  // SessionStateShuttle.copyIn, new container, session/load) but runResume
  // gates on RESUMABLE ({interrupted}) instead of CONTINUABLE, and drives a
  // fixed "continue the interrupted work" prompt instead of a caller-supplied
  // one. Same idempotencyKey dedupe as followUpSession (see its doc comment).
  resumeSession(sessionId: string, credentials: ResumeCredentials, idempotencyKey?: string): Session | null {
    const parent = this.store.get(sessionId)
    if (parent === null || parent.branch === null || parent.projectSpec === null) {
      logger.warn({ sessionId }, 'resume refused: session missing, unbranched, or specless')
      return null
    }
    return runResume(this.continuationDeps(), parent, parent.projectSpec, newId(), credentials, idempotencyKey)
  }

  private continuationDeps(): ContinuationDeps {
    return { store: this.store, defaults: this.defaults, registerRun: this.registerRun.bind(this) }
  }
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `bun test tests/session/manager.test.ts -t "idempotencyKey"`
Expected: PASS, both tests.

- [ ] **Step 14: Confirm the line-cap split held**

Run: `wc -l src/session/manager.ts src/session/continuation.ts`
Expected: both files under 300 lines (`manager.ts` at 288, `continuation.ts` at 90, as measured during this plan's live verification).

- [ ] **Step 15: Add `idempotencyKey` to the follow-up router body in `router.ts`**

```typescript
// src/server/router.ts — handleFollowUp's followUpSession call, add after mcpTokens: asStringRecord(body['mcpTokens'])
const child = deps.manager.followUpSession(id, {
  parentSessionId: id,
  prompt,
  contextId,
  secrets: asStringRecord(body['secrets']),
  forgeToken: asString(body['forgeToken']) ?? undefined,
  mcpTokens: asStringRecord(body['mcpTokens']),
  idempotencyKey: asString(body['idempotencyKey']) ?? undefined,
})
```

(`handleResume` already reads `idempotencyKey` from Task 4 Step 12 — no change needed there.)

- [ ] **Step 16: Full verification**

Run: `bun run typecheck && bun run lint && bun test --parallel && bun test --parallel && bun test --parallel && bun test`
Expected: typecheck/lint clean (0 errors/warnings, both `manager.ts` and `continuation.ts` under the line cap); 0 fail across all 4 runs. This task's live verification produced 564 pass / 0 fail on every one of 4 runs (3×`--parallel` + 1 plain).

- [ ] **Step 17: Commit**

```bash
git add src/session/state.ts src/session/store-row.ts src/session/store.ts src/session/continuation.ts src/session/manager.ts src/session/lifecycle.ts src/server/router.ts tests/session/store.test.ts tests/session/manager.test.ts tests/session/helpers.test.ts tests/session/lifecycle.test.ts
git commit -m "feat(session): dedupe follow-up/resume dispatches by idempotencyKey"
```

---

## Post-plan verification (run once, after Task 5's commit)

```bash
bun run typecheck
bun run lint
bun test --parallel
bun test --parallel
bun test --parallel
bun test
```

Expected: typecheck and lint both clean; all four test runs report 0 fail (564+ pass). This mirrors the exact verification discipline used while authoring this plan — `bun test --parallel` surfaces real timing/control-flow bugs (the container-exit race in Task 2, the two-stage-runtime test double in Tasks 4-5) that a single plain `bun test` run does not reliably catch.
