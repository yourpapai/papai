<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss → papai Migration · Phase 2: Crash Auto-Resume (design)

> **Parent roadmap.** `2026-07-11-kiss-to-papai-migration-roadmap-design.md` (phase P2). Builds on
> completed P0/P0.5/P0.6 and P1. This spec details P2 to the level needed for a writing-plans plan.
>
> **Goal.** An in-flight coding session whose agent/container dies (or hangs) mid-turn **resumes
> automatically** instead of stalling until a manual nudge — the one depth item kept from kiss's
> autonomy.
>
> **Repos touched.** `magi` + `nerv`. **No papai changes.**
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-12) in the magi/nerv repos.

## Decisions of record

1. **Hybrid ownership** — **magi** owns detection (a new `interrupted` status + a resume path);
   **nerv** owns policy (decides to resume, with a bounded retry budget, then gives up to `failed`).
2. **Crash scope** — cover (a) **agent/container death mid-turn** (magi stays alive) and (b)
   **hung-but-alive** (no exit, turn awaits forever → an idle-timeout watchdog). **Out of scope:**
   magi-process-restart orphans (so **no `MAGI_DB`-persistence prerequisite** — both in-scope cases keep
   magi alive, so session state is present in magi's running map + DB regardless).
3. **Full idempotency** — a magi **`idempotencyKey`** on `follow-up`/`resume` (keyed by nerv's stable
   ids) so a crash-then-retry can't produce a duplicate session/push. This also closes the _pre-existing_
   ledger-write-after-dispatch race in the review/CI handlers.

## Key findings (grounding)

- **magi has zero mid-turn liveness detection.** The geofront container-exit handler only **logs**
  (`magi/src/runtime/geofront/geofront-runtime.ts:40-44`); there is no heartbeat/timeout/exit-code watch
  anywhere in `session/`, `acp/`, or `runtime/`. A dead or hung agent leaves the session at `running`
  **forever**.
- **`SessionStatus`** (`magi/src/session/state.ts:5-14`) has no `interrupted`/`stuck` state; `CONTINUABLE`
  (`state.ts:116-121`) = `waiting_input|done|failed|cancelled` — explicitly excludes `running` etc., so
  `followUpSession` **refuses** to continue a mid-turn session (`manager.ts:129-132`).
- **The resume mechanism already exists in shape:** `followUpSession` (`manager.ts:123-145`) →
  `planFollowUp` (`lifecycle.ts:126-153`) checks out the parent **branch** into a _new_ worktree, replays
  agent state (`restoreStateIfContinuing`/`SessionStateShuttle.copyIn`, `lifecycle.ts:22-32`), launches a
  _new_ container, and threads ACP `session/load` via `resolveResumeId` (`lifecycle.ts:37-43`). It mints a
  **new child session id** and requires **re-supplied credentials** (magi doesn't inherit them). The
  manual un-stick path today is `cancelSession` (`manager.ts:261-284`) force-transitioning `running →
cancelled`, then `followUp`.
- **`GET /sessions/:id`** (`magi/src/server/router.ts:132-134`) returns the raw `Session` with no
  dead/resumable signal.
- **nerv is structurally blind to magi-side death.** `reconcile` (`nerv/src/supervisor/foundationHandlers.ts:36-122`)
  sets `task.lastActivity = new Date()` on every successful `magi.getSession` (line 90) regardless of the
  reported status, so `staleTaskSweep` (`nerv/src/periodic/sweeps.ts:57-81`, 15-min `lastActivity`
  threshold) never fires for a session frozen at `running`. `reconcile` never restarts anything.
- **Idempotency is not auto-retry-safe.** `processedNoteIds`/`processedJobIds` (`nerv/src/db/models/Task.ts:28-29`)
  are written **after** the `magi.followUp` dispatch (`reviewHandlers.ts:80-85`, `ciHandlers.ts:58-63`),
  non-atomically; `followUpSession` mints a fresh child id with no dedupe — a retry produces a duplicate
  session/push. Pre-existing; P2's idempotencyKey fixes it.

---

## Components

### magi

**1. `interrupted` status.** Add `interrupted` to `SessionStatus` (`state.ts:5-14`) — "died/hung
mid-turn, resumable," distinct from `failed`. Transitions (`state.ts:37-51`): `preparing`/`running`/
`waiting_permission`/`finishing` → `interrupted`; `interrupted` → `preparing` (on resume) / `failed` /
`cancelled`. Add a **`RESUMABLE`** set = `{interrupted}` (used by the resume path). Expose the status
verbatim on `GET /sessions/:id` (no shape change needed — it already returns the raw `Session`).

**2. Two detection triggers → `interrupted`.**

- **Container/agent exit (deterministic):** in `geofront-runtime.ts` `attachExitLogger`, when the child
  exits while the session is still in a live status (not already `finishing`/terminal), abort the turn and
  transition the session to `interrupted`, then reap the workspace (reuse `cancelSession`'s `safeCleanup`).
- **Hung-but-alive (idle-timeout):** a per-turn liveness watchdog around the ACP update await
  (`magi/src/acp/client.ts:24` `drainUpdates`/`nextUpdate()`): if no ACP activity for
  `TURN_IDLE_TIMEOUT_MS` (new, ~10 min, generous — measured on ACP protocol traffic, not completion),
  abort the turn, tear down the container, and mark `interrupted`.

**3. Resume path.** `resumeSession(sessionId, credentials, idempotencyKey?)` (exposed as
`POST /sessions/:id/resume`) reuses the `followUpSession` mechanics (new worktree on the interrupted
session's **branch** → `SessionStateShuttle.copyIn` → new container → `session/load`) but is gated on the
**`RESUMABLE`** set instead of `CONTINUABLE`, and drives a standard **"continue the interrupted work"**
continuation prompt (`session/load` restores the conversation, so no original prompt is stored/needed).
It mints a **new child session id** and requires re-supplied credentials, returning the new id — same
contract shape as `follow-up`.

**4. `idempotencyKey` dedupe.** `follow-up` and `resume` accept an optional `idempotencyKey`; magi stores
it on the child session and, if a child with the same `(parentId, idempotencyKey)` already exists,
**returns that child** instead of minting a second. This makes both endpoints safely retriable.

### nerv

**5. `MagiClient.resumeSession` + status mapping.** Add `resumeSession(sessionId, opts, idempotencyKey)`
→ `POST /sessions/:id/resume` (`nerv/src/services/MagiClient.ts`, mirroring `followUp:90-99`). Teach the
`MagiSession` view + `statusForMagiStatus` (`nerv/src/domain/magiStatus.ts`) about `interrupted` — it maps
to nerv `coding` (still working, not a terminal `failed`).

**6. Resume policy in `reconcile`.** When `makeReconcileHandler` sees a repo whose magi session status is
`interrupted`:

- **Under budget** (`repo.resumeAttempts < cfg.maxResumeAttempts`, default 3): increment `resumeAttempts`
  and **persist first** (pre-dispatch intent), then `magi.resumeSession(...)` with the deterministic key
  (Component 7), set `repo.magiSessionId` to the returned child id, persist. Task stays `coding`.
- **Budget exhausted:** transition the task to `failed` and notify chat ("coding run crashed and couldn't
  be resumed after N attempts").
- **Reset:** `resumeAttempts` resets to 0 once the (resumed) session reaches a non-`interrupted` live/terminal
  state — so an unrelated later crash gets a fresh budget.
- New `resumeAttempts?: number` field on `TaskRepo` (`nerv/src/db/models/Task.ts`).

**7. Deterministic idempotency keys.** nerv derives stable keys and passes them on every magi dispatch:
review-fix → `${taskId}:${projectPath}:note:${noteId}`, CI-fix → `${taskId}:${projectPath}:job:${jobId}`,
resume → `${taskId}:${projectPath}:resume:${interruptedSessionId}`. Because the key re-derives from the
same id on any retry, magi's dedupe (Component 4) prevents duplicate sessions/pushes — closing the
pre-existing review/CI ledger race. `reviewHandlers.ts`/`ciHandlers.ts` pass the key on their
`magi.followUp` calls.

---

## Cross-repo contract summary

| #   | Interface            | Producer → Consumer | Change                                                                          |
| --- | -------------------- | ------------------- | ------------------------------------------------------------------------------- |
| 1   | `interrupted` status | magi → nerv         | new `SessionStatus`, exposed on `GET /sessions/:id`                             |
| 2   | resume               | nerv → magi         | new `POST /sessions/:id/resume { credentials, idempotencyKey? }` → new child id |
| 3   | `idempotencyKey`     | nerv → magi         | optional on `follow-up` + `resume`; magi dedupes per `(parent, key)`            |
| 4   | `resumeAttempts`     | nerv (internal)     | new `TaskRepo` field (retry budget)                                             |

---

## Config

- **magi:** `TURN_IDLE_TIMEOUT_MS` (hung-turn watchdog, default ~600000 / 10 min — generous, tunable).
- **nerv:** `MAX_RESUME_ATTEMPTS` (default 3).

## Error handling

- `resumeSession` call fails → leave the session `interrupted`, retry next `reconcile` tick (still under
  budget). No partial state.
- magi dedupe returns the existing child → no duplicate session; nerv adopts that child id.
- Budget exhausted → task `failed` + one notification (bounded — never an infinite resume loop).
- Idle-timeout is measured on ACP-protocol activity, not turn completion, so a long-but-active operation
  is not falsely interrupted.

## Testing strategy

- **magi:** container-exit mid-turn → session `interrupted` + workspace reaped; idle-timeout with no ACP
  activity → `interrupted`; `resumeSession` on an `interrupted` session re-launches on its branch and
  returns a new child; a second `resume`/`follow-up` with the same `idempotencyKey` returns the SAME
  child (no duplicate); `GET /sessions/:id` shows `interrupted`.
- **nerv:** `reconcile` on an `interrupted` session resumes it (increments `resumeAttempts`, updates
  `magiSessionId`, task stays `coding`); budget exhausted → `failed` + notify; `resumeAttempts` resets on
  progress; a retried review/CI follow-up re-derives the same key (dedupe path exercised).

## Out of scope / deferred

- **magi-process-restart orphan recovery** + making `MAGI_DB` a persistent file + a boot-time
  mark-orphans-`interrupted` pass (both in-scope crash cases keep magi alive, so this isn't needed for
  P2; it's a separate hardening follow-up).
- The boot-time `sweepOrphanWorkspaces` worktree teardown (`magi/src/runtime/geofront/gc.ts:76`) is left
  as-is: resume re-checks-out the committed **branch** into a fresh worktree, so a destroyed old worktree
  is harmless; uncommitted mid-turn work is lost on any crash regardless.
- The nerv scheduler-overlap / DB-level idempotency concern flagged in P1's review (systemic across all
  sweeps) remains its own follow-up.

## Open assumptions (resolve during planning)

- The exact ACP client await point to wrap with the idle-timeout watchdog (`acp/client.ts` `drainUpdates`)
  and how to cancel it cleanly without racing a legitimate final update.
- Whether `SessionStateShuttle`'s saved state for a session that died **mid-turn** is complete enough for
  `session/load` to restore useful context, or whether resume effectively restarts the turn from the last
  clean checkpoint — confirm what state is persisted and when.
- Where magi stores the `idempotencyKey` (child `Session` row column vs a lookup table) and the exact
  `(parentId, key)` uniqueness check.
