<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0078: YouTrack Remaining Parity Gaps — Pagination Controls and Provider Cleanup

## Status

Accepted

## Date

2026-04-16

## Context

Following ADR-0068 (YouTrack Gap Closure), which exposed phase-five provider methods and added custom field support, several parity gaps remained between papai's YouTrack tool surface and the MCP baseline. These gaps primarily involved:

1. **Missing pagination controls on high-volume read tools**: `get_comments`, `list_work`, and `search_tasks` had no pagination parameters, risking unbounded result sets and silent truncation.

2. **Implicit summary-only task lookup decision**: The tool parity checklist (2026-04-14) noted a potential `get_task_summary` tool, but no explicit decision had been made about whether to add it or rely on `get_task`.

3. **Hard-capped project listing**: YouTrack's `list_projects` used a fixed `$top=100` cap with no pagination, limiting visibility for instances with more than 100 projects.

The parity checklist explicitly deferred pagination to a follow-up pass (item 8), noting that MCP exposes pagination on comments, work items, project listing, and issue search, while papai assumed unbounded or provider-default reads.

## Decision Drivers

- **Must add pagination to high-volume reads**: `get_comments`, `list_work`, and `search_tasks` produce large result sets in real usage
- **Must prevent silent truncation**: Offset-only reads should continue bounded pagination rather than falling back to server-default page sizes
- **Must make summary-only lookup decision explicit**: Either add `get_task_summary` or document that `get_task` subsumes the use case
- **Must remove provider-side hard caps**: Project listing should paginate like other collection reads
- **Must preserve backward compatibility**: Existing callers without pagination params should work unchanged
- **Must follow TDD**: Tests first, then implementation

## Considered Options

### Option 1: Add offset/limit pagination to comments, work items, and search; paginate projects; defer summary tool (chosen)

Four independent workstreams:

1. **Comment pagination**: Add optional `limit` and `offset` to `get_comments` tool and `getComments` provider contract; implement YouTrack `$top`/`$skip` translation with bounded pagination for offset-only reads

2. **Work-item pagination**: Add optional `limit` and `offset` to `list_work` tool and `listWorkItems` provider contract; reuse shared `paginate()` helper with initial offset support

3. **Search pagination**: Add optional `offset` to `search_tasks` tool (already has `limit`); extend provider contract and YouTrack `$skip` passthrough

4. **Project pagination**: Replace fixed `$top=100` in `list_projects` with shared `paginate()` helper (10 pages × 100 items)

5. **Summary tool decision**: Document deferral; keep `get_task` as canonical single-task read

**Pros:**

- Closes all pagination gaps identified in parity checklist
- Bounded pagination prevents silent truncation on offset-only reads
- Optional params preserve backward compatibility
- No new tool surface area unless telemetry shows need
- Each workstream independently testable and committable

**Cons:**

- Multiple provider contract extensions (though all are backward-compatible optional params)
- Offset-only pagination adds complexity (requires continuing bounded fetch from offset)
- Summary tool deferral may need revisiting if model telemetry shows over-fetch

### Option 2: Add page/size pagination instead of offset/limit

Use `page` and `pageSize` semantics instead of `offset` and `limit`.

**Pros:**

- Familiar to developers using paginated APIs

**Cons:**

- Inconsistent with existing `get_task_history` semantics (already uses `offset`)
- YouTrack REST API uses `$skip`/`$top` (offset/limit), requiring translation layer
- Less flexible for UI patterns like "load more" that track last seen offset

### Option 3: Add summary-only `get_task_summary` tool now

Create a dedicated lightweight task lookup tool returning only id, title, and minimal metadata.

**Pros:**

- Cheaper for models when only title lookup is needed
- Matches MCP's summary-only endpoint

**Cons:**

- Functionally redundant with `get_task`
- Adds tool surface area without reducing provider complexity
- No telemetry evidence yet that over-fetch is a problem
- Decision rule: only add if it provides materially smaller, lower-risk contract

### Option 4: Generic arbitrary-field editor for custom fields

Expose a generic `update_custom_field(taskId, fieldName, value)` tool.

**Pros:**

- Maximum flexibility

**Cons:**

- Bypasses project field validation
- No type safety against YouTrack project schema
- Security risk: LLM could mutate reserved fields
- Already explicitly rejected in ADR-0068

## Decision

Implement **Option 1**: Add offset/limit pagination to comments, work items, and search; paginate projects; explicitly defer summary tool.

The implementation is organized into six tasks:

1. **Task 1**: Add pagination to `get_comments` (limit/offset tool params, provider contract, YouTrack `$top`/`$skip`)
2. **Task 2**: Add pagination to `list_work` (limit/offset tool params, provider contract, paginate helper with initial offset)
3. **Task 3**: Add pagination to `search_tasks` (offset param, provider contract extension, `$skip` passthrough)
4. **Task 4**: Remove fixed `$top=100` cap from `list_projects` (shared paginate helper)
5. **Task 5**: Document summary-only tool decision (defer to `get_task`)
6. **Task 6**: Final verification and plan completion

## Rationale

1. **Pagination prevents real-world problems**: Large result sets from active YouTrack instances could hit memory limits or cause timeouts. Optional params let callers control their own batch size.

2. **Offset-only bounded pagination prevents silent truncation**: If a caller specifies `offset: 100` without `limit`, naive implementation might return only YouTrack's default page (42 items). Continuing bounded pagination from the offset ensures all results are fetched.

3. **Backward compatibility**: All pagination params are optional; existing code continues working unchanged.

4. **Provider contract minimalism**: Only extend contracts where tool surface truly needs it. No generic arbitrary-field editor, no redundant summary tool.

5. **Test-first approach**: Each task starts with failing tests, ensuring regression coverage and clear verification criteria.

## Consequences

### Positive

- `get_comments`, `list_work`, and `search_tasks` support optional `limit` and `offset` parameters
- Project listing fetches all projects via pagination, not just first 100
- Offset-only reads continue bounded pagination rather than silently truncating
- Summary-only tool decision is explicit and documented
- Full test coverage for all pagination paths

### Negative

- Slightly more complex provider operations (handling both explicit limit and offset-only cases)
- Shared `paginate()` helper now supports initial offset, slightly increasing its surface area
- Summary tool deferral may need revisiting if model telemetry shows need

### Risks

- **Pagination edge cases**: Offset calculations, empty results, last partial pages. Mitigation: comprehensive tests covering explicit pagination, offset-only, and no-pagination cases.
- **Performance on very large offsets**: Deep pagination can be slow. Mitigation: bounded pagination (max 10 pages × 100 items) prevents runaway; deep offsets would need cursor-based approach (out of scope).
- **Summary tool scope creep**: Future requests may pressure adding `get_task_summary`. Mitigation: documented deferral with clear revisit criteria (model telemetry showing over-fetch).

## Implementation Notes

### Modified Provider Contracts

| File                     | Change                                                 |
| ------------------------ | ------------------------------------------------------ |
| `src/providers/types.ts` | `getComments?(taskId, params?: { limit?, offset? })`   |
| `src/providers/types.ts` | `listWorkItems?(taskId, params?: { limit?, offset? })` |
| `src/providers/types.ts` | `searchTasks(params: { ..., offset? })`                |

### Modified Provider Operations

| File                                              | Change                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/providers/youtrack/operations/comments.ts`   | Handle explicit limit, offset-only bounded pagination, no-pagination default |
| `src/providers/youtrack/operations/work-items.ts` | Handle explicit limit, offset-only via shared paginate helper                |
| `src/providers/youtrack/operations/tasks.ts`      | Add `$skip` passthrough for search offset                                    |
| `src/providers/youtrack/operations/projects.ts`   | Replace fixed `$top=100` with shared `paginate()` helper                     |
| `src/providers/youtrack/helpers.ts`               | Add `initialSkip` param to `paginate()` for offset-only support              |

### Modified Tools

| File                        | Change                                                     |
| --------------------------- | ---------------------------------------------------------- |
| `src/tools/get-comments.ts` | Add `limit` and `offset` to input schema, pass to provider |
| `src/tools/list-work.ts`    | Add `limit` and `offset` to input schema, pass to provider |
| `src/tools/search-tasks.ts` | Add `offset` to input schema, pass to provider             |

### Modified Tests

| File                                                     | Coverage                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| `tests/tools/comment-tools.test.ts`                      | Schema validation, passthrough, offset-only semantics       |
| `tests/tools/work-item-tools.test.ts`                    | Schema validation, passthrough, offset-only semantics       |
| `tests/tools/search-tasks.test.ts`                       | Schema validation, passthrough, offset param                |
| `tests/providers/youtrack/operations/comments.test.ts`   | `$top`/`$skip` query params, offset-only bounded pagination |
| `tests/providers/youtrack/operations/work-items.test.ts` | `$top`/`$skip` query params, offset-only bounded pagination |
| `tests/providers/youtrack/operations/tasks.test.ts`      | Search `$skip` passthrough                                  |
| `tests/providers/youtrack/operations/projects.test.ts`   | Multi-page fetch, pagination params                         |

### Scope Guardrails

- No generic arbitrary-field editor on shared provider contract
- No new summary tool without telemetry evidence
- Provider normalization unchanged for non-YouTrack providers
- Minimal shared-provider contract extensions (only where tool surface needs it)

## Verification

- Comment pagination: `bun test tests/tools/comment-tools.test.ts tests/providers/youtrack/operations/comments.test.ts`
- Work-item pagination: `bun test tests/tools/work-item-tools.test.ts tests/providers/youtrack/operations/work-items.test.ts`
- Search pagination: `bun test tests/tools/search-tasks.test.ts tests/providers/youtrack/operations/tasks.test.ts`
- Project pagination: `bun test tests/providers/youtrack/operations/projects.test.ts`
- Full suite: `bun test tests/tools/get-task.test.ts tests/tools/tools-builder.test.ts tests/providers/youtrack/tools-integration.test.ts`

## Related Decisions

- ADR-0052: YouTrack Full API Implementation (base provider layer)
- ADR-0058: Provider Capability Architecture (capability gating model)
- ADR-0068: YouTrack Gap Closure (phase-five tools, custom fields, command tool)
- ADR-0067: YouTrack Bulk Command Safety Boundary (constrained `apply_youtrack_command`)

## References

- Plan: `docs/superpowers/plans/2026-04-16-youtrack-remaining-parity-gaps.md`
- Parity Checklist: `docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md`
- YouTrack REST API: https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html
