<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0001: YouTrack Zod Schema Library

## Status

Accepted

## Date

2025-03-18

## Context

The YouTrack provider was initially implemented with plain TypeScript interfaces in `src/providers/youtrack/types.ts` for API response shapes, without any runtime validation. This mirrored neither the Kaneo provider (which had structured Zod schemas) nor good defensive API-integration practice. When the YouTrack REST API returns unexpected shapes — missing fields, wrong types, future API changes — silent failures or downstream `undefined` dereferences would be the only signal. The lack of a `schemas/` directory also made it impossible to write schema-level unit tests that confirm how individual response shapes are handled.

## Decision Drivers

- Parity with the Kaneo provider, which organized API types as structured Zod schemas in `src/providers/kaneo/schemas/`.
- Need for runtime validation of YouTrack API responses rather than trusting TypeScript generics on `fetch` results.
- Testability: individual entity schemas can be unit-tested in isolation.
- YouTrack's polymorphic `$type` discriminator pattern and complex custom field hierarchy benefit from explicit Zod discriminated unions.

## Considered Options

### Option 1: Plain TypeScript interfaces only (status quo)

- **Pros**: Zero runtime overhead; minimal code.
- **Cons**: No runtime validation; API contract violations are silent; no parity with Kaneo provider structure; no schema-level unit tests possible.

### Option 2: Create `schemas/` directory with granular Zod schemas per entity

- **Pros**: Runtime validation catches API contract violations early; Zod inferred types replace interfaces; schema-level tests are straightforward; mirrors Kaneo provider structure; `$type` discriminators can be modelled precisely with `z.literal`.
- **Cons**: More code; initial effort to write schemas; potential for schema drift from actual API.

### Option 3: Single consolidated schema file

- **Pros**: Less file sprawl.
- **Cons**: Harder to maintain; no entity-level test isolation; does not match the established Kaneo pattern.

## Decision

Create `src/providers/youtrack/schemas/` with one file per entity type, mirroring the Kaneo provider layout:

- `common.ts` — `BaseEntitySchema`, `TimestampSchema`
- `user.ts` — `UserSchema`, `UserReferenceSchema`
- `issue.ts` — `IssueSchema`, `IssueListSchema`
- `custom-fields.ts` — `CustomFieldValueSchema` (discriminated union by `$type`)
- `issue-link.ts` — `IssueLinkSchema`
- `project.ts` — `ProjectSchema`
- `tag.ts` — `TagSchema`
- `comment.ts` — `CommentSchema`

Each file exports Zod schemas and their inferred TypeScript types. Tests mirror the structure under `tests/providers/youtrack/schemas/`.

## Rationale

Granular entity files follow the established Kaneo pattern, enable targeted schema-level unit tests, and make future additions or modifications obvious. The discriminated union in `custom-fields.ts` explicitly handles all known `$type` variants while a fallback `UnknownIssueCustomFieldSchema` handles future field types gracefully.

## Consequences

### Positive

- API responses are validated at parse time; schema violations surface immediately rather than propagating as `undefined`.
- TypeScript types are derived from schemas, eliminating the need to keep interfaces and schemas in sync.
- Mirrors Kaneo provider structure, providing a consistent pattern across providers.
- Individual schema files are independently testable.

### Negative

- Schema definitions must be kept in sync with the `ISSUE_FIELDS` / `COMMENT_FIELDS` etc. query parameters; a mismatch between requested fields and the schema causes runtime parse errors.
- More initial implementation effort than plain interfaces.

## Implementation Status

**Status**: Implemented (with divergence from original plan)

Evidence from the codebase:

- `src/providers/youtrack/schemas/` exists with all planned entity files: `common.ts`, `user.ts`, `issue.ts`, `custom-fields.ts`, `issue-link.ts`, `project.ts`, `tag.ts`, `comment.ts`.
- `src/providers/youtrack/types.ts` has been deleted (no longer present).
- Schema tests exist under `tests/providers/youtrack/schemas/` covering `common`, `user`, `issue`, `issue-link`, `project`, `tag`, `comment`.
- `custom-fields.ts` implements a full discriminated union with `SingleEnumIssueCustomField`, `MultiEnumIssueCustomField`, `SingleUserIssueCustomField`, `MultiUserIssueCustomField`, `TextIssueCustomField`, `SimpleIssueCustomField`, and an `UnknownIssueCustomFieldSchema` fallback.

**Divergence**: The original plan included `IssueStateEnum`, `IssuePriorityEnum`, and `LinkTypeEnum` exports from `common.ts`. These were not added — `common.ts` contains only `BaseEntitySchema` and `TimestampSchema`. State and priority values are modelled implicitly through `CustomFieldValueSchema` rather than as explicit enums, reflecting YouTrack's dynamic custom field configuration per-project.

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2025-03-18-youtrack-schemas.md`
