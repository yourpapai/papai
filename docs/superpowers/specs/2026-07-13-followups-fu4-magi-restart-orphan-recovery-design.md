<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-ups · FU4: magi-restart Orphan Recovery (design)

> **Context.** Fourth sub-project of the post-migration follow-ups program. Closes the one crash case P2
> (crash auto-resume) explicitly deferred: a restart of the **magi process itself**. P2 covered agent/container
> death and hung turns _while magi stays alive_; it left "session state is present in magi's running map + DB
> regardless" as an assumption that only holds intra-process. FU4 makes a session survive a magi restart.
>
> **Repos touched.** `magi` only. **nerv: no code** (its P2 resume policy already recovers any `interrupted`
> session, cause-blind). **papai: no code.**
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-13) in the magi/nerv repos.

## Premise (what the investigation established)

- **`MAGI_DB` defaults to `:memory:`** — the central finding. `main.ts:248`:
  `store: new SessionStore(new Database(process.env['MAGI_DB'] ?? ':memory:'))` — the only `new Database(...)`
  in `src/`. Unset/`:memory:` → the entire `sessions` table (status, `branch`, `acp_session_id`, `resume_state`,
  `idempotency_key`) evaporates on process exit; a restart begins with an empty table. Production deploy examples
  set a file (`deploy/magi.env.example:36`), and the gap is documented twice (`README.md:86`, the ephemeral-resume
  spec) as "known, not coded."
- **The rest already works cause-agnostically.** The `interrupted` status, `RESUMABLE = {interrupted}`
  (`state.ts:127-129`), `POST /sessions/:id/resume`, and `runResume` (`continuation.ts:97-116`, gated only on
  `RESUMABLE.has(parent.status)`) have **no branch on _why_ a session became interrupted** — no cause metadata is
  even persisted. Resume rebuilds entirely from the persisted DB row + the host `MAGI_SESSION_STATE_ROOT/<lineage>`
  dir (survives restart independent of `MAGI_DB`) + freshly re-supplied credentials (`ResumeCredentials`, magi
  never inherits secrets across a restart). Nothing from the dead in-memory runtime is needed.
- **nerv is already cause-blind.** `magiStatus.ts:33-47` maps `interrupted` → `TaskStatus 'coding'` (in-progress,
  resumable); `makeReconcileHandler` (`nerv/src/supervisor/foundationHandlers.ts:70-99`) resumes on
  `session.status === 'interrupted'` regardless of cause, driven by the recurring `reconcileSweep`
  (`nerv/src/periodic/sweeps.ts:20-27`). So a boot-time "mark orphans interrupted" on the magi side is picked up
  by nerv with **zero nerv changes**.
- **The gap is a genuine hole, not merely additive.** No boot-time code marks orphaned rows (exhaustively
  confirmed across `main.ts` → `runServe` and `SessionStore`'s constructor). Worse, the two existing boot passes
  cannot reach these rows: `sweepOrphanWorkspaces` (`gc.ts:76-115`) only touches worktrees/containers, never
  session status; and the TTL reaper's `ACTIVE` set (`reaper.ts:17-23`) **excludes**
  `queued/preparing/running/waiting_permission/finishing` from reaping — it refuses to touch anything the DB still
  calls "active." So a restart-orphaned `running` row is invisible to everything today. A boot-time
  status-reconciliation pass is _necessary_.
- **Idempotency survives** iff `MAGI_DB` is a file: the partial unique index on `(parent_session_id,
idempotency_key)` (`store.ts:102-104`) is rebuilt by the same constructor against the same on-disk file, so
  nerv's deterministic `resumeIdempotencyKey` still dedupes a resume retried across the restart window.

## Decisions of record

1. **magi-only.** nerv's P2 policy + poll recover the marked-`interrupted` orphans unchanged; no nerv/papai code.
2. **Warn, don't enforce, on `MAGI_DB`.** Log a loud boot warning when the DB is `:memory:`/unset (sessions won't
   survive restart); start anyway. Non-breaking. With `:memory:` the boot pass naturally no-ops (empty table), so
   the warning is the whole story there.
3. **Status-only boot mark.** The new pass flips DB status only. The existing boot-time `sweepOrphanWorkspaces`
   reclaims leaked worktrees/containers, and resume rebuilds a fresh worktree+container from the persisted branch,
   so the orphaned old container is irrelevant to correctness (just needs eventual reclamation, which already
   happens). No forced teardown in the pass.
4. **`queued` rows → `failed`.** A row that never reached `preparing` has no `branch`/`projectSpec`
   (`manager.ts:182-183` sets those _before_ transitioning to `preparing`), so it fails `resumeSession`'s guard
   (`manager.ts:140-147`) and is unresumable — and nothing re-invokes `startSession` for it. Mark it terminal so
   nerv sees a definite outcome instead of polling a forever-stuck `queued`. (Planning confirms the transition is
   legal in `state.ts`; fall back to `cancelled` if `queued → failed` is disallowed.)
5. **`waiting_input` left alone.** It is an idle, container-free rest state between turns — not orphaned by a
   restart (nothing was running), and already safely resumable via the normal follow-up path.

---

## Component A — `MAGI_DB` persistence warning (magi)

`src/main.ts` `runServe` — at boot, if `process.env['MAGI_DB']` is unset or exactly `':memory:'`, `log.warn` that
session state will not survive a restart and restart-orphan recovery is inert. Non-fatal (warn-only, per decision
2). This surfaces in code the production requirement the README and deploy notes already state, without breaking
dev/CI/test runs that intentionally use `:memory:`.

The check reads the env directly (the `SessionStore`/`Database` object doesn't expose its path), at the same point
`main.ts:248` resolves `process.env['MAGI_DB'] ?? ':memory:'`.

## Component B — boot-time orphan-mark pass (magi)

A new function (in `src/session/`, e.g. `markRestartOrphans(store)`), called from `runServe` **synchronously
before `startServer`** — it is a fast local bun:sqlite update, and running it before the server accepts requests
avoids any window where a resume/follow-up hits an un-marked row:

1. `store.listByStatus(['preparing', 'running', 'waiting_permission', 'finishing'])` → transition each to
   `interrupted`. All four are valid `interrupted`-predecessors per the transition table (`state.ts:39-50`).
2. `store.listByStatus(['queued'])` → transition each to `failed` (per decision 4; unresumable).
3. Log a single structured summary: `{ interrupted: n, failed: m }`.

Ordering rationale: because this runs first, the marked rows leave the reaper's `ACTIVE` set (`interrupted`/`failed`
are not in it), so the existing TTL reaper (`fireSessionStateReaper`) and `sweepOrphanWorkspaces` — both already
fired in `runServe` — proceed against consistent status and can eventually reclaim genuinely-abandoned lineages
and worktrees. Reuses the existing `listByStatus` + status-transition machinery; **no schema change, no new
persistence, no wire change**.

**Net effect:** on a persistent-DB deployment, every session stranded mid-flight by a magi restart (graceful or
crash — a graceful shutdown does not drain live turns to terminal either) is flipped to `interrupted` at the next
boot and auto-recovered through the exact P2 resume path nerv already drives. On a `:memory:` deployment, the pass
no-ops on the empty table and the operator has been warned.

---

## Cross-repo contract summary

| #   | Area             | Repo | Change                                                                    |
| --- | ---------------- | ---- | ------------------------------------------------------------------------- |
| 1   | `MAGI_DB`        | magi | boot `log.warn` when `:memory:`/unset (non-fatal)                         |
| 2   | boot orphan-mark | magi | new pass before serve: live statuses → `interrupted`, `queued` → `failed` |

No wire-contract change. The `interrupted` status + resume path already exist (P2); nerv consumes the boot-marked
status through its existing cause-blind reconcile policy, unchanged.

## Testing strategy

The **restart-over-persistent-DB** scenario has zero coverage today (no magi test opens a file-backed `bun:sqlite`
DB and reopens it). FU4 adds:

- **Boot pass over a reopened file DB.** Open a file-backed `SessionStore`, seed rows across all statuses,
  construct a _second_ `SessionStore` over the **same file** (simulating a restart), run `markRestartOrphans`, and
  assert: `preparing`/`running`/`waiting_permission`/`finishing` → `interrupted`; `queued` → `failed`;
  `waiting_input`/`done`/`failed`/`cancelled`/`interrupted` → untouched.
- **No-op on empty table.** The pass over a fresh/empty DB marks nothing and logs `{ interrupted: 0, failed: 0 }`.
- **Recovery path intact.** A row the pass marked `interrupted` (with a valid `branch`/`projectSpec`) is accepted
  by the existing `resumeSession`/`runResume` path (asserts FU4's output is consumable by P2's mechanism).
- **Warning.** `:memory:`/unset `MAGI_DB` at boot emits the `log.warn`; a file path does not.

## Out of scope / deferred

- **Fail-closed `MAGI_DB` enforcement** — warn-only was chosen; a hard boot check remains a possible later
  hardening.
- **Forced container teardown in the mark pass** — status-only chosen; the existing `sweepOrphanWorkspaces` +
  resume-rebuilds-fresh cover reclamation.
- **Any nerv change or magi→nerv push** — nerv's recurring reconcile poll + P2 resume policy recover the marked
  orphans with no push and no code change.
- **The "does the Docker container survive magi's death" question** — immaterial to correctness under status-only
  (resume rebuilds fresh; the existing sweep reclaims either way). A planning verification note, not a blocker.
- **Persisting an interrupt _cause_** — resume is cause-agnostic, so no cause column is needed.

## Open assumptions (resolve during planning)

- **Transition legality of `queued → failed`** in `state.ts` (the four live→`interrupted` transitions are
  confirmed valid; `queued → failed` must be checked — fall back to `cancelled` if disallowed, or add the
  transition if the table is authoritative and it's a genuine omission).
- **The exact `SessionStore` API for the bulk update** — whether to iterate `listByStatus(...)` and call the
  existing per-row status-transition method, or add a small bulk `UPDATE ... WHERE status IN (...)` helper.
  Prefer reusing the existing transition path so state-machine invariants/side-effects (if any) are honored.
- **Placement in `runServe`** — confirm `markRestartOrphans` runs synchronously _before_ `startServer`, ahead of
  the existing fire-and-forget `sweepOrphanWorkspaces`/`fireSessionStateReaper`, so status is consistent before
  either runs and before the server accepts requests.
- **Whether any in-flight row legitimately lacks `branch`/`projectSpec` despite being past `queued`** — confirm
  `preparing` always has them set (`manager.ts:182-183` suggests yes) so a marked-`interrupted` row is always
  actually resumable; if a `preparing` row can lack them, decide whether it too should be `failed` rather than
  `interrupted`.
