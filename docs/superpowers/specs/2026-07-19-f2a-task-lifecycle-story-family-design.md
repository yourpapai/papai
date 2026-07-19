<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F2a task lifecycle and policy story family

**Status:** approved

**Date:** 2026-07-19

## Context

The coverage-expansion roadmap sequences F2 (`task-*`, 21 scenarios) after F1. The catalog
audit classified them: 3 `executable-as-is` (not-configured, ask-confirm, deny), 3 needing
only `capability-ids` (create-update, comments, labels), 14 needing
`capability-ids` + `memory-task-provider-expansion`, 1 also needing `attachments-relay`.
`SCN-task-guest-readonly` is already executable.

Per the roadmap, the F2 split was deferred to this spec. Decision (confirmed during
design): **split F2 into F2a and F2b**. F2a (this spec) covers lifecycle + policy — 9
scenarios needing a small provider delta and the policy seams. F2b (later cycle) covers
the provider-surface families (relations, statuses, projects, project-team, worklog,
sprints, saved-queries, collaboration, identity, attachments, youtrack-command) — the
heavy `MemoryTaskProvider` build-out plus traits and the attachment relay.

Landing F2a moves the ledger from 49 to 58 executable stories and puts behavioral
tripwires on the task-tool gating path — capability registration, provider capability
gating, and the `tool_prefs` allow/ask/deny machinery — the parts of the task surface
`plugin-core-separation` is most likely to rewire.

Research basis: task tool inventory (`src/tools/tools-builder.ts`,
`collaboration-tools-builder.ts`), `MemoryTaskProvider` current state
(`tests/stories/harness/memory-task-provider.ts`), `TaskProvider` interface gaps
(`src/providers/types.ts`), tool_prefs and permission-prompt mechanics
(`src/tools/tool-preferences.ts`, `src/chat/permission-prompt.ts`), activity model
(`src/providers/domain-types.ts:227-235`).

## Seam 1: production capability ids

Extend `CORE_TOOL_CAPABILITIES` (`src/tools/core-capabilities.ts`) with exactly the wire
names F2a scripts, following the existing `tasks.<verb>` convention with a dotted
sub-hierarchy for sub-surfaces:

- `tasks.update` → `update_task`; `tasks.delete` → `delete_task`;
  `tasks.count` → `count_tasks`; `tasks.history` → `get_task_history`
- `tasks.comments.list/create/update/delete` → `get_comments`/`add_comment`/
  `update_comment`/`remove_comment`
- `tasks.labels.list/create/update/delete/assign/unassign` → `list_labels`/`create_label`/
  `update_label`/`remove_label`/`add_task_label`/`remove_task_label`

Existing gating semantics give the deny and not-configured behaviors for free: tools
absent from the gated per-turn set (denied prefs, missing provider capability, unassigned
provider) never register, so capability resolution fails exactly when it should. F2b
tools get their capability ids in the F2b cycle, with their own stories.

## Seam 2: MemoryTaskProvider — three method groups

Honest, contract-tested semantics following the provider's existing conventions
(clone-in/clone-out, exact error strings, `task.*`/`comment.*`/`label.*` events):

- `deleteTask(taskId)` — removes the task and its comments, label assignments, and
  history; `Task not found: <id>` on missing; emits `task.delete`. Capability
  `tasks.delete`.
- `countTasks({ query, projectId? })` — reuses the provider's own `searchTasks`
  semantics and returns the count. Capability `tasks.count`.
- `getTaskHistory(taskId, params)` — **self-seeding**: every mutating provider operation
  (create/update/delete/comment/label operations) appends an `Activity`
  (`category: 'task.created' | 'task.updated' | …`, `field`, `added`/`removed` diffs,
  monotonic timestamp) to a per-task list; `getTaskHistory` applies the interface's
  category/limit/offset/reverse filtering. Capability `activities.read`. History accrues
  from real operations, matching how real providers build it — no seeding helper.

`supportedMemoryTaskCapabilities` gains `'tasks.delete'`, `'tasks.count'`,
`'activities.read'`, so `given.taskCapabilities` can seed them.

## Seam 3: `given.toolPrefs(context, prefs)`

Thin fixture over `setToolPrefs(scopedConfigContextId(context), prefs)`. Verified during
research to work in the scenario world today (DB-backed; the keying matches
`applyToolPreferences`' config-context resolution).

## Seam 4: `then.task(title).absent()`

Negative mirror of `then.task(title).exists()` for the delete scenario.

## The ask-flow (no new seam)

The permission-prompt flow composes from existing primitives, documented in the story:

1. `given.toolPrefs(dm, { toolOverrides: { create_task: 'ask' }, … })`.
2. The scripted create carries the required `_permission_reason` field.
3. `when.dispatchMessage` (no settle — the ask blocks the turn).
4. The story extracts the `perm:a:<id>` / `perm:d:<id>` callback data from the recorded
   buttons reply (the only way to learn the random id).
5. `when.interaction(user, ctx, callbackData)` resolves the prompt and settles; on allow
   the tool executes, on deny the tool result is `permission_denied`.

## Story file

`tests/stories/tasks/lifecycle-and-policy.story.test.ts` — 9 scenarios, all DM contexts
with an assigned task instance (`given.assign(dm, instance)`). Scenario names match the
ledger mapping byte-for-byte.

| Scenario                  | Shape                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-task-create-update`  | Create (with `projectId`) → `tasks.update` rename → `then.task(new).exists()` + `.absent()` on the old title. RED→GREEN proof of the capability-ids seam   |
| `SCN-task-query`          | Seed 3 tasks in one turn → `count_tasks` filtered → reply carries the count → `list_tasks` scoped by `projectId` → events assert `task.create` ×3          |
| `SCN-task-delete`         | `delete_task` at `confidence: 0.9` (clears the 0.85 gate) → `.absent()`; low-confidence attempt returns `confirmation_required` → task still exists        |
| `SCN-task-history`        | Create + update → `get_task_history` → self-seeded activities page back → `promptToolResultTokenFingerprints` assert activity categories reached the model |
| `SCN-task-comments`       | `add_comment` → `get_comments` → `update_comment` → `remove_comment`; effects asserted via `world.tasks.getComments` + replies                             |
| `SCN-task-labels`         | `create_label` → `add_task_label` by `labelName` (exercises `getLabelByName` resolution) → `world.tasks.listTaskLabels` → `remove_task_label` → absent     |
| `SCN-task-not-configured` | No task instance assigned; scripted refusal only; `availableTools` lacks `create_task`/`list_tasks`                                                        |
| `SCN-task-ask-confirm`    | The ask-flow above for allow, then the same flow with `perm:d:` for deny; allowed task exists, denied task absent                                          |
| `SCN-task-deny`           | `toolOverrides: { create_task: 'deny' }` → scripted refusal; `availableTools` contains `list_tasks` but not `create_task`                                  |

## Deliberate exclusions

- Comment reactions (separate capability, no distinct behavior class).
- Everything F2b: relations, statuses, projects, project-team, worklog, sprints, saved
  queries, collaboration, identity, attachments, YouTrack `applyCommand` and traits.
- No `given.*` promotion for the buttons-callback extraction (used once; promote when a
  second consumer appears).

## Ledger updates (same PR, roadmap rule 5)

Nine `AUDIT_RECORDS` entries move to `EXECUTABLE_STORY_MAPPINGS` with
`verifiedAt: '2026-07-19'`. Totals: 128 ids / 58 executable / 70 pending; readiness
`{2, 46, 22}` (5−3 ready, 52−6 needs-seam). The runner totals line follows.

## Risks

1. **Ask-flow timing** — mitigated by the documented dispatch/extract/interact sequence;
   a failing extraction points at the buttons reply in the sanitized event trace.
2. **History categories are provider-defined strings** — the story pins the memory
   provider's own categories; the contract is the activity shape and filtering, not
   vendor strings.
3. **`count_tasks` gating** — the story seeds `tasks.count` via `given.taskCapabilities`
   where the capability is required, making the gating itself observable.

## Success criteria

- 9 new scenarios pass sandboxed (`bun test:stories`: 57 → 66).
- Ledger: 58 executable / 70 pending; runner prints the updated totals.
- The capability-ids additions are proven RED→GREEN by `SCN-task-create-update`.
- `bun test:stories:contracts`, typecheck, and lint stay green; the compat baseline is
  re-recorded after landing.
