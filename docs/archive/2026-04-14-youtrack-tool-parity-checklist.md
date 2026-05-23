<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Tool Parity Checklist

> **Note**: This plan has been fully implemented. See ADR-0117: YouTrack Tool Parity Closure for the decision record.

**Goal:** Close the highest-impact YouTrack gaps between papai's provider/tool surface and the cloned MCP baseline, while fixing confirmed YouTrack-specific correctness bugs.

**Architecture:** Keep the provider layer responsible for raw YouTrack semantics and normalization, and keep the tool layer responsible for LLM-facing exposure and capability gating. Implement the work in ranked phases so correctness bugs land before new surface area, and expose provider functionality only after its normalized shape and tests are in place.

**Tech Stack:** Bun, TypeScript, Zod v4, Vercel AI SDK tools, Bun test runner.

---

## File Map

**Provider files already involved**

- `src/providers/domain-types.ts`: normalized `Task`, `Project`, and related shapes.
- `src/providers/types.ts`: provider contract and capability declarations.
- `src/providers/youtrack/constants.ts`: fields lists and capability set.
- `src/providers/youtrack/mappers.ts`: YouTrack-to-normalized mapping and outgoing custom-field payload construction.
- `src/providers/youtrack/index.ts`: concrete YouTrack provider wiring.
- `src/providers/youtrack/collaboration-provider.ts`: current-user and collaboration helpers.
- `src/providers/youtrack/operations/tasks.ts`: create/get/update/list/search/delete issue behavior.
- `src/providers/youtrack/operations/projects.ts`: project read/write operations.
- `src/providers/youtrack/operations/users.ts`: current-user and user lookup.

**Tool files already involved**

- `src/tools/tools-builder.ts`: actual exposed tool surface.
- `src/tools/core-tools.ts`: core task tool assembly.
- `src/tools/create-task.ts`: create tool schema, including current priority and custom field contract.
- `src/tools/update-task.ts`: update tool schema.
- `src/tools/list-tasks.ts`: list tool schema.
- `src/tools/search-tasks.ts`: search tool schema.
- `src/tools/list-projects.ts`: current list-only project read tool.
- `src/tools/get-comments.ts`: current no-pagination comments read tool.
- `src/tools/list-work.ts`: current no-pagination work-item read tool.
- `src/tools/add-task-label.ts`: label assignment by `labelId`.
- `src/tools/remove-task-label.ts`: label removal by `labelId`.
- `src/tools/upload-attachment.ts`: upload tool consuming file relay.

**Likely new tool files**

- `src/tools/get-project.ts`: expose `provider.getProject()`.
- `src/tools/get-current-user.ts`: expose `provider.getCurrentUser()`.

**Primary tests to extend**

- `tests/providers/youtrack/operations/tasks.test.ts`: provider correctness for due date and custom-field behavior.
- `tests/tools/tools-builder.test.ts`: exposed tool assembly, including attachment context fix and new tools.
- `tests/tools/project-tools.test.ts`: add `get_project` tool coverage.
- `tests/tools/attachment-tools.test.ts`: validate attachment tool assembly assumptions if builder changes.
- `tests/tools/work-item-tools.test.ts`: pagination-related additions if list-work evolves.
- `tests/providers/youtrack/tools-integration.test.ts`: high-level expected YouTrack tool set.

---

## Phase 1: Correctness Bugs First

### 1. Fix YouTrack due date support end-to-end

**Impact:** Critical. Existing UI/tool contract already claims due-date support, but YouTrack currently drops it on write and always returns `null` on read.

**Files:**

- Modify: `src/providers/youtrack/mappers.ts`
- Modify: `src/providers/youtrack/constants.ts`
- Modify: `src/providers/youtrack/operations/tasks.ts`
- Test: `tests/providers/youtrack/operations/tasks.test.ts`
- Test: `tests/tools/create-task.test.ts`
- Test: `tests/tools/update-task.test.ts`
- Test: `tests/tools/get-task.test.ts`

**Checklist:**

- [x] Add failing provider tests showing `createYouTrackTask()` sends due-date custom-field data when `dueDate` is provided.
- [x] Add failing provider tests showing `updateYouTrackTask()` sends due-date custom-field data when `dueDate` is provided.
- [x] Add failing provider tests showing `getYouTrackTask()` maps a YouTrack due-date custom field into normalized `task.dueDate`.
- [x] Update the issue field selection so due-date data is fetched from YouTrack responses.
- [x] Extend outgoing custom-field payload building to encode YouTrack due-date data instead of silently dropping it.
- [x] Extend incoming mapping so due date is parsed into the normalized ISO string expected by the tools.
- [x] Run targeted provider and tool tests covering create, update, and read paths.

**Verification commands:**

- `bun test tests/providers/youtrack/operations/tasks.test.ts`
- `bun test tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts`

### 2. Fix the attachment tool builder context bug

**Impact:** High. `upload_attachment` can be wired with the wrong context key, which risks file-relay lookup failures in group flows.

**Files:**

- Modify: `src/tools/tools-builder.ts`
- Test: `tests/tools/tools-builder.test.ts`

**Checklist:**

- [x] Add a failing builder test that demonstrates attachment tools must be created from `contextId` rather than `chatUserId`.
- [x] Change `buildTools()` to pass the storage context into `attachmentTools()`.
- [x] Keep watcher and identity behavior unchanged while fixing the attachment path.
- [x] Run the builder and attachment test suites.

**Verification commands:**

- `bun test tests/tools/tools-builder.test.ts tests/tools/attachment-tools.test.ts`

### 3. Make custom-field support honest and minimally correct

**Impact:** High. Current create/update APIs imply generic custom-field support, but implementation only works for simple text-like fields and silently loses data on reads.

**Files:**

- Modify: `src/providers/domain-types.ts`
- Modify: `src/providers/youtrack/mappers.ts`
- Modify: `src/tools/get-task.ts`
- Modify: `src/tools/create-task.ts`
- Possibly modify: `src/tools/update-task.ts`
- Test: `tests/providers/youtrack/operations/tasks.test.ts`
- Test: `tests/tools/create-task.test.ts`
- Test: `tests/tools/get-task.test.ts`

**Checklist:**

- [x] Decide on the minimal safe contract for this iteration: either expose read-only normalized custom fields, or narrow the write contract so it no longer pretends to support arbitrary field types.
- [x] Add failing tests for the chosen contract before touching implementation.
- [x] If read support is added, extend normalized task shape with a provider-safe custom-field representation and map YouTrack custom fields into it.
- [x] If write support remains limited, update tool descriptions and validation text so they explicitly describe supported field types instead of generic arbitrary fields.
- [x] Do not add speculative generic field-type mutation logic unless it is backed by actual bundle/type resolution.
- [x] Run provider and tool tests covering the revised contract.

**Verification commands:**

- `bun test tests/providers/youtrack/operations/tasks.test.ts tests/tools/create-task.test.ts tests/tools/get-task.test.ts`

---

## Phase 2: Missing Baseline Read Tools

### 4. Expose `get_project`

**Impact:** High. Provider support exists already; only the tool layer is missing.

**Files:**

- Create: `src/tools/get-project.ts`
- Modify: `src/tools/tools-builder.ts`
- Modify: `src/tools/index.ts` only if export paths need adjustment
- Test: `tests/tools/project-tools.test.ts`
- Test: `tests/tools/tools-builder.test.ts`
- Test: `tests/providers/youtrack/tools-integration.test.ts`

**Checklist:**

- [x] Add failing tool tests for a `get_project` tool that accepts `projectId` and returns one normalized project.
- [x] Implement `makeGetProjectTool()` using `provider.getProject!()`.
- [x] Gate exposure on `projects.read` in `buildTools()`.
- [x] Extend the integration test to expect `get_project` for YouTrack.
- [x] Run project-tool, builder, and integration suites.

**Verification commands:**

- `bun test tests/tools/project-tools.test.ts tests/tools/tools-builder.test.ts tests/providers/youtrack/tools-integration.test.ts`

### 5. Expose `get_current_user`

**Impact:** High. Provider support exists already; this improves identity, audit, and self-targeting flows.

**Files:**

- Create: `src/tools/get-current-user.ts`
- Modify: `src/tools/tools-builder.ts`
- Test: `tests/tools/tools-builder.test.ts`
- Test: `tests/providers/youtrack/tools-integration.test.ts`
- Create or extend: `tests/tools/get-current-user.test.ts`

**Checklist:**

- [x] Add failing tests for a `get_current_user` tool that returns the normalized provider user.
- [x] Implement `makeGetCurrentUserTool()` using `provider.getCurrentUser!()`.
- [x] Gate exposure on method presence plus a stable capability rule chosen for shared providers.
- [x] Extend builder and integration tests to expect the tool for YouTrack.
- [x] Run the new tool tests and builder suite.

**Verification commands:**

- `bun test tests/tools/get-current-user.test.ts tests/tools/tools-builder.test.ts tests/providers/youtrack/tools-integration.test.ts`

---

## Phase 3: Tool Contract Quality Improvements

### 6. Remove Kaneo-specific priority restrictions from shared task tools

**Impact:** Medium-high. Current schemas reject valid YouTrack priorities and create artificial incompatibility.

**Files:**

- Modify: `src/tools/create-task.ts`
- Modify: `src/tools/update-task.ts`
- Modify: `src/tools/list-tasks.ts`
- Test: `tests/tools/create-task.test.ts`
- Test: `tests/tools/update-task.test.ts`
- Test: `tests/tools/list-tasks.test.ts`

**Checklist:**

- [x] Add failing schema tests showing YouTrack-style priorities outside the current enum are accepted.
- [x] Replace fixed shared enums with a looser string contract where provider values are provider-defined.
- [x] Keep descriptions explicit that priority values must match the upstream provider's configured bundle.
- [x] Verify existing Kaneo-oriented tests still pass or update them to align with the less restrictive shared contract.

**Verification commands:**

- `bun test tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/list-tasks.test.ts`

### 7. Add name-based tag convenience without regressing ID-based label tools

**Impact:** Medium-high. MCP supports tag-name operations; papai currently requires prior `labelId` lookup and cannot mirror the common "add tag X" workflow directly.

**Files:**

- Modify: `src/providers/types.ts` only if a provider-level convenience method is introduced
- Modify: `src/providers/youtrack/labels.ts`
- Modify: `src/tools/add-task-label.ts`
- Modify: `src/tools/remove-task-label.ts`
- Test: `tests/tools/task-label-tools.test.ts`
- Possibly create: `tests/providers/youtrack/labels.test.ts`

**Checklist:**

- [x] Choose a minimal compatibility design: either accept both `labelId` and `labelName` in existing tools, or add explicit name-based aliases.
- [x] Add failing tests for the selected contract.
- [x] Implement name resolution using visible tag data without breaking existing ID-based flows.
- [x] Avoid lossy whole-list rewrites if YouTrack has a more direct issue-tag operation available and practical for this code path.
- [x] Update tool descriptions to tell the model when name-based usage is preferable.

**Verification commands:**

- `bun test tests/tools/task-label-tools.test.ts`

### 8. Add pagination knobs to read-heavy tools where it matters

**Impact:** Medium. MCP exposes pagination on comments, work items, project listing, and issue search; papai currently assumes unbounded or provider-default reads.

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/youtrack/operations/comments.ts`
- Modify: `src/providers/youtrack/operations/work-items.ts`
- Modify: `src/providers/youtrack/operations/projects.ts`
- Modify: `src/providers/youtrack/operations/tasks.ts`
- Modify: `src/tools/get-comments.ts`
- Modify: `src/tools/list-work.ts`
- Modify: `src/tools/list-projects.ts`
- Modify: `src/tools/search-tasks.ts`
- Test: `tests/tools/comment-tools.test.ts`
- Test: `tests/tools/work-item-tools.test.ts`
- Test: `tests/tools/project-tools.test.ts`
- Test: `tests/tools/search-tasks.test.ts`

**Checklist:**

- [x] Prioritize only the tools that produce large result sets in real usage: `search_tasks`, `get_comments`, and `list_work` first.
- [x] Add failing schema and execution tests for `offset`/`count` or `limit`-style controls before provider changes.
- [x] Extend provider signatures minimally, avoiding breaking existing callers.
- [x] Thread pagination through the YouTrack operations using `$skip` and `$top` where appropriate.
- [x] Keep default behavior backward-compatible when pagination is omitted.
- [x] Defer `list_projects` pagination if the real-world project count is usually small and the added contract complexity is not worth it yet.

**Verification commands:**

- `bun test tests/tools/comment-tools.test.ts tests/tools/work-item-tools.test.ts tests/tools/search-tasks.test.ts`

---

## Phase 4: Nice-to-Have MCP Parity and Deeper YouTrack Exposure

### 9. Decide whether to add a first-class `get_issue_summary` equivalent

**Impact:** Medium-low. Functionally redundant with `get_task`, but cheaper for models when only a title lookup is needed.

**Files:**

- Possibly create: `src/tools/get-task-summary.ts`
- Modify: `src/tools/tools-builder.ts` if added
- Test: new focused tool test if added

**Checklist:**

- [x] Confirmed `get_task` already subsumes the MCP summary-only endpoint for current papai usage. No separate `get_task_summary` tool will be added in this pass because it adds tool-surface area without reducing provider complexity or unlocking missing YouTrack functionality.
- [x] Verified the current single-task read path remains covered by `tests/tools/get-task.test.ts`, `tests/tools/tools-builder.test.ts`, and `tests/providers/youtrack/tools-integration.test.ts`.

### 10. Promote provider-only YouTrack features into intentional tools

**Impact:** Medium-low for MCP parity, high for product breadth. These are beyond the MCP baseline but already implemented under the provider.

**Files:**

- `src/providers/youtrack/phase-five-provider.ts`
- New tool files for chosen surfaces
- `src/tools/tools-builder.ts`
- Tests under `tests/tools/` and `tests/providers/youtrack/`

**Checklist:**

- [x] Evaluate whether `count_tasks`, agiles/sprints, task history, and saved queries should be exposed now or left provider-only.
- [x] Keep this work separate from MCP parity fixes so it does not delay correctness and missing-tool items.

> **Note**: Phase 5 tools (agiles, sprints, activities, saved queries, apply_youtrack_command) were already exposed in ADR-0068. The phase-five provider methods are all surfaced through `tools-builder.ts`.

---

## Recommended Execution Order

1. Fix due-date correctness.
2. Fix attachment builder context bug.
3. Make custom-field support honest and minimally correct.
4. Expose `get_project`.
5. Expose `get_current_user`.
6. Relax priority schema restrictions.
7. Add name-based tag convenience.
8. Add pagination where it materially improves large-result workflows.
9. Reassess summary-only and provider-only extensions.

## Scope Guardrails

- Do not attempt a generic "arbitrary YouTrack field editor" in this pass.
- Do not mix MCP parity work with unrelated provider refactors.
- Keep provider normalization stable for non-YouTrack providers.
- Prefer adding the smallest shared-provider contract needed for each new exposed tool.

## Self-Review

**Spec coverage:**

- Correctness bugs covered: due date, attachment builder context, custom field honesty.
- Missing MCP parity covered: `get_project`, `get_current_user`, tag convenience, pagination.
- Lower-priority parity items addressed explicitly: summary-only endpoint and provider-only features.

**Placeholder scan:**

- No `TODO`/`TBD` placeholders included.
- Each item includes exact file paths and verification commands.

**Type consistency:**

- Uses existing provider/tool naming conventions.
- Keeps `get_project` and `get_current_user` aligned with current provider method names.
