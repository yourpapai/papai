<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0117: YouTrack Tool Parity Closure — Due-Date Correctness, Attachment Context Bug, and Priority Contract Relaxation

## Status

Accepted

## Date

2026-04-14

## Context

Following ADR-0068 (YouTrack Gap Closure — phase-five tools, custom fields, command escape hatch) and ADR-0078 (YouTrack Remaining Parity Gaps — pagination controls), the YouTrack tool surface still contained three categories of gaps versus the cloned MCP baseline:

1. **Correctness bugs**: Existing tool contracts claimed due-date support and custom-field writes, but the YouTrack provider silently dropped due-date data on both create and update paths, and the issue field selection did not fetch due-date custom fields on reads. Additionally, the attachment tool builder wired `upload_attachment` against `chatUserId` instead of the storage `contextId`, causing file-relay lookup failures in group-thread contexts.

2. **Missing baseline read tools**: The provider already supported `getProject()` and `getCurrentUser()`, but neither was exposed as an LLM tool.

3. **Artificial schema restrictions**: The shared `create_task`, `update_task`, and `list_tasks` schemas used `z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])` for priority. This rejected valid YouTrack values (e.g., "Show-stopper", "Critical", "Major") and caused artificial incompatibility, even though priority values are provider-defined per-project bundles.

The parity checklist (`docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md`) ranked work into four phases — correctness first, then missing read tools, then contract quality, then nice-to-have future items.

## Decision Drivers

- **Must fix correctness before adding surface area**: A tool that advertises due-date support but silently drops the value is worse than no tool at all
- **Must prevent context-mixing bugs**: `chatUserId` and `contextId` serve different purposes; attachment file relay depends on the storage context
- **Must expose provider methods already implemented**: `getProject` and `getCurrentUser` exist but are unreachable
- **Must remove provider-specific enums from shared schemas**: Priority values vary per-provider and per-project; hard-coding Kaneo values rejects legitimate YouTrack values
- **Must follow TDD**: Each checklist item adds failing tests before implementation

## Considered Options

### Option 1: Execute in ranked phases — correctness first, then read tools, then contract quality (chosen)

Organize work into four sequential phases:

1. **Phase 1 — Correctness bugs**: Fix due-date end-to-end encoding/decoding; fix attachment context bug in tools-builder; tighten custom-field write contract (already partially addressed in ADR-0068)
2. **Phase 2 — Missing baseline read tools**: Expose `get_project` and `get_current_user`
3. **Phase 3 — Contract quality**: Replace Kaneo-specific priority enums with `z.string().trim().min(1)`; add name-based tag convenience; add pagination knobs (already partially addressed in ADR-0078)
4. **Phase 4 — Nice-to-have**: Decide against `get_task_summary`; defer `list_projects` pagination

**Pros:**

- Correctness bugs land before new surface area, so users aren't exposed to broken existing claims
- Each phase is independently committable
- Lowest risk of regressing existing behavior

**Cons:**

- More sequential files to touch than a single-shot change
- Requires discipline to avoid scope creep into unrelated refactors

### Option 2: Single-shot PR with all changes at once

Combine all checklist items into one large changeset.

**Pros:**

- Potentially faster if parallel workstreams don't conflict

**Cons:**

- Blurs correctness fixes with new features in the same diff
- Harder to review; harder to bisect if something breaks
- Against the repo's TDD enforcement (hooks run per-file)

### Option 3: Add provider-level field-type introspection for generic custom-field editing

Instead of limiting custom-field writes to simple string/text, build a full YouTrack field-type resolver that supports enums, multi-values, dates, etc.

**Pros:**

- Maximum flexibility for users

**Cons:**

- High complexity; requires bundle/type resolution that does not yet exist
- Security risk — LLM could mutate reserved fields without validation
- The plan explicitly scoped this out; the minimal contract was sufficient for the current iteration

## Decision

Implement **Option 1**, executing the parity checklist in ranked phases. The following sections document the specific decisions made for items not already captured in ADR-0068 or ADR-0078.

### Decision 1: Encode/decode due date via custom-field payload (not top-level field)

YouTrack stores due dates as a `DateIssueCustomField` named "Due Date" with an epoch-ms value, not as a top-level issue property. The provider must:

- **On write**: Parse the ISO/YYYY-MM-DD input into a `Date.parse()`ed epoch-ms and send it as `customFields: [{ name: 'Due Date', $type: 'DateIssueCustomField', value: <epoch-ms> }]`
- **On read**: Extract the epoch-ms from the `DateIssueCustomField` in the issue response and map it to `YYYY-MM-DD`
- **On enrichment fallback**: If the issue response lacks the due date (some YouTrack configurations don't inline it), paginate `/api/issues/{id}/customFields` to locate it

Rationale: Using custom-field payload keeps the provider aligned with YouTrack's data model. The normalized `Task.dueDate` remains an ISO date string, insulating tools from YouTrack-specific field names.

### Decision 2: Attachment tools must consume `contextId`, not `chatUserId`

In `src/tools/tools-builder.ts`, `addAttachmentTools()` receives the storage `contextId` (e.g., `user-123:group-456`) because the staged-file workspace (S3 relay) keys blobs by `contextId`. Using `chatUserId` would cause lookup misses in group/thread contexts where the user and storage context differ.

Rationale: The builder already passes `contextId` into `addAttachmentTools()`; the bug was already fixed before this pass. This ADR records the rationale explicitly.

### Decision 3: Replace hard-coded priority enum with `z.string().trim().min(1)`

Remove the `z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])` from `create_task`, `update_task`, and `list_tasks` tool schemas. Replace with `z.string().trim().min(1)` and update descriptions to state that values must match the upstream provider's configured priority bundle.

Rationale: YouTrack priority values are configured per-project in the upstream bundle. Rejecting "Critical" because it isn't in a Kaneo enum creates false validation failures. A string contract delegates validation to the provider, where the upstream can return a proper error message.

### Decision 4: Expose `get_project` and `get_current_user` as capability-gated tools

- `get_project`: Gated on `projects.read` + `provider.getProject !== undefined`
- `get_current_user`: Gated on `provider.identityResolver !== undefined` + `provider.getCurrentUser !== undefined`

Rationale: Both provider methods already exist. The tool layer was simply missing the wiring. Capability gating ensures non-YouTrack providers don't expose tools they can't fulfill.

### Decision 5: Name-based label resolution via existing `getLabelByName` or `listLabels` fallback

For `add_task_label` and `remove_task_label`, accept either `labelId` or `labelName` (exactly one required). If `labelName` is provided, prefer `provider.getLabelByName()` (YouTrack-specific) or fall back to `provider.listLabels()` filtered client-side.

Rationale: MCP supports tag-name operations; requiring a prior `labelId` lookup created an extra LLM round-trip. Name resolution uses visible tag data and does not break existing ID-based flows.

### Decision 6: Do not add a separate `get_task_summary` tool

`get_task` already returns the title, status, priority, and other minimal fields. A separate summary-only endpoint would add tool-surface area without reducing provider complexity or unlocking missing YouTrack functionality.

Rationale: Tool count directly affects the LLM context window. Only add tools that provide material new capability.

### Decision 7: Defer `list_projects` pagination

Project counts in real-world papai usage are typically small (< 50). Adding `limit`/`offset` to `list_projects` would require provider contract changes and YouTrack `$skip`/`$top` wiring for a rare edge case. Deferred until telemetry shows a need.

Rationale: The `paginate()` helper already fetches all non-archived projects. For usability, a complete list is preferable to chunked navigation for small result sets.

## Consequences

### Positive

- Due dates round-trip correctly through create/update/read paths for YouTrack
- Attachment uploads work reliably in group/thread contexts
- YouTrack-style priority values are accepted without false rejections
- `get_project` and `get_current_user` improve identity, audit, and self-targeting flows
- Name-based label assignment mirrors MCP tag-name workflows

### Negative

- `list_projects` remains unbounded (no `limit`/`offset`); very large YouTrack instances could return many projects
- Custom-field writes remain limited to simple string/text types
- No dedicated `get_task_summary` means models always fetch full task detail even when only the title is needed

### Risks

- **Model over-fetch on `get_task`**: Without a summary tool, the model may fetch full task data repeatedly. Mitigation: documented deferral with revisit criteria (telemetry showing over-fetch).
- **Unbounded `list_projects`**: Mitigation: `paginate()` helper caps at 10 pages (100/page). Future ADR if real-world instances exceed this.

## Implementation Notes

### Key files modified

| File                                         | Change                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/providers/youtrack/mappers.ts`          | `mapIssueToTask` and `mapIssueToListItem` now extract due date from custom fields and custom-field timestamp           |
| `src/providers/youtrack/constants.ts`        | `YOUTRACK_DUE_DATE_FIELD_NAME` defined; `ISSUE_FIELDS` fetches custom fields inline                                    |
| `src/providers/youtrack/operations/tasks.ts` | `createYouTrackTask`/`updateYouTrackTask` send `DateIssueCustomField`; `getYouTrackTask` calls `enrichTaskWithDueDate` |
| `src/providers/youtrack/task-helpers.ts`     | `buildCustomFields` encodes due date as epoch-ms; `enrichTaskWithDueDate` paginates custom fields for fallback         |
| `src/providers/youtrack/due-date.ts`         | `parseDueDateValue` normalizes ISO and YYYY-MM-DD to epoch-ms; `mapYouTrackDueDateValue` returns `YYYY-MM-DD`          |
| `src/tools/create-task.ts`                   | Priority changed from enum to `z.string().trim().min(1).optional()`                                                    |
| `src/tools/update-task.ts`                   | Priority changed from enum to `z.string().trim().min(1).optional()`                                                    |
| `src/tools/list-tasks.ts`                    | Priority filter changed from enum to `z.string().trim().min(1).optional()`                                             |
| `src/tools/get-project.ts`                   | New tool using `provider.getProject()`                                                                                 |
| `src/tools/get-current-user.ts`              | New tool using `provider.getCurrentUser()`                                                                             |
| `src/tools/add-task-label.ts`                | Accepts `labelId` or `labelName`, resolves name to ID                                                                  |
| `src/tools/remove-task-label.ts`             | Accepts `labelId` or `labelName`, resolves name to ID                                                                  |
| `src/tools/tools-builder.ts`                 | Wires `get_project`, `get_current_user`, and attachment tools with `contextId`                                         |

### Tests added or extended

| File                                                 | Coverage                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tests/providers/youtrack/operations/tasks.test.ts`  | Due-date create/write/read mapping, custom-field read-only mapping, workflow validation |
| `tests/tools/create-task.test.ts`                    | Provider-defined priority acceptance, customField passthrough, timezone handling        |
| `tests/tools/update-task.test.ts`                    | Provider-defined priority acceptance, customField passthrough, timezone handling        |
| `tests/tools/get-task.test.ts`                       | Normalized customField return, timezone handling                                        |
| `tests/tools/project-tools.test.ts`                  | `get_project` tool existence, schema, execution                                         |
| `tests/tools/get-current-user.test.ts`               | `get_current_user` tool existence, schema, execution                                    |
| `tests/tools/task-label-tools.test.ts`               | Name-based resolution, ID-based preservation, error cases                               |
| `tests/providers/youtrack/tools-integration.test.ts` | Expected tool surface now includes `get_project` and `get_current_user`                 |

## Verification

All targeted test suites pass:

```bash
# Provider correctness
bun test tests/providers/youtrack/operations/tasks.test.ts

# Tool schemas and execution
bun test tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts

# Builder context and project tools
bun test tests/tools/tools-builder.test.ts tests/tools/project-tools.test.ts

# Integration
bun test tests/tools/get-current-user.test.ts tests/providers/youtrack/tools-integration.test.ts
```

## Related Decisions

- ADR-0052: YouTrack Full API Implementation (base provider layer)
- ADR-0058: Provider Capability Architecture (capability gating model)
- ADR-0060: User Identity Mapping (`get_current_user` depends on identity resolver)
- ADR-0068: YouTrack Gap Closure (phase-five tools, custom fields, command tool — subsumes item 3, 7, and 10 of the parity checklist)
- ADR-0078: YouTrack Remaining Parity Gaps (pagination controls — subsumes items 8 and 9 of the parity checklist)

## References

- Plan: `docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md` (archived)
- YouTrack REST API: https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html
