# Kaneo Latest API Migration Design

## Goal

Align papai's Kaneo provider with the latest published Kaneo API reference as the source of truth, replacing older runtime-driven contracts and compatibility behaviors where they conflict with the documented API.

## Scope

This migration covers the Kaneo provider implementation under `src/providers/kaneo/`, the Kaneo-exposed tool surface, and the Kaneo provider tests and E2E coverage that currently encode older contracts.

Included domains:

- task schemas and task list/update handling
- search contract migration
- label lifecycle and capability alignment
- comment endpoint migration to the latest published `/comment` API
- task relation migration from frontmatter to first-class Kaneo relation endpoints
- Kaneo-specific provider, tool, and E2E tests affected by the contract changes

Excluded from this design:

- multi-version Kaneo support
- preserving older undocumented Kaneo contracts as first-class behavior
- unrelated refactors outside the Kaneo provider path

## Decision

The published Kaneo API reference is authoritative.

When the current live Kaneo runtime disagrees with the docs, papai should migrate to the documented contract. Temporary compatibility behavior is acceptable only when needed to keep the codebase operable during the migration itself, and those shims must not remain as the primary provider path after the migration is complete.

When Kaneo's published docs disagree internally, papai should follow the current `https://kaneo.app/docs/api-reference/*` pages linked from `https://kaneo.app/docs/llms.txt` and their embedded OpenAPI definitions over older legacy docs content and older generated excerpts.

## Approaches Considered

### 1. Subsystem-by-subsystem doc-first migration (chosen)

Update each Kaneo domain independently while preserving the current external `TaskProvider` contract for the rest of papai.

Pros:

- smallest correct migration path
- easier to review and verify incrementally
- fits the existing Kaneo resource/operation file layout

Cons:

- temporary duplication during transition
- requires careful ordering to avoid mixed-contract states

### 2. Big-bang Kaneo adapter rewrite

Rewrite the Kaneo provider around the latest docs in one pass.

Pros:

- cleanest final structure

Cons:

- highest regression risk
- hard to isolate failures during review and testing

### 3. Dual-path versioned adapter

Introduce separate legacy and latest Kaneo adapters and switch later.

Pros:

- strongest isolation

Cons:

- too much extra code for a migration that does not need long-term dual support

## Architecture

Keep a single Kaneo provider implementation, but make each domain doc-authoritative and locally bounded.

The migration is organized into five domains.

### 1. Task Core

Files:

- `src/providers/kaneo/task-resource.ts`
- `src/providers/kaneo/task-update-helpers.ts`
- `src/providers/kaneo/schemas/create-task.ts`
- `src/providers/kaneo/schemas/get-task.ts`
- `src/providers/kaneo/schemas/api-compat.ts`

Responsibilities:

- align `GET /task/{id}` and `PUT /task/{id}` schemas with documented fields, including `startDate`
- align task-list parsing with the published `GET /task/tasks/{projectId}` contract
- preserve papai's normalized `Task` and `TaskListItem` outputs

Design rule:

Task schema completeness belongs in the schema and mapping layer, not in permissive `unknown` fields unless the docs truly leave the type open.

### 2. Comments

Files:

- `src/providers/kaneo/comment-resource.ts`
- `src/providers/kaneo/schemas/create-comment.ts`
- `src/providers/kaneo/schemas/update-comment.ts`
- `src/providers/kaneo/schemas/api-compat.ts`

Secondary cleanup files only if activity history remains separately supported:

- `src/providers/kaneo/schemas/get-activities.ts`

Responsibilities:

- migrate comment CRUD to the published `/comment/{taskId}` and `/comment/{id}` endpoints
- treat returned comment objects from the `/comment` API as authoritative on success
- stop using activity-list re-fetch fallback behavior as the mainline comment path
- keep `activity` schemas and endpoints out of the primary comment CRUD path; they remain separate timeline/history behavior only if still needed elsewhere

Design rule:

The provider should follow the latest published `/comment` contract directly instead of synthesizing comment CRUD from `activity` responses.

### 3. Labels

Files:

- `src/providers/kaneo/label-resource.ts`
- `src/providers/kaneo/constants.ts`
- `src/providers/kaneo/index.ts`
- label-related tool exposure paths under `src/tools/`

Responsibilities:

- align label create/get/update/delete/attach/detach with the published API reference
- make Kaneo capabilities match the documented label feature surface
- update label E2E and cleanup logic to reflect the documented semantics

Design rule:

Provider capability exposure must reflect the documented API contract, not an older workaround-driven suppression.

### 4. Relations

Files:

- `src/providers/kaneo/task-relations.ts`
- `src/providers/kaneo/frontmatter.ts`
- relation-related provider tests and E2E tests

Responsibilities:

- remove description-frontmatter persistence for Kaneo relations
- migrate to the documented `/task-relation` create/get/delete endpoints
- treat documented Kaneo `relationType` values (`blocks`, `related`, `subtask`) as the native Kaneo contract
- implement papai's `updateRelation` over documented primitives by resolving the existing relation via `GET /task-relation/{taskId}`, deleting it by relation ID, and recreating it with the new type
- stop treating frontmatter as the source of truth for Kaneo relation state

Compatibility rule:

- `blocks` and `related` remain first-class Kaneo relations
- `parent` and `child` may only remain supported if they can be expressed through the documented directional `subtask` relation without undocumented storage
- undocumented Kaneo-native relation types such as `duplicate`, `duplicate_of`, and `blocked_by` must not remain primary persisted Kaneo behavior

Design rule:

For Kaneo, task descriptions should no longer be the persistence layer for relations.

### 5. Search

Files:

- `src/providers/kaneo/search-tasks.ts`
- `src/providers/kaneo/task-resource.ts`
- `src/providers/kaneo/schemas/global-search.ts`
- `src/providers/kaneo/schemas/api-compat.ts`

Responsibilities:

- replace the flat compat response contract with the published grouped search response
- flatten grouped Kaneo search results into papai's shared `TaskSearchResult[]` output in the mapping layer

Design rule:

Flattening belongs in papai's provider adaptation layer, not in Kaneo response schemas that pretend the API is already flat.

## Data Flow

Each migrated Kaneo domain should follow the same pattern:

1. resource method calls the documented Kaneo endpoint
2. Zod schema validates the documented request and response shape
3. resource maps Kaneo payloads into papai-normalized domain values
4. provider operations and tools consume only normalized outputs

### Tasks

`task-resource.ts` and `task-update-helpers.ts` own full-task payload construction, including documented optional fields such as `startDate`.

### Comments

`comment-resource.ts` should use the published `/comment` endpoints directly and consume returned comment objects without an `activity`-based recovery path in the final implementation.

### Labels

`label-resource.ts` should use direct documented label lifecycle and label-task association endpoints.

### Relations

`task-relations.ts` should adapt first-class Kaneo relation resources and identifiers rather than synthesizing relation state from description text. Because the latest published docs expose create/get/delete relation endpoints but no standalone relation-update endpoint, relation updates should be modeled over those documented primitives instead of assuming an undocumented `PUT /task-relation` route.

### Search

Grouped Kaneo search results should be transformed into papai's flat shared provider search contract after schema validation.

## Error Handling And Compatibility Policy

Because the API reference is authoritative, the default rule is:

- docs win over current runtime drift
- temporary compat behavior is allowed only as a migration aid and must not remain the final primary behavior
- compat behavior must not silently redefine the provider capability surface unless papai intentionally marks an operation unsupported

### Search

The current flat search compat path should be removed from the final migrated implementation. If retained briefly during the transition, it must be clearly fenced as temporary migration-only behavior.

### Relations

The frontmatter implementation should be removed rather than kept as a silent fallback.

Relation updates must not depend on an undocumented update endpoint. If papai preserves `updateRelation`, it should do so by combining documented relation lookup, delete, and create operations.

### Labels

The Kaneo provider capability set should match the documented API. Runtime failures should surface as provider errors, not as hidden tool suppression unless papai explicitly decides the operation is unusable.

### Comments

The migrated primary path must use the published `/comment` endpoints and their returned comment objects directly. Any temporary bridge from the older `activity`-based implementation should be removed before migration completion unless separately approved.

### Classification

`classify-error.ts` must classify by endpoint/resource semantics robustly enough that nested endpoints such as `/label/{id}/task` do not get misclassified by substring ordering.

## Testing Strategy

### 1. Schema-First Unit Coverage

Add or update provider/schema tests for:

- grouped search response
- task relation create/get/delete endpoints and documented native relation enum
- task payloads including `startDate`
- label delete semantics from the published API
- comment create/list/update/delete using returned `/comment` objects

### 2. Resource And Operation Tests

Each Kaneo resource file should prove:

- correct endpoint path
- correct request body/query construction
- correct response normalization
- correct 400/404/auth classification

### 3. Tool And Provider Integration Tests

Validate that provider capabilities and tool exposure remain aligned after migration, especially for:

- `remove_label`
- relation tools
- search tool output

### 4. E2E Migration Gates

Update E2E suites to reflect doc-first Kaneo behavior for:

- labels
- comments via `/comment` endpoints
- relations
- tasks and search

## Rollout Order

Recommended order:

1. task schemas and update/list parsing
2. search contract migration
3. comment endpoint migration
4. relation migration
5. label capability and deletion semantics
6. full Kaneo provider and E2E verification

This order reduces coupling by migrating foundational task and search contracts first, then moving comment CRUD onto the newer published endpoint surface before relation and label behavior changes.

## File Impact Summary

Likely core files to modify:

- `src/providers/kaneo/task-resource.ts`
- `src/providers/kaneo/task-update-helpers.ts`
- `src/providers/kaneo/search-tasks.ts`
- `src/providers/kaneo/task-relations.ts`
- `src/providers/kaneo/label-resource.ts`
- `src/providers/kaneo/comment-resource.ts`
- `src/providers/kaneo/kaneo-client.ts`
- `src/providers/kaneo/classify-error.ts`
- `src/providers/kaneo/constants.ts`
- `src/providers/kaneo/index.ts`
- `src/providers/kaneo/schemas/create-task.ts`
- `src/providers/kaneo/schemas/get-task.ts`
- `src/providers/kaneo/schemas/create-comment.ts`
- `src/providers/kaneo/schemas/update-comment.ts`
- `src/providers/kaneo/schemas/global-search.ts`
- `src/providers/kaneo/schemas/api-compat.ts`

Likely tests to modify:

- `tests/providers/kaneo/task-resource.test.ts`
- `tests/providers/kaneo/comment-resource.test.ts`
- `tests/providers/kaneo/label-resource.test.ts`
- `tests/providers/kaneo/task-relations.test.ts`
- `tests/providers/kaneo/schema-validation.test.ts`
- `tests/providers/kaneo/index.test.ts`
- `tests/tools/label-tools.test.ts`
- `tests/tools/task-label-tools.test.ts`
- `tests/tools/task-relation-tools.test.ts`
- `tests/e2e/task-relations.test.ts`
- `tests/e2e/label-operations.test.ts`
- `tests/e2e/task-comments.test.ts`
- any Kaneo-related tool tests affected by capability or output changes

## Non-Goals

- preserving description-frontmatter relations for Kaneo
- keeping legacy flat Kaneo search as the primary implementation
- keeping `activity`-based comment CRUD as the primary implementation
- introducing a second long-lived Kaneo adapter generation
- unrelated provider refactors outside the migration scope
