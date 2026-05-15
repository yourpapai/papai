# Kaneo Compatibility Gap E2E Test Plan

**Objective:** Extend the Tier 1 Kaneo E2E suite so papai proves the highest-risk Kaneo compatibility behaviors that are still only partially covered today: `startDate` round-tripping, task-list contract adaptation, search-envelope adaptation, dedicated comment semantics, directional relation mapping, and label delete or attach or detach runtime behavior.

**Regression Boundary:** Keep the current passing Kaneo provider-real E2E suite stable while adding stronger coverage for doc-vs-runtime drift points already recorded in papai. The new tests must not weaken cleanup isolation, must keep using the shared Docker-backed Kaneo harness, and must preserve the current accepted runtime behavior for search and unattached label deletion.

**Owners/Audience:** papai provider maintainers and contributors touching `src/providers/kaneo/`, `tests/e2e/`, or the Kaneo migration documents.

**Realism Tier:** Tier 1: Provider-Real E2E. These gaps sit at the live Kaneo API -> papai provider adaptation boundary. Unit, schema, and contract tests already cover local mapping logic, but they cannot prove the current runtime envelope, nullable field behavior, or direction-sensitive relation state coming back from a real Kaneo instance.

**Platforms and Providers:** Bun E2E harness, Docker-backed Kaneo runtime, Kaneo provider only.

**Excluded Scope:** Chat-provider flows, orchestrator or tool-calling runtime flows, YouTrack parity, multi-version Kaneo matrix testing, performance benchmarking, and wrapper-only naming cleanup that does not change live Kaneo behavior.

---

## Architecture Path

```text
E2E test case
  -> shared Bun preload (`tests/e2e/bun-test-setup.ts`)
  -> shared Kaneo environment (`tests/e2e/global-setup.ts`)
  -> test fixture creation (`tests/e2e/kaneo-test-client.ts`)
  -> papai Kaneo wrapper (`src/providers/kaneo/*`)
  -> live Kaneo API container
  -> normalized papai output
  -> optional raw authenticated API probe for system oracle
```

## Environment and Fixtures

- Run with `IMAGE=papai:e2e bun test:e2e`.
- Reuse the existing shared Docker-backed Kaneo environment from `tests/e2e/bun-test-setup.ts` and `tests/e2e/global-setup.ts`.
- Reuse `KaneoTestClient` for project, task, and label lifecycle cleanup.
- Add one new authenticated raw-fetch helper for E2E contract oracles. Keep it narrow and provider-specific, for example `tests/e2e/kaneo-api-helpers.ts`, so tests can inspect raw `/api/search`, `/api/task/tasks/{projectId}`, `/api/comment/{taskId}`, `/api/task-relation/{taskId}`, and `/api/label/task/{taskId}` payloads when wrapper-level assertions are not enough.
- Use unique project names per test and fixed ISO datetime strings with offsets, for example `2026-05-20T09:00:00.000Z`, so datetime assertions stay deterministic.
- Prefer per-test cleanup through `beforeEach` plus `KaneoTestClient.cleanup()`; do not add suite-local Docker lifecycle code.
- If a scenario needs assignee-aware search coverage, expose the seeded authenticated Kaneo user ID through a small helper in the E2E harness rather than hard-coding IDs in tests.

## Scenario Matrix

| Scenario | Feature Tags | Journey Tags | Layers Crossed | Trigger | User Oracle | System Oracle | Failure Mode | Cleanup | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Task create or get round-trips `startDate` and `dueDate` | kaneo, tasks, datetime | create, read | E2E harness, provider wrapper, Kaneo task API | Create a task with `startDate` and `dueDate`, then fetch it | `createTask()` and `getTask()` both expose the same ISO values | Raw `GET /api/task/{id}` returns matching `startDate` and `dueDate` fields | Kaneo drops one field, normalizes it differently, or papai maps it to `null` unexpectedly | Delete task via `KaneoTestClient` | Add to `tests/e2e/task-lifecycle.test.ts` |
| Task update preserves existing `startDate` when only non-date fields change | kaneo, tasks, datetime | update | E2E harness, provider wrapper, Kaneo full-`PUT` task API | Create task with `startDate`, then call `updateTask()` with only `title` | Updated task keeps the original `startDate` after update and re-fetch | Raw `GET /api/task/{id}` still contains the original `startDate` after the update request | Full-`PUT` update accidentally clears `startDate` | Delete task via `KaneoTestClient` | Covers papai's merge-before-update behavior |
| Task update overrides `startDate` explicitly | kaneo, tasks, datetime | update | E2E harness, provider wrapper, Kaneo full-`PUT` task API | Update an existing task with a new `startDate` | `getTask()` shows the new `startDate` value | Raw `GET /api/task/{id}` matches the override value | Kaneo ignores `startDate` updates or papai loses the override during merge | Delete task via `KaneoTestClient` | Pair with the preservation scenario so regressions are directional |
| Task list includes both column tasks and `plannedTasks` and keeps normalized fields stable | kaneo, tasks, list, compatibility | list | E2E harness, provider wrapper, Kaneo list API | Create tasks that land in a normal column and in a planned or unscheduled state, then call `listTasks()` | `listTasks()` returns both tasks with expected title, priority, and `dueDate` visibility | Raw `GET /api/task/tasks/{projectId}` documents whether Kaneo is still returning `{ data, pagination }` and whether `plannedTasks` is populated | Runtime list envelope or task placement changes without the wrapper adapting | Delete tasks and project via `KaneoTestClient` | May require a raw contract assertion even if the provider output still looks plausible |
| Task list filters and sorting still map to live Kaneo query behavior | kaneo, tasks, list, filters | list, filter, sort | E2E harness, provider wrapper, Kaneo list API | Seed tasks with distinct priorities, due dates, and titles, then call `listTasks()` with `priority`, `dueBefore`, `dueAfter`, `limit`, and `sortBy` parameters | Result set honors the requested filter or sort expectations at the provider level | Raw list endpoint query returns a payload consistent with the provider result ordering or inclusion | Query parameter drift or result sorting changes silently | Delete tasks and project via `KaneoTestClient` | Add to a new focused file such as `tests/e2e/task-list-compatibility.test.ts` if `task-lifecycle.test.ts` becomes crowded |
| Search wrapper still adapts the live runtime envelope and ignores non-task groups safely | kaneo, search, compatibility | search | E2E harness, provider wrapper, Kaneo search API | Create searchable tasks, then call `searchTasks()` with a unique keyword | `searchTasks()` returns normalized task results containing the created task IDs | Raw `GET /api/search` payload shape is captured and asserted, including the current top-level keys and task field nullability | Kaneo changes the search envelope or starts omitting task fields papai expects | Delete tasks and project via `KaneoTestClient` | Keep the raw assertion descriptive, not overly strict on unrelated groups |
| Search `projectId` and `limit` behavior remain aligned with live Kaneo | kaneo, search, filters | search, filter, paginate | E2E harness, provider wrapper, Kaneo search API | Create tasks across projects and query with `projectId` plus `limit` | Provider result set only includes the target project and respects item count expectations | Raw `/api/search` response agrees on task identity and count for the same query | Search filtering semantics drift between docs and runtime | Delete projects and tasks via `KaneoTestClient` | Extend `tests/e2e/task-search.test.ts` |
| Search assignee filtering stays correct when papai filters locally | kaneo, search, assignee, pagination | search, filter | E2E harness, provider wrapper, Kaneo search API | Create at least one assigned and one unassigned task, then call `searchTasks()` with `assigneeId` | Provider returns only the assigned task and paginates locally without dropping matches | Raw `/api/search` response contains both tasks before papai applies local assignee filtering | Kaneo adds native assignee filtering or changes returned user fields in a way that breaks papai's local pass | Delete tasks and project via `KaneoTestClient` | Requires a small E2E helper for the seeded user ID and possibly a direct assignee update wrapper if task creation cannot assign reliably |
| Comment update and delete operate on the dedicated `/comment` resource, not on activity fallbacks | kaneo, comments, compatibility | create, update, delete | E2E harness, provider wrapper, Kaneo comment API | Create two comments on one task, update one comment, then delete it | Updated comment keeps its ID, the untouched comment remains unchanged, and the deleted comment disappears from `getComments()` | Raw `/api/comment/{taskId}` shows the targeted comment body changed, then removed, while other comments remain | Wrapper drifts back toward activity-based assumptions or comment IDs become unstable | Delete task via `KaneoTestClient` | Strengthens `tests/e2e/task-comments.test.ts` beyond basic CRUD |
| Reverse relation mapping preserves `blocks` on the source task and `blocked_by` on the target task | kaneo, relations, mapping | create, read | E2E harness, provider wrapper, Kaneo relation API | Create relation `A blocks B`, then fetch both tasks | Source task shows `{ type: 'blocks' }` and target task shows `{ type: 'blocked_by' }` | Raw `GET /api/task-relation/{taskId}` confirms the live directional relation payload | Kaneo relation read shape changes or papai loses reverse-direction adaptation | Delete tasks via `KaneoTestClient` | Current E2E only proves one side of the mapping |
| Reverse relation mapping preserves `parent` on the child task and `child` on the parent task | kaneo, relations, mapping, subtasks | create, read | E2E harness, provider wrapper, Kaneo relation API | Create a parent relation, then fetch both tasks | Child shows `{ type: 'parent' }` and parent shows `{ type: 'child' }` | Raw relation payload still uses Kaneo's native `subtask` relation type | Directional mapping between Kaneo `subtask` and papai `parent` or `child` regresses | Delete tasks via `KaneoTestClient` | Extend `tests/e2e/task-relations.test.ts` |
| Relation update still behaves as delete plus recreate without leaving duplicates behind | kaneo, relations, update | update, read | E2E harness, provider wrapper, Kaneo relation API | Add a relation, update its type, then fetch both tasks and the raw relation list | Exactly one live relation remains and provider outputs the new type only | Raw `GET /api/task-relation/{taskId}` shows a single relation after update | Delete-plus-create leaves duplicate relations or stale old relation state | Delete tasks via `KaneoTestClient` | Existing E2E verifies wrapper output, but not raw duplicate avoidance |
| Label attach and detach are visible through the dedicated task-label endpoint | kaneo, labels, compatibility | attach, detach, read | E2E harness, provider wrapper, Kaneo label API | Attach a label to a task, then detach it | Provider attach or detach calls succeed and task-scoped label visibility changes accordingly | Raw `GET /api/label/task/{taskId}` first contains the label and then no longer contains it | Current E2E only checks task re-fetch and not the dedicated label-task association surface | Delete task and label via `KaneoTestClient` | Strengthens `tests/e2e/label-operations.test.ts` |
| Label deletion remains gated by attachment state at runtime | kaneo, labels, delete, compatibility | delete | E2E harness, provider wrapper, Kaneo label API | Create an unattached label, assert delete fails; attach a label, assert delete succeeds; detach one and document whether delete fails again | Provider behavior matches the currently accepted runtime rule for unattached vs attached labels | Raw workspace-label lookup and task-label lookup show the live state transitions around delete attempts | Kaneo runtime changes delete semantics silently or papai stops matching the runtime | Delete surviving tasks and labels via `KaneoTestClient` | Preserve current behavior unless Kaneo runtime demonstrably changes |

## Non-E2E Coverage

- Keep exact Zod schema acceptance or rejection for search envelope variants, nullable date fields, and comment or relation payload shape in unit or schema tests under `tests/providers/kaneo/`.
- Keep unsupported outgoing Kaneo relation types such as `duplicate`, `duplicate_of`, and `blocked_by` in unit tests; those are papai policy decisions and do not need a live Kaneo run to prove.
- Keep wrapper naming cleanup around `activityId` versus `commentId` out of E2E unless the live transport behavior changes.
- Keep precise `classifyKaneoError()` branch coverage in unit tests; E2E should only assert user-visible or provider-visible failure categories when the live runtime boundary matters.
- Leave multi-version Kaneo compatibility matrices for a separate plan if papai decides to support more than the current local E2E image.

## Harness Reuse and Gaps

- Reuse:
  - `tests/e2e/bun-test-setup.ts`
  - `tests/e2e/global-setup.ts`
  - `tests/e2e/kaneo-test-client.ts`
  - existing domain suites: `task-lifecycle.test.ts`, `task-search.test.ts`, `task-comments.test.ts`, `task-relations.test.ts`, and `label-operations.test.ts`
- Add:
  - `tests/e2e/kaneo-api-helpers.ts` for narrow authenticated raw API probes used as system oracles
  - optional `tests/e2e/task-list-compatibility.test.ts` if task-list contract coverage does not fit cleanly in `task-lifecycle.test.ts`
  - one shared helper to expose the seeded Kaneo user identity if assignee-aware search coverage is added
- Update:
  - `tests/e2e/e2e.test.ts` to import any new E2E test file
  - `tests/e2e/README.md` if the new helper or command guidance changes

## Known Backend Quirks

- The local Tier 1 suite is currently verified with `IMAGE=papai:e2e bun test:e2e`.
- Kaneo docs and runtime have diverged on search shape before; papai currently supports both grouped-doc and runtime-flat envelopes.
- Kaneo runtime currently rejects deletion of unattached labels even though the public docs show label deletion endpoints.
- Existing `tests/e2e/task-lifecycle.test.ts` already documents a Kaneo priority-update bug; new scenarios should avoid conflating that known backend issue with provider compatibility failures.
- Kaneo comment docs publish both dedicated `/comment` pages and older activity-comment pages; papai's live path should continue to treat `/comment` as authoritative.
- Kaneo task-list and relation-read docs remain under-specified, so some system oracles should validate raw runtime payloads rather than assume the docs are complete.

## Implementation Order

1. Add the raw authenticated E2E API helper and one high-signal happy-path task `startDate` scenario first.
2. Add task-list and search contract scenarios next, because those are the largest doc-vs-runtime drift risks.
3. Strengthen relation reverse-mapping scenarios after search is stable.
4. Strengthen label attach or detach and delete-state coverage after relation tests are in place.
5. Finish with the more surgical comment ID-stability scenario and any README or harness documentation updates.
