<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0068: YouTrack Gap Closure — Phase-Five Tool Exposure, Custom Field Honesty, and Command Escape Hatch

## Status

Accepted

## Date

2026-04-15

## Context

ADR-0052 implemented the full YouTrack API across five provider phases. Phases 1–4 exposed their provider methods as LLM-facing tools through `src/tools/tools-builder.ts`. Phase 5 (agiles, sprints, activities, saved queries) was implemented in the provider layer but never surfaced as tools — the builder had no wiring for those capabilities.

Additionally, two contract gaps existed in the shared tool surface:

1. **Custom fields were invisible**: `get_task` returned tasks without any custom field data, and `update_task` had no way to write custom fields. Users with YouTrack projects that relied on custom fields (Environment, Steps to Reproduce, etc.) could not see or modify them through the bot.

2. **No YouTrack-native command escape hatch**: Some YouTrack workflows use command syntax (`for me`, `State In Progress`, tag operations) that cannot be expressed through the normalized CRUD tool surface. Without an escape hatch, users hit dead ends for legitimate YouTrack-native operations.

The YouTrack tool parity checklist (`docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md`) identified these gaps as the highest-priority closure items.

## Decision Drivers

- **Must expose existing phase-five provider methods** — agiles, sprints, task history, and saved queries are already implemented but unreachable
- **Must make custom fields visible and writable** — `get_task` must return normalized custom field data; `update_task` must accept write-safe custom field updates
- **Must add a YouTrack-native command tool** — provider-specific escape hatch for workflows that don't fit normalized CRUD
- **Must use capability gating** — new tools only appear when the provider advertises the relevant capability
- **Must not add generic arbitrary-field editing** — keep custom field writes limited to simple/text fields with project field validation
- **Must follow TDD** — tests first, then implementation

## Considered Options

### Option 1: Expose phase-five methods, tighten custom field contract, add command escape hatch (chosen)

Three independent workstreams:

1. **Agile/sprint tools**: `list_agiles`, `list_sprints`, `create_sprint`, `update_sprint`, `assign_task_to_sprint`
2. **History/saved-query tools**: `get_task_history`, `list_saved_queries`, `run_saved_query`
3. **Custom field honesty**: Extend `Task` with `customFields`, add mapper logic for read-only fields, add write-safe `customFields` param to `update_task` and `create_task`
4. **Command escape hatch**: `apply_youtrack_command` tool backed by YouTrack `/api/commands`

**Pros:**

- Closes all three gaps in one coherent pass
- Each workstream is independently testable and committable
- Custom field writes are validated against project field metadata — prevents arbitrary mutation
- Command tool is provider-gated to YouTrack only

**Cons:**

- Broad surface area across provider types, mappers, task helpers, tools, and tests
- Custom field support is limited to simple string/text fields — enum and multi-value fields remain read-only

### Option 2: Only expose phase-five tools, defer custom fields

Ship agile/sprint/history/query tools now, address custom fields separately.

**Pros:**

- Smaller initial change set
- Less risk of mapper regression

**Cons:**

- Leaves the biggest usability gap (invisible custom fields) open
- Users still cannot see or edit custom fields through the bot

### Option 3: Generic arbitrary-field editor

Add a generic `update_custom_field(taskId, fieldName, rawValue)` tool that accepts any field name and value.

**Pros:**

- Maximum flexibility

**Cons:**

- Bypasses project field validation — can write to State, Priority, and other fields that have dedicated tools
- No type safety or validation against YouTrack project schema
- Security risk: LLM could mutate fields it shouldn't touch

## Decision

Implement **Option 1**: Expose phase-five provider methods as tools, add honest custom field support with project-field validation, and add a YouTrack-specific command escape hatch.

The implementation is organized into five tasks:

1. **Task 1**: Expose agile and sprint tools (5 tools, capability-gated)
2. **Task 2**: Expose task history and saved query tools (3 tools, capability-gated)
3. **Task 3**: Make shared task tools honest about custom fields (extend `Task`, mappers, `update_task`, `get_task`)
4. **Task 4**: Add `apply_youtrack_command` escape hatch (provider-gated to YouTrack only)
5. **Task 5**: Final regression and surface audit

## Rationale

1. **Phase-five methods already exist**: The provider layer (`src/providers/youtrack/phase-five-provider.ts`) already implements `listAgiles`, `listSprints`, `createSprint`, `updateSprint`, `assignTaskToSprint`, `getTaskHistory`, `listSavedQueries`, and `runSavedQuery`. Exposing them only requires tool wrappers and builder wiring — no provider changes.

2. **Custom field honesty prevents silent data loss**: When `get_task` omits custom fields, the LLM cannot reason about them and may overwrite them unintentionally through `update_task`. Surfacing read-only fields and accepting write-safe fields closes this gap.

3. **Write-safe validation prevents misuse**: `buildWriteSafeCustomFields()` validates against project field metadata, rejects reserved fields (State, Priority, Assignee, Due Date), and only allows simple/text field types. This is safer than a generic editor.

4. **Command escape hatch is provider-gated**: `apply_youtrack_command` only appears when `provider.name === 'youtrack'` and the `tasks.commands` capability is present. Kaneo and future providers never see it.

## Consequences

### Positive

- 8 new phase-five tools exposed (agiles, sprints, history, saved queries)
- Custom fields are visible in `get_task` output and writable in `update_task`
- YouTrack-native command workflows are accessible through `apply_youtrack_command`
- Capability gating ensures tools only appear for providers that support them
- Project field validation prevents writing to reserved or unsupported custom fields

### Negative

- Custom field support is limited to simple string/text fields — enum, multi-value, and date custom fields remain read-only
- `update_task` now requires an extra provider round-trip (project field metadata fetch) when `customFields` are present
- Broader tool surface increases LLM context consumption

### Risks

- **Custom field write surface may grow**: Users may request enum and multi-value custom field writes. Mitigation: the write-safe builder can be extended incrementally per field type.
- **Command escape hatch scope creep**: `apply_youtrack_command` could become a crutch for operations that should have structured tools. Mitigation: prompt addendum guidance restricts the model to using the command tool only when structured tools cannot express the operation.
- **Read-only field list must track reserved fields**: If new reserved fields are added (e.g., Sprint), the exclusion set in `mapReadOnlyCustomFields` and `NON_GENERIC_FIELD_NAMES` must be updated. Mitigation: these sets are centralized in `task-helpers.ts`.

## Implementation Notes

### New Tool Files

| File                                  | Tool                     |
| ------------------------------------- | ------------------------ |
| `src/tools/list-agiles.ts`            | `list_agiles`            |
| `src/tools/list-sprints.ts`           | `list_sprints`           |
| `src/tools/create-sprint.ts`          | `create_sprint`          |
| `src/tools/update-sprint.ts`          | `update_sprint`          |
| `src/tools/assign-task-to-sprint.ts`  | `assign_task_to_sprint`  |
| `src/tools/get-task-history.ts`       | `get_task_history`       |
| `src/tools/list-saved-queries.ts`     | `list_saved_queries`     |
| `src/tools/run-saved-query.ts`        | `run_saved_query`        |
| `src/tools/apply-youtrack-command.ts` | `apply_youtrack_command` |

### New Provider Operation

| File                                            | Purpose                                    |
| ----------------------------------------------- | ------------------------------------------ |
| `src/providers/youtrack/operations/commands.ts` | Low-level YouTrack `/api/commands` wrapper |

### Modified Provider Files

| File                                         | Change                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/providers/domain-types.ts`              | Add `TaskCustomField` type, `TaskCommandResult` type                                               |
| `src/providers/types.ts`                     | Add capabilities: `agiles.list`, `sprints.*`, `activities.read`, `queries.saved`, `tasks.commands` |
| `src/providers/youtrack/constants.ts`        | Add new capability strings to YouTrack set                                                         |
| `src/providers/youtrack/mappers.ts`          | Add `mapReadOnlyCustomFields()` for normalized read-only data                                      |
| `src/providers/youtrack/task-helpers.ts`     | Add `buildWriteSafeCustomFields()` with project field validation                                   |
| `src/providers/youtrack/operations/tasks.ts` | Thread `customFields` through create/update paths                                                  |
| `src/providers/youtrack/index.ts`            | Wire `applyCommand` method                                                                         |
| `src/providers/youtrack/prompt-addendum.ts`  | Add command-tool usage guidance                                                                    |

### Builder Helpers

Three new `maybeAdd...` helpers in `src/tools/tools-builder.ts`:

- `maybeAddPhaseFiveSprintTools()` — gated on `agiles.list`, `sprints.*`
- `maybeAddPhaseFiveQueryTools()` — gated on `activities.read`, `queries.saved`
- `maybeAddYouTrackCommandTool()` — gated on `provider.name === 'youtrack'` + `tasks.commands`

### Scope Guardrails

- No generic arbitrary-field editor on the shared provider contract
- No multi-value custom field support in this pass
- No provider internals rewritten outside listed files
- No phase-five tools for providers that don't advertise the relevant capability
- `apply_youtrack_command` for advanced flows instead of pushing provider-specific semantics into every shared tool

## Verification

- Agile tools: `bun test tests/tools/agile-tools.test.ts tests/providers/youtrack/operations/agiles.test.ts`
- History tools: `bun test tests/tools/task-history-tools.test.ts tests/providers/youtrack/operations/activities.test.ts`
- Saved query tools: `bun test tests/tools/saved-query-tools.test.ts tests/providers/youtrack/operations/saved-queries.test.ts`
- Custom field honesty: `bun test tests/providers/youtrack/operations/tasks.test.ts tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts`
- Command tool: `bun test tests/providers/youtrack/operations/commands.test.ts tests/tools/youtrack-command.test.ts`
- Surface gating: `bun test tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts`

## Related Decisions

- ADR-0052: YouTrack Full API Implementation (implemented phase-five provider methods)
- ADR-0058: Provider Capability Architecture (capability gating model)
- ADR-0067: YouTrack Bulk Command Safety Boundary (constrained `apply_youtrack_command` to single-issue)
- ADR-0031: Provider-Agnostic Status vs Column Abstraction (normalized field abstraction precedent)

## References

- Plan: `docs/superpowers/plans/2026-04-15-youtrack-gap-closure.md`
- Parity Checklist: `docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md`
- YouTrack REST API: https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html
