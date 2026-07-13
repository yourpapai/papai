<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss → papai Migration · Phase 1: Assign-the-bot Trigger (design)

> **Parent roadmap.** `2026-07-11-kiss-to-papai-migration-roadmap-design.md` (phase P1). Builds on the
> completed P0 (`2026-07-11-kiss-to-papai-migration-p0-reliability-design.md`). This spec details P1 to
> the level needed for a writing-plans plan.
>
> **Goal.** Restore kiss's #1 habit on papai: an operator/user **assigns the bot to a GitLab MR** and it
> adopts and supervises that MR — reviews, CI-fixes, iterates — with **no chat message required to
> start**. Notifications route to a Project-designated chat context.
>
> **Repos touched.** `nerv` + `papai`. **No magi changes** — magi already supports MR adoption.
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-12) in the nerv/magi/papai repos.

## Decisions of record

1. **Poll, not webhook** — a new scheduled `assignee-watch` sweep, reusing nerv's existing sweep infra
   and the already-implemented `ForgeClient.getAllMRsByAssignee`. Webhook is a deferred optimization.
2. **Explicit `Project.notifyContextId`** — a single designated papai context per Project receives
   forge-triggered notifications (the existing `contextIds[]` array has no designated target).
3. **`/fork` `/branch` NL command adapter is OUT of P1** — it's a chat-side `create_coding_task`
   feature orthogonal to the forge trigger (forge-adopted tasks take the MR's existing branch). Tracked
   as its own later item.
4. **papai binding convenience** — a `/nerv bind <projectPath>` command captures the current context id
   and registers the binding, so operators never hand-copy a scoped context id.

## Key findings (grounding — most primitives already exist, unwired)

- **magi adoption is BUILT.** `StartSessionInput.prNumber` (`magi/src/session/state.ts:87-96`) →
  `resolveCheckoutBranch` (`magi/src/session/lifecycle.ts:70-85`) fetches the MR and checks out its
  `headRef`; the finish path guards against opening a second MR (`magi/src/session/manager.ts:228`,
  `action:'pr'` only when `prUrl === null`). Works for GitLab MRs (`magi/src/forge/gitlab.ts:99-106`).
- `ForgeClient.getAllMRsByAssignee(assignee, state)` and `getMRsByAssignee(...)` are **implemented**
  (`nerv/src/services/GitlabForgeClient.ts:272-333`) but have **zero callers** — the exact discovery
  primitive P1 needs.
- `ProjectService.getByForgeProject(projectPath)` (`nerv/src/services/ProjectService.ts:57-62`) exists,
  **unwired** — repo `projectPath` → `IProject` reverse lookup.
- `Task.source` enum is `'chat' | 'forge-event'` (`nerv/src/db/models/Task.ts:46,93`;
  `nerv/src/http/routes/tasks.ts:10`) with **zero producers** of `'forge-event'`.
- `generateMRAdoptionPrompt(mrTitle, mrDescription, gitlabUserName)` exists in
  `nerv/src/services/prompts.ts` but is **dead** — the natural initial prompt for an adopted MR.
- `NERV_BOT_USERNAME` config (`nerv/src/config.ts:63,184`, default `'nerv-agent'`) already identifies the
  bot's forge username (used today only to filter its own review notes).
- **Gap:** `forgePollSweep` (`nerv/src/periodic/sweeps.ts:99-125`) iterates **active Tasks** and only
  their repos with an existing `mrIid` — it **cannot discover a brand-new MR that has no Task yet**.
- **Gap:** `Task.contextRef.contextId` is caller-supplied (`nerv/src/services/TaskService.ts:8,20`) and
  must be a **valid papai scoped context id** (`papai/src/debug/notify-route.ts` `buildNotifyTarget`
  rejects unresolvable ids with 404) — a forge-triggered task has no chat thread to inherit one from.

---

## Components

### 1. `Project.notifyContextId` (nerv)

Add an optional `notifyContextId?: string` field to `IProject` + the Mongoose schema
(`nerv/src/db/models/Project.ts:18-42`). It holds the single papai scoped context id that receives
forge-triggered notifications for MRs in that Project. `contextIds[]` is unchanged (still used by
chat-initiated tasks). A Project with no `notifyContextId` set cannot originate forge-triggered tasks
(the sweep skips it until it's bound).

### 2. `assigneeWatchSweep` (nerv)

A new scheduled sweep (`nerv/src/periodic/sweeps.ts`), registered in `nerv/src/index.ts` alongside
`forge-poll` and gated identically on forge config, on a new `assigneeWatchMs` interval
(`nerv/src/config.ts`, default 60s, `{ immediate: true }`). Each tick:

1. `forge.getAllMRsByAssignee(cfg.botUsername, 'opened')` → the set of currently open MRs assigned to
   the bot (cross-project).
2. **Discover / create.** For each assigned MR: `ProjectService.getByForgeProject(mr.projectPath)`. Skip
   (debug-log) if no Project, or if the Project has no `notifyContextId`. Else, if **no active
   (non-terminal) task already owns `(projectPath, mrIid)`**, create a `source:'forge-event'` task that
   adopts the MR (see Component 3). Idempotent by `(projectPath, mrIid)` — repeated ticks never
   duplicate.
3. **Unassign → stop.** For each active `source:'forge-event'` task, if its MR is **not** in the
   currently-assigned-open set, distinguish two cases: MR still open (bot was un-assigned) →
   `SupervisorService.cancelTask(taskId)` (P0's reap-and-close); MR merged/closed → leave it to the
   existing `forge-poll` completion path (do not double-close). The open-vs-terminal check reuses a
   cheap MR-state read (`getMRSyncSnapshot`/`getMRView`).

The sweep only performs **discovery + lifecycle**; ongoing review-comment and CI iteration for the
adopted task are handled by the **existing** `review_comment` / `pipeline_failure` handlers and
`forge-poll` sweep, unchanged (they already operate on any task carrying an `mrIid`).

### 3. Forge-event task adoption + start (nerv)

Creating a forge-event task differs from a chat task: instead of letting magi open a new MR, we **adopt**
the existing one. A `createForgeEventTask` path (in `TaskService`/`SupervisorService`) seeds the
`taskRepositories` entry with the existing MR's `mrIid`, source branch, and MR number, sets
`contextRef.contextId = project.notifyContextId`, and builds the initial prompt from the MR via the
(currently dead) `generateMRAdoptionPrompt(mrTitle, mrDescription, gitlabUserName)`. `SupervisorService.startTask`
then passes the MR's **`prNumber`** in `StartSessionInput` so magi checks out the MR's `headRef` and
pushes to it (no second MR). Cost budget / model / MCP come from the Project config as for chat tasks.

### 4. Project binding: `/nerv bind` (papai) + `POST /projects/bind` (nerv)

- **papai** — extend the nerv plugin's existing `/nerv` command (`papai/plugins/nerv/index.ts`, today a
  static text reply) to parse a `bind <projectPath>` subcommand. It is **admin-gated** (bot-admin or
  group-admin — it can't be DM-only, since the operator must run it _in_ the target channel to capture
  that context). It reads the acting context's `auth.storageContextId` and calls nerv
  `POST /projects/bind` (via `callNerv`) with `{ projectPath, notifyContextId: storageContextId }`,
  then replies "bound **`<projectPath>`** → this channel" (or an error if the project is unknown).
- **nerv** — a new bearer-auth route `POST /projects/bind` (`nerv/src/http/routes/`) with body
  `{ projectPath: string, notifyContextId: string }`. It resolves the Project via
  `getByForgeProject(projectPath)` and sets `notifyContextId`; 404 if no Project owns that repo.

`/nerv projects` (listing bindable projects) is **out of scope** for v1.

---

## Cross-repo contract summary

| #   | Interface                 | Producer → Consumer | Change                                                     |
| --- | ------------------------- | ------------------- | ---------------------------------------------------------- |
| 1   | `Project.notifyContextId` | nerv (internal)     | new optional schema field                                  |
| 2   | assignee discovery        | nerv → forge        | wire existing `getAllMRsByAssignee(botUsername,'opened')`  |
| 3   | forge-event task creation | nerv (internal)     | wire `source:'forge-event'` + MR-seeded taskRepository     |
| 4   | session start (adoption)  | nerv → magi         | pass existing `prNumber` (magi already supports it)        |
| 5   | project bind              | papai → nerv        | new `POST /projects/bind { projectPath, notifyContextId }` |
| 6   | `/nerv bind` subcommand   | user → papai        | extend the existing `/nerv` plugin command                 |

---

## Config

- `NERV_BOT_USERNAME` must be set to the bot's **real** GitLab username (today defaults to
  `'nerv-agent'`) — the sweep polls MRs assigned to it.
- New `assigneeWatchMs` (default 60s); sweep gated on forge config like `forge-poll`.
- A Project must have forge config + repos (as today) **and** a `notifyContextId` (set via `/nerv bind`)
  before its MRs can trigger tasks.

## Error handling

- MR in a repo with no configured Project → ignore + debug-log.
- Project with no `notifyContextId` → skip (nothing to notify) until bound.
- `getAllMRsByAssignee` failure → log, retry next tick (no partial state).
- Task creation idempotent by `(projectPath, mrIid)` — never duplicates a task for the same MR.
- `unassign` cancel only fires for a still-**open** MR (terminal MRs go through `forge-poll` completion).
- `POST /projects/bind` for an unknown projectPath → 404; `/nerv bind` surfaces that to the operator.

## Testing strategy

- **nerv:** sweep discovers a newly-assigned MR → creates a `source:'forge-event'` task adopting it
  (asserts `prNumber` flows to `startSession`); a second tick does **not** duplicate; bot un-assigned
  from an open MR → `cancelTask`; merged/closed MR → NOT closed by this sweep (left to forge-poll);
  MR in an unconfigured repo → ignored; Project with no `notifyContextId` → skipped; `POST /projects/bind`
  sets the field and 404s an unknown project; adopted-task notifications target `notifyContextId`.
- **papai:** `/nerv bind <projectPath>` captures `storageContextId`, posts to nerv, replies success;
  admin-gating denies non-admins; unknown-project error surfaced.

## Out of scope / deferred

`/fork` `/branch` NL command adapter (separate chat-side item) · GitLab webhook trigger · auto-bind from
the assigner's papai identity · `/nerv projects` listing · multi-repo forge-event tasks (v1 adopts a
single MR per task, mirroring P0's single-MR completion path).

## Open assumptions (resolve during planning)

- **nerv `Project` records are mutable DB documents** `ProjectService` can update (so `bind` sets
  `notifyContextId`). If Projects are config-seeded/immutable, the binding needs a small separate store —
  the writing-plans exploration must confirm how Projects are created/persisted today.
- The MR's **`iid` vs `number`** mapping for GitLab (nerv stores `mrIid`; magi wants `prNumber`) — the
  plan must confirm the exact field passed to `StartSessionInput.prNumber`.
- Admin-gating mechanism for a plugin command run **in a group context** (not DM) — confirm the existing
  gating primitive papai exposes to plugin commands.
