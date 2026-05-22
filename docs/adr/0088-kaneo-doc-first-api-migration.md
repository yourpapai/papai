<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0088: Kaneo Doc-First API Migration

## Status

Accepted

## Context

Papai's Kaneo provider had grown a mixture of documented API contracts and runtime-driven compatibility behavior across five domains:

- **Task schemas** were missing the documented `startDate` field, and task-list parsing used an older runtime-safe envelope that did not match the published grouped response shape.
- **Search** was still validating a flat `{ results }` compat response, while the published API returns grouped `{ tasks, projects, workspaces, comments, activities }`.
- **Comments** were using `activity`-based re-fetch fallbacks instead of the published `/comment/{taskId}` and `/comment/{id}` endpoints.
- **Relations** were persisted in task description frontmatter because `/task-relation` endpoints were not yet known to exist.
- **Label deletion** was suppressed as a capability because the live runtime rejected it for unattached labels, masking the real documented endpoint behavior.

The provider was operating on an older contract that diverged in multiple directions from the Kaneo API reference at `https://kaneo.app/docs/api-reference/*`, which had since stabilized the endpoints now consumed by the provider.

## Decision Drivers

- **Authority of published API reference** — the docs now define `startDate`, grouped search, `/comment`, `/task-relation`, and label endpoints explicitly
- **Schema-first validation** — response bodies should match Zod schemas derived from the docs, not permissive unknowns
- **No long-term compat dual-path** — temporary runtime bridges (flat search, frontmatter relations, activity fallbacks) should not survive as primary behavior
- **Normalized provider contract stability** — papai's shared `TaskProvider` surface must remain unchanged for tools and higher layers

## Considered Options

### Option 1: Documented-api-first subsystem migration (chosen)

Migrate each of the five Kaneo domains in isolation while preserving papai's normalized provider contract.

- **Pros**: Smallest risk, reviewable per domain, clear TDD cycle, fits existing file layout
- **Cons**: Requires multi-step ordering; temporary mixed-contract state during transition

### Option 2: Big-bang rewrite

Rewrite the full Kaneo provider in one pass.

- **Pros**: Cleanest final adapter
- **Cons**: Highest regression risk, hard to isolate failures, broad test blast radius

### Option 3: Dual-path versioned adapter

Introduce a new `KaneoV2Provider` side-by-side with the old one.

- **Pros**: Strongest isolation
- **Cons**: Too much code for a migration that does not need long-term dual support

## Decision

Adopt Option 1: migrate each domain doc-first, remove compat shims, and keep one provider.

The implementation follows the plan and design document in `docs/archive/2026-05-14-kaneo-latest-api-migration-design.md`.

## Rationale

- The published API reference is now explicit on all five domains, so migration is unambiguous
- Each domain can be schema-validated, unit-tested, and provider-verified independently
- `TaskProvider` normalized outputs (`Task`, `TaskSearchResult`, `TaskRelation`, etc.) insulate tools from the underlying Kaneo contract change
- No need for a second adapter when the normalized surface is the long-lived abstraction

## Consequences

### Positive

- `startDate` round-trips correctly for task create, get, and update
- Search validates and normalizes both grouped and runtime envelopes into a single `GlobalSearchResponse`
- Comment CRUD uses dedicated `/comment` endpoints directly with authoritative comment objects
- Relations are persisted through first-class `/task-relation` resources instead of description strings
- Label capabilities expose the actual documented surface; runtime-only restrictions are surfaced as errors, not hidden capability suppression
- 223 provider and tool unit tests pass, 0 fail

### Negative

- E2E verification requires a running Kaneo Docker instance; those three suites were not run in this session
- Some wrapper parameter names (`activityId` in `updateComment`/`removeComment`) preserve legacy names for backward compatibility even though they now semantically mean comment ID
- The `labels.delete` capability remains intentionally withheld because the live Kaneo runtime still rejects unattached-label deletion; this is a documented divergence between the docs and the runtime

## Implementation Details

### Migrated domains

| Domain    | Key files                                                                                                                                                      | Endpoint change                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Task core | `task-resource.ts`, `task-update-helpers.ts`, `create-task.ts`, `update-task.ts`, `schemas/create-task.ts`, `schemas/get-task.ts`, `schemas/list-tasks.ts`     | `startDate` added; list uses `{ data, pagination }` envelope                                                        |
| Search    | `search-tasks.ts`, `task-resource.ts`, `schemas/global-search.ts`                                                                                              | Flat compat removed; grouped response normalized via `normalizeSearchResponse`                                      |
| Comments  | `comment-resource.ts`, `add-comment.ts`, `get-comments.ts`, `update-comment.ts`, `remove-comment.ts`, `schemas/create-comment.ts`, `schemas/update-comment.ts` | `POST/GET/PUT/DELETE /comment/{taskId\|id}` replaces activity fallback                                              |
| Relations | `task-relations.ts`, `add-task-relation.ts`, `update-task-relation.ts`, `remove-task-relation.ts`                                                              | `POST /task-relation`, `GET /task-relation/{taskId}`, `DELETE /task-relation/{id}`; update modeled as delete+create |
| Labels    | `label-resource.ts`, `constants.ts`, `classify-error.ts`                                                                                                       | Attached-label-only delete preserved as runtime-verified behavior; `labels.delete` capability suppressed            |

### Dual-envelope search

`task-resource.ts` includes `normalizeSearchResponse()` that bridges both the grouped envelope and the runtime flat `{ results }` envelope so the provider is resilient to either response shape while exposing only grouped search to callers.

### Relation mapping

Kaneo native types are `blocks`, `related`, `subtask`. Papai maps:

- `blocks` → `blocks` (source) / `blocked_by` (target)
- `related` → `related` (both directions)
- `subtask` → `parent` (source is child) / `child` (source is parent)

See `task-relations.ts` `mapIncomingRelation()`.

### Frontmatter removal

`src/providers/kaneo/frontmatter.ts` was removed entirely. Relation state was previously embedded in task descriptions; it is now read exclusively from `/task-relation/{taskId}`.

## Related Decisions

- [ADR-0086](0086-kaneo-compatibility-gap-e2e-coverage.md) — Kaneo E2E compatibility gap coverage that this migration leverages
- [ADR-0058](0058-provider-capability-architecture.md) — capability architecture that gates tool exposure for `labels.delete`

## References

- Design document: `docs/archive/2026-05-14-kaneo-latest-api-migration-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-14-kaneo-latest-api-migration.md` (archived alongside this ADR)
