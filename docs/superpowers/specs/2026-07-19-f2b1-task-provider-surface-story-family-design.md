<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F2b-1 task provider-surface story family

**Status:** approved

**Date:** 2026-07-19

## Context

F2b (the provider-surface half of F2) is split at the seam boundary, per the roadmap's
deferral to the family spec. F2b-1 (this spec) covers the 7 scenarios that are pure
provider-method expansion: `relations`, `statuses`, `projects`, `project-team`,
`worklog`, `sprints`, `saved-queries`. F2b-2 (next cycle) covers the 4 seam-carrying
scenarios: `collaboration`, `identity` (provisioning backstop), `attachments` (relay +
blob-store seam), `youtrack-command` (traits + `applyCommand`).

Landing F2b-1 moves the ledger from 58 to 65 executable stories and extends the
behavioral tripwires to the gated provider surface — the methods real task providers
implement behind capability gates, which `plugin-core-separation` must keep correctly
assembled and registered.

Research basis: the F2 provider-surface research (tool inventory
`src/tools/tools-builder.ts` / `collaboration-tools-builder.ts`, interface gaps
`src/providers/types.ts`, memory-provider conventions
`tests/stories/harness/memory-task-provider.ts`), plus the F2a execution learnings
(zero-default capabilities, `resolveToolCapability` discrimination, capability seeding
via `given.taskCapabilities`).

## Seam 1: production capability ids (27 entries)

Extend `CORE_TOOL_CAPABILITIES` following the established `tasks.<surface>.<verb>`
convention:

- `tasks.relations.add/update/remove` → `add_task_relation`/`update_task_relation`/
  `remove_task_relation`
- `tasks.statuses.list/create/update/delete/reorder` → `list_statuses`/`create_status`/
  `update_status`/`delete_status`/`reorder_statuses`
- `tasks.projects.get/list/create/update/delete` → `get_project`/`list_projects`/
  `create_project`/`update_project`/`delete_project`
- `tasks.projects.team.list/add/remove` → `list_project_team`/`add_project_member`/
  `remove_project_member`
- `tasks.worklog.list/create/update/delete` → `list_work`/`log_work`/`update_work`/
  `remove_work`
- `tasks.agiles.list` → `list_agiles`; `tasks.sprints.list/create/update/assign` →
  `list_sprints`/`create_sprint`/`update_sprint`/`assign_task_to_sprint`
- `tasks.queries.saved.list/run` → `list_saved_queries`/`run_saved_query`

## Seam 2: MemoryTaskProvider — six state groups

Following the provider's established conventions (clone in/out, exact error strings,
`task.*`-style events, deterministic `<noun>-<counter>` ids):

| Group                   | State + methods                                                                                  | Honest semantics                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects                | `projects: Map<id, Project>`                                                                     | `createProject` rejects duplicate names (labels convention); `getProject` throws `Project not found: <id>`; `listProjects`; `updateProject` merges; `deleteProject` removes only the project — tasks keep their `projectId` (the provider's established no-referential-validation leniency)                                                                 |
| Statuses                | `statuses: Map<projectId, Column[]>`                                                             | full CRUD + reorder; mutating ops return `{ status: 'confirmation_required', message }` unless `confirm === true` (the real status-mutation passthrough contract); list ordered by `position`                                                                                                                                                               |
| Project team            | `projectTeam: Map<projectId, UserRef[]>`                                                         | list / add (duplicate → `Project member already exists: <userId>`) / remove (`Project member not found: <userId>`)                                                                                                                                                                                                                                          |
| Relations               | `relations: Map<taskId, Map<relatedTaskId, type>>`                                               | add requires both tasks, duplicate → `Task relation already exists: <a> <b>`; update requires existing; remove → `Task relation not found: <a> <b>`; types `blocks`/`duplicate`/`related`/`parent`                                                                                                                                                          |
| Worklog                 | `workItems: Map<taskId, WorkItem[]>`                                                             | paginated list / create (duration required) / update / delete (`Work item not found: <id>`)                                                                                                                                                                                                                                                                 |
| Sprints + saved queries | `agiles: Map<id, Agile>`, `sprints: Map<agileId, Sprint[]>`, `savedQueries: Map<id, SavedQuery>` | agile/sprint CRUD with `requireAgile`/`requireSprint` errors; `assignTaskToSprint` requires task and sprint and records the assignment; `runSavedQuery` executes the stored query through the provider's own `searchTasks` semantics. Seed helpers `addAgile` / `addSavedQuery` (no create tools exist for these — same test-API role as `addIdentityUser`) |

`supportedMemoryTaskCapabilities` gains the matching capability strings (exact strings
verified against `src/providers/task-capability.ts` during implementation):
`tasks.relations`, `statuses.list/create/update/delete/reorder`,
`projects.read/list/create/update/delete`, `projects.team`,
`workItems.list/create/update/delete`, `agiles.list`,
`sprints.list/create/update/assign`, `queries.saved`. Stories seed them via
`given.taskCapabilities` (the F2a zero-default learning).

## Story file

`tests/stories/tasks/provider-surface.story.test.ts` — 7 scenarios, DM + assigned
instance + minimal `given.taskCapabilities([...])` per scenario. Deterministic ids:
`project-1`, `status-1`, `work-1`, `agile-1`, `sprint-1`, `query-1`, `task-1`/`task-2`.

| Scenario                 | Shape                                                                                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-task-relations`     | Create 2 tasks → `add_task_relation` (`blocks`) → relation recorded (event + provider read) → `update_task_relation` (`related`) → `remove_task_relation` → second remove surfaces `Task relation not found` as the tool result → provider state unchanged |
| `SCN-task-statuses`      | `create_status` without confirm → `confirmation_required` passthrough → with `confirm: true` → created → `update_status` → `reorder_statuses` → `delete_status` → `list_statuses` empty                                                                    |
| `SCN-task-projects`      | `create_project` → `get_project` → `update_project` → `list_projects` → duplicate-name create surfaces `Project already exists` → `delete_project` → list empty                                                                                            |
| `SCN-task-project-team`  | Create project → `add_project_member` → `list_project_team` → `remove_project_member` → empty; duplicate add surfaces the error                                                                                                                            |
| `SCN-task-worklog`       | Create task → `log_work` (duration + description) → `list_work` → `update_work` → `remove_work` → empty                                                                                                                                                    |
| `SCN-task-sprints`       | Seed `world.tasks.addAgile(...)` → `list_agiles` → `create_sprint` → `list_sprints` → `update_sprint` (goal) → `assign_task_to_sprint` → assignment recorded                                                                                               |
| `SCN-task-saved-queries` | Seed 2 via `world.tasks.addSavedQuery(...)` → `list_saved_queries` → `run_saved_query` → results match query semantics against seeded tasks                                                                                                                |

Effects are asserted via public provider reads and event kinds; error shapes
(`confirmation_required`, not-found) are conveyed by the scripted reply and the provider
state proves no mutation happened.

## Deliberate exclusions

- Everything F2b-2: collaboration, identity, attachments, youtrack-command, traits.
- `describe_project` / `custom-fields` (trait-gated — F2b-2's traits setter territory).
- Promoting `addAgile`/`addSavedQuery` to `given.*` DSL (provider test API; promote on
  second consumer).
- Referential validation between tasks and projects/statuses/sprints (documented
  provider leniency, consistent with the existing createTask behavior).

## Ledger updates (same PR, roadmap rule 5)

Seven `AUDIT_RECORDS` entries move to `EXECUTABLE_STORY_MAPPINGS` with
`verifiedAt: '2026-07-19'`. Totals: 128 ids / 65 executable / 63 pending; readiness
`{2, 39, 22}`. The runner totals line follows.

## Risks

1. **Provider-state growth** — six new maps; each group is small, convention-following,
   and contract-tested per group. No shared fixtures between groups.
2. **Status confirmation passthrough is provider-emulated** — the story pins the memory
   provider's honest version of the real contract (tools pass `confirm` through).
3. **Seed helpers are test API, not DSL** — documented here so the F2b-2 spec and
   reviewers treat them consistently.

## Success criteria

- 7 new scenarios pass sandboxed (`bun test:stories`: 66 → 73).
- Ledger: 65 executable / 63 pending; runner prints the updated totals.
- `bun test:stories:contracts`, typecheck, and lint stay green; the compat baseline is
  re-recorded after landing.
