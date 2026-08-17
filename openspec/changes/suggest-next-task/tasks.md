<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: `suggest_next_task` (increment 1)

Reference `specs/suggest-next-task/spec.md` for the contract and `design.md`
for decisions (D1–D7). The design's open question (YouTrack `createdAt`) is
deferrable — the degradation path is specified — and is not baked into any
task below.

## 1. Ranking pure function (test-first)

- [x] 1.1 Create `tests/tools/suggest-next-task.test.ts` with failing unit tests for the pure `rankTasks(tasks, now)` export: overdue-days magnitude ordering; overdue beats due ≤48h beats due ≤7d beats no-signal; priority token stacking (+25 urgent/critical/blocker, +20 high, +15 major, +5 medium/normal, case-insensitive containment); +2 `createdAt`-recency tiebreak only when no due/priority signal fired; tasks with `resolved` set excluded; identical inputs produce identical order; `reason` lines contain exactly the facts that scored. Verification: `bun test tests/tools/suggest-next-task.test.ts` (ranking cases red).
- [x] 1.2 Create `src/tools/suggest-next-task.ts` implementing the exported pure `rankTasks` with centralized score constants per design D2. Verification: `bun test tests/tools/suggest-next-task.test.ts` (ranking cases green).

## 2. `createdAt` passthrough (test-first)

- [x] 2.1 Add a failing case to the `mapTaskListItem` block in `tests/plugins/task-provider-kaneo/mappers.test.ts` asserting `createdAt` is preserved. Verification: `bun test tests/plugins/task-provider-kaneo/mappers.test.ts` (red).
- [x] 2.2 Add `createdAt?: string | null` to `TaskListItem` in `src/providers/domain-types.ts` and pass it through in `plugins/task-provider-kaneo/mappers.ts` (list schema already validates it as optional). Verification: `bun test tests/plugins/task-provider-kaneo/mappers.test.ts` green + `bun run typecheck`.

## 3. Tool-level tests (test-first)

- [x] 3.1 Add failing happy-path tool tests (fake provider via `createMockProvider()` or local fake, executed through `getToolExecutor()`): multi-project fan-out over `listProjects` with per-project `listTasks(projectId, { limit: 50, sortBy: 'dueDate', sortOrder: 'asc' })`; explicit `projectId` scopes to a single project call; payload shape `{ id, title, number?, url, projectId, dueDate?, priority?, score, reason }` plus `considered` counting post-`resolved`-drop candidates; `limit` respected. Verification: `bun test tests/tools/suggest-next-task.test.ts` (tool cases red).
- [x] 3.2 Add failing edge-branch tool tests: `{ status: 'project_required' }` when `listProjects` is absent and no `projectId` given; `{ status: 'identity_required' }` for unresolvable `assigneeId: 'me'` and assignee filter applied when resolved (including `preferredUserIdentifier`); empty state `{ suggestions: [], considered: 0 }`; `dueDate` rendered through `formatDueDateOutput` with the group-shared config-context timezone and UTC fallback; input-schema rejection of out-of-range `limit` via `schemaValidates()`. Verification: `bun test tests/tools/suggest-next-task.test.ts` (red).

## 4. Tool implementation

- [x] 4.1 Implement `makeSuggestNextTaskTool(provider, userId?, storageContextId?)` in `src/tools/suggest-next-task.ts` per design D1/D4/D5: `.describe()`d input schema (`projectId?`, `assigneeId?`, `limit?` int 1–5 default 3), p-limit(3) fan-out, `resolved` drop, `resolveMeReference` reuse, timezone resolution cloned from `list-tasks.ts`, structured `info`/`error` logging. Verification: `bun test tests/tools/suggest-next-task.test.ts` fully green.

## 5. Registration, metadata, inventory

- [x] 5.1 Register `suggest_next_task: makeSuggestNextTaskTool(provider, userId, storageContextId)` in `src/tools/core-tools.ts` beside `list_tasks`; add `suggest_next_task: read('task')` to `TOOL_METADATA` in `src/tools/tool-metadata.ts`; update the property assertions in `tests/tools/core-tools.test.ts`. Verification: `bun test tests/tools/core-tools.test.ts tests/tools/tool-metadata.test.ts`.
- [ ] 5.2 Update tool-inventory enumerations: `tests/llm-orchestrator-tools.test.ts` (sorted key list around line 362), `tests/completion/verified-completion.test.ts` (around line 50), and any other `EXPECTED_KEYS`/enumeration failures the suite surfaces. Verification: `bun run test:affected` then the affected files directly.

## 6. Docs and full gates

- [ ] 6.1 Document the tool: one line in `src/tools/CLAUDE.md` (tool-list context) and a note in the task-tool section of `docs/architecture/behaviors.md` covering on-demand ranking, the read-risk default (`allow`), and guest availability. Verification: `bun run test:log suggest` against the persisted report (no behavior change expected).
- [ ] 6.2 Run the full gates: `bun run test` (inspect via `test:failures`/`test:show` off the persisted report), `bun run typecheck`, `bun run lint`, `bun check:full`, and `bun run test:mutate:changed` for the per-file ratchet on touched files. Verification: all commands exit 0.
