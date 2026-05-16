# ADR-0086: Kaneo Compatibility Gap — Tier 1 E2E Coverage Extension

## Status

Implemented

## Date

2026-05-15

## Context

After the latest Kaneo API migration (ADR follow-up), papai's Kaneo provider exposed new capabilities: `startDate` task fields, grouped search responses, dedicated `/comment` resources, first-class `/task-relation` endpoints, and label attachment-aware deletion. The provider code was migrated, but the E2E suite was still proving only the _old_ contract surface. Several high-risk boundaries had no live verification:

1. **Date field round-tripping**: The provider now sends `startDate` and `dueDate` to Kaneo, but no E2E test proved these values survive the create → read → update → read cycle.
2. **Task list envelope drift**: Kaneo docs and runtime had diverged on list payload shape before (`{ data, pagination }` vs grouped columns + `plannedTasks`). The provider adapted, but there was no E2E contract oracle.
3. **Search envelope adaptation**: The provider now normalizes both flat and grouped search envelopes. No E2E test asserted the raw live envelope shape.
4. **Comment endpoint migration**: Comments moved from activity-based paths to dedicated `/comment/*` endpoints. E2E only checked wrapper-level CRUD, not the raw endpoint semantics.
5. **Relation directionality**: Kaneo stores `blocks`/`subtask` natively; papai surfaces `blocks`/`blocked_by` and `parent`/`child`. E2E only proved one side of the mapping.
6. **Label runtime semantics**: Kaneo's live runtime rejects deletion of unattached labels even though docs show a delete endpoint. E2E only checked task re-fetch, not the dedicated label-task association.

Without Tier 1 E2E oracles at these boundaries, future Kaneo runtime changes or provider wrapper regressions could go undetected.

## Decision Drivers

- **Must prove live API boundary** for migrated provider contracts that changed during the doc-first migration
- **Must keep existing E2E stable** — new tests must not weaken cleanup isolation or break current passing suites
- **Must use shared harness** — reuse Docker-backed Kaneo environment, preload setup, and `KaneoTestClient`
- **Should add system oracles** — raw authenticated API calls alongside wrapper assertions where envelope shape matters
- **Should preserve accepted runtime behaviors** — e.g. Kaneo's unattached-label delete rejection must remain documented

## Considered Options

### Option 1: Expand existing test files ad-hoc

Add assertions into `task-lifecycle.test.ts`, `task-search.test.ts`, etc. without a structured oracle helper.

- **Pros**: Minimal new files
- **Cons**: Each file invents its own raw-fetch pattern; inconsistent error handling; duplicated auth/session logic

### Option 2: Add structured raw API helper, new focused test file, and expanded domain suites (implemented)

Create a shared `kaneo-api-helpers.ts` for authenticated raw API probes, add a new `task-list-compatibility.test.ts` for list contract coverage, and expand existing domain suites with compatibility scenarios.

- **Pros**: Centralized auth/session logic; consistent Zod-guarded raw payloads; focused domain files stay readable; scenario matrix maps 1:1 to implementation
- **Cons**: One more file in the E2E tree; requires discipline to keep raw oracles narrow

### Option 3: Mock the Kaneo API at the E2E level

Replace Docker-backed tests with a controlled Kaneo mock server that returns documented shapes.

- **Pros**: Faster, deterministic
- **Cons**: Defeats the purpose — these gaps exist precisely because docs and runtime diverge; a mock would validate docs, not runtime

## Decision

We will adopt **Option 2**.

Create:

1. `tests/e2e/kaneo-api-helpers.ts` — Shared authenticated raw Kaneo API helper with `kaneoApiFetch`, `kaneoApiJson`, `kaneoApiJsonParsed`, and `getCurrentKaneoUserId`
2. `tests/e2e/task-list-compatibility.test.ts` — Focused coverage for list payload shape (`plannedTasks`, columns, null `dueDate`), and live query filters (status, assignee, page/limit, sort, dueBefore/dueAfter)
3. Expand `task-lifecycle.test.ts` — `startDate`/`dueDate` round-trip, preservation on partial update, explicit override, null-date baseline
4. Expand `task-search.test.ts` — Live envelope shape assertion, `projectId` + `limit` boundary, assignee local-filter correctness
5. Expand `task-comments.test.ts` — Comment ID stability through update/delete, raw `/comment` endpoint PUT/DELETE contract probes
6. Expand `task-relations.test.ts` — Reverse-direction `blocks`→`blocked_by`, `parent`/`child` via `subtask`, duplicate-free update via raw relation audit
7. Expand `label-operations.test.ts` — Task-label endpoint visibility (`/label/task/{taskId}`), deletion gated by attachment state
8. Wire `task-list-compatibility.test.ts` into `e2e.test.ts`

## Rationale

- **Raw oracles are justified here because the boundary is doc-vs-runtime**, not wrapper-vs-mock. Only a live Kaneo instance can confirm that the current runtime envelope still matches what the provider assumes.
- **Shared helper keeps oracles narrow**: `kaneo-api-helpers.ts` is ~100 lines and purpose-built for E2E assertions. It does not become a second client layer.
- **Domain files stay focused**: Rather than one giant compatibility file, each domain suite owns its own scenarios, keeping failure attribution clear.
- **Cleanup isolation preserved**: Every test still uses `beforeEach` + `KaneoTestClient.cleanup()`. No suite-level Docker changes were made.
- **Accepted runtime behavior preserved**: The unattached-label delete rejection is documented as expected behavior, not treated as a bug.

## Consequences

### Positive

- All 14 scenario rows from the plan have corresponding passing E2E tests with both wrapper and raw API oracles
- Future Kaneo runtime envelope changes will be caught by dual-oracle assertions (wrapper + raw)
- `startDate`, `dueDate`, and assignee round-trips are now proven through live create/update/get cycles
- Relation directional mapping (`blocks`/`blocked_by`, `parent`/`child`) is proven on both tasks after a single relation create
- Label attach/detach/delete state transitions are visible through the dedicated endpoint, not inferred from task re-fetch only
- Comment ID stability and dedicated `/comment` contract are validated via both wrapper flows and raw endpoint probes

### Negative

- E2E suite runtime increased modestly (~+8 scenarios with raw API calls)
- `kaneo-api-helpers.ts` adds a narrow dependency on the live Kaneo session shape; if session lookup changes, helper must be updated
- Raw oracles increase test brittleness if Kaneo makes cosmetic response changes unrelated to papai behavior

### Risks

- Raw assertions on search/list envelopes could break on minor Kaneo response changes
  - **Mitigation**: Assertions are descriptive (key presence, array shape) rather than strict full-schema matching
- `getCurrentKaneoUserId()` fallback via workspace members could misbehave if multi-user tests are added later
  - **Mitigation**: Helper is documented as seeded-single-user only; future multi-user tests should supply explicit IDs

## Implementation Notes

### Files Created

- `tests/e2e/kaneo-api-helpers.ts`
- `tests/e2e/task-list-compatibility.test.ts`

### Files Modified

- `tests/e2e/task-lifecycle.test.ts` — Added 4 date/assignee round-trip tests using raw API oracle
- `tests/e2e/task-search.test.ts` — Added envelope, project-limit, and assignee-filter tests
- `tests/e2e/task-comments.test.ts` — Added comment ID-stability and raw `/comment` PUT/DELETE probes
- `tests/e2e/task-relations.test.ts` — Added reverse-direction mapping and duplicate-free update tests
- `tests/e2e/label-operations.test.ts` — Added task-label endpoint visibility and deletion-state tests
- `tests/e2e/e2e.test.ts` — Imported `./task-list-compatibility.test.js`

### Scenario Matrix (Implemented)

| Scenario                                              | Feature Tags                         | Journey Tags             | Status |
| ----------------------------------------------------- | ------------------------------------ | ------------------------ | ------ |
| Task create/get round-trips `startDate` and `dueDate` | kaneo, tasks, datetime               | create, read             | ✅     |
| Task update preserves existing `startDate`            | kaneo, tasks, datetime               | update                   | ✅     |
| Task update overrides `startDate` explicitly          | kaneo, tasks, datetime               | update                   | ✅     |
| Task list includes column tasks and `plannedTasks`    | kaneo, tasks, list, compatibility    | list                     | ✅     |
| Task list filters and sorting map to live Kaneo       | kaneo, tasks, list, filters          | list, filter, sort       | ✅     |
| Search wrapper adapts live runtime envelope           | kaneo, search, compatibility         | search                   | ✅     |
| Search `projectId` and `limit` behavior aligned       | kaneo, search, filters               | search, filter, paginate | ✅     |
| Search assignee filtering stays correct               | kaneo, search, assignee, pagination  | search, filter           | ✅     |
| Comment update/delete on dedicated `/comment`         | kaneo, comments, compatibility       | create, update, delete   | ✅     |
| Reverse relation mapping `blocks`/`blocked_by`        | kaneo, relations, mapping            | create, read             | ✅     |
| Reverse relation mapping `parent`/`child`             | kaneo, relations, mapping, subtasks  | create, read             | ✅     |
| Relation update delete+recreate without duplicates    | kaneo, relations, update             | update, read             | ✅     |
| Label attach/detach via dedicated task-label endpoint | kaneo, labels, compatibility         | attach, detach, read     | ✅     |
| Label deletion gated by attachment state              | kaneo, labels, delete, compatibility | delete                   | ✅     |

### Verification

All 14 scenarios verified passing with the Docker-backed Kaneo harness:

```bash
IMAGE=papai:e2e bun test:e2e
```

Individual domain files also pass in isolation:

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-lifecycle.test.ts
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-list-compatibility.test.ts
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-search.test.ts
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-relations.test.ts
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/label-operations.test.ts
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-comments.test.ts
```

## Related Decisions

- ADR-0003: E2E Test Harness with Docker Compose — Shared Docker lifecycle and `KaneoTestClient` reused
- ADR-0050: E2E Planning Workflow with Realism Tiers — This work follows the Tier 1 provider-real planning workflow
- ADR-0058: Provider Capability Architecture — Label and relation capabilities exercised in E2E

## References

- Archived Spec: `docs/archive/2026-05-14-kaneo-latest-api-migration-design.md`
- Archived Plan: `docs/archive/2026-05-15-kaneo-compatibility-gap-e2e-plan.md`
- Archived Implementation Plan: `docs/archive/2026-05-15-kaneo-compatibility-gap-e2e-implementation-plan.md`
- Migration Plan (separate): `docs/superpowers/plans/2026-05-14-kaneo-latest-api-migration.md`
- E2E Planning Workflow: `docs/superpowers/e2e-planning-workflow.md`
- E2E Test Template: `docs/superpowers/templates/e2e-test-plan-template.md`
