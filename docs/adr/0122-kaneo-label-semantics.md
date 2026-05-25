<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0122: Kaneo Scope-Aware Label Semantics

## Status

Implemented (with noted deviations)

## Date

2026-05-22 – 2026-05-23

## Context

Kaneo stores labels in a single `label` table whose rows are overloaded: a row
with `taskId = null` is a reusable workspace-level label; a row with a non-null
`taskId` is a task-scoped copy created when that label was applied to a task.
Both kinds share the same `/api/label` endpoint response, so a plain
`listLabels()` call returns a mix of workspace labels and task-local copies.

This caused two classes of operational problems:

1. **Duplicate creation.** `create_label` had no visibility into whether a
   workspace label already existed. Calling it with a name that was already
   present created a second reusable workspace label rather than reporting the
   collision.

2. **Redundant mutations.** `add_task_label` and `remove_task_label` resolved
   label IDs exclusively from the workspace label list. When a task already had
   a label attached, adding it again silently called the Kaneo API a second
   time. Removing a label by name could not find the task-scoped label id (which
   differs from the workspace label id) and would error or no-op incorrectly.

Neither issue existed for YouTrack, whose label model is genuinely different.
The fix had to be Kaneo-specific without coupling shared tool code to
provider-internal details.

Implementation plan in `docs/archive/2026-05-22-kaneo-label-semantics-plan.md`.

## Decision Drivers

- **Correctness over simplicity**: LLM tool results must be actionable — a
  silent duplicate or a silent no-op is worse than an honest structured status.
- **Provider isolation**: No other provider has this two-kind label model.
  Shared tool code must not hardcode Kaneo assumptions; the Kaneo branch must
  be guarded by `isKaneoProvider()`.
- **Non-fatal structured statuses**: `already_exists`, `already_present`, and
  `already_absent` must be returned as structured objects (not thrown errors) so
  the LLM can read and reason about them without hitting an error recovery path.
- **Two views of labels**: The provider layer must expose `listLabels()` for
  reusable workspace labels and a new `listTaskLabels(taskId)` for the
  task-scoped copies. Tools consume these two views separately.

## Considered Options

### Option 1: Filter at the existing `listLabels()` call site

Return only `taskId === null` rows from `listLabels()`. Teach tools to detect
already-present / already-absent states by comparing against the filtered list.

- **Pros**: Minimal new API surface.
- **Cons**: `listLabels()` returns workspace labels; task-scoped copies are
  needed to detect `already_present` / `already_absent`, and those IDs differ
  from workspace label IDs. A single filtered list is insufficient.

### Option 2: New `listTaskLabels(taskId)` provider method + filter in `listLabels()`

Add `listTaskLabels?(taskId: string): Promise<TaskLabel[]>` to the provider
contract (optional, Kaneo-only). Filter `listLabels()` to workspace labels only.
Tools branch on `isKaneoProvider()` to call the appropriate view.

- **Pros**: Clean separation of the two label views; task-scoped id resolution
  is unambiguous; non-Kaneo providers are unaffected.
- **Cons**: Requires a new endpoint call for every task-label mutation — one
  extra round trip per `add_task_label` / `remove_task_label` invocation.

### Option 3: Enrich task fetch to include attached labels

Attach label state to `getTask()` responses and cache it in the tool layer.

- **Pros**: Fewer round trips when the task is already fetched.
- **Cons**: Requires schema changes to the normalized `Task` type; couples label
  state to task fetch; more complex invalidation.

## Decision

**Option 2.** Add `listTaskLabels?(taskId: string): Promise<TaskLabel[]>` to
`TaskProvider` (optional; only Kaneo implements it). Filter `listLabels()` on
the Kaneo side to reusable workspace labels only. Guard all Kaneo-specific
branching in tools with `isKaneoProvider()` from a new
`src/tools/kaneo-label-helpers.ts` module.

The `isReusableWorkspaceLabel` predicate in `operations/labels.ts` accepts both
`taskId === null` and `taskId === undefined` because the Kaneo API sometimes
omits the field entirely rather than returning `null` (discovered during
implementation; the plan showed only the `=== null` case).

## Consequences

### Positive

- `create_label` returns `{ status: 'already_exists', labelName, existingLabelIds }`
  when the workspace already has a label by that name, instead of silently
  creating a duplicate.
- `add_task_label` returns `{ status: 'already_present', taskId, labelName, taskLabelIds }`
  when the task already has the label, for both the `labelName` and `labelId`
  input cases.
- `remove_task_label` returns `{ status: 'already_absent', taskId, labelName }`
  (or `{ ..., labelId }`) when the task does not currently have the label,
  instead of erroring or calling the API unnecessarily.
- All non-Kaneo providers are unaffected; the `isKaneoProvider()` guard is the
  sole branch point in shared tool code.
- `listLabels()` now returns only reusable workspace labels on Kaneo, which is
  the semantically correct set for label management tools.

### Negative

- Each `add_task_label` and `remove_task_label` call on Kaneo now makes an extra
  `GET /api/label/task/:id` round trip to check current task-label state.
- The `already_present` / `already_absent` checks add conditional complexity to
  two tool files (`add-task-label.ts`, `remove-task-label.ts`).

### Deviations from plan

- `isReusableWorkspaceLabel` predicate extended to also pass `taskId === undefined`
  (plan showed only `=== null`); this fixes a real Kaneo API inconsistency.
- `kaneo-label-helpers.ts` exports a fourth function `listWorkspaceLabels`
  (unconditional, no name filter) needed by `add-task-label.ts` when resolving
  presence by `labelId` through workspace label name lookup.
- `add-task-label.ts` Kaneo branch extended to detect `already_present` even
  when the caller passes a workspace `labelId` rather than `labelName`, via
  `resolveKaneoAlreadyPresent`.
- `remove-task-label.ts` uses two `AlreadyAbsent` variants (`ByName`, `ById`)
  and a `resolveKaneoTaskLabelIdById` helper that resolves workspace label names
  to find the task-scoped match when a workspace `labelId` is passed.
- SQL deduplication scripts (`kaneo-label-dedup-preview.sql`,
  `kaneo-label-dedup-apply.sql`) were initially created and then intentionally
  dropped (`0f4d691f`). The query approach is preserved in the archived plan for
  future reference if deduplication is needed.
- Six standalone test files were added beyond the plan's test modifications to
  give each new source module its own test suite.

## Implementation Notes

- `src/providers/kaneo/label-resource.ts` — `listForTask(taskId)` method added,
  calling `GET /api/label/task/:id`.
- `src/providers/kaneo/list-task-labels.ts` — thin wrapper delegating to the
  resource via `KaneoClient`.
- `src/providers/kaneo/operations/labels.ts` — `kaneoListLabels` filters with
  `isReusableWorkspaceLabel`; `kaneoListTaskLabels` delegates to the new module.
- `src/providers/kaneo/index.ts` — exposes `listTaskLabels(taskId)`.
- `src/tools/kaneo-label-helpers.ts` — `isKaneoProvider`, `listWorkspaceLabels`,
  `listVisibleWorkspaceLabels`, `listTaskLabels`.
- `src/tools/create-label.ts`, `add-task-label.ts`, `remove-task-label.ts` —
  Kaneo-specific branches added.

## Related Decisions

- ADR-0115: Kaneo label tools (original label tool surface).
- ADR-0120: Central LLM credentials, billing, stats — unrelated; concurrent
  work on the same branch window.
