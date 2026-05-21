<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0002: YouTrack Runtime Validation via Zod Parse and types.ts Removal

## Status

Accepted

## Date

2026-03-18

## Context

After ADR-0001 established the YouTrack schema library, a gap remained: the operation files (`operations/tasks.ts`, `operations/comments.ts`, `operations/projects.ts`, `labels.ts`, `relations.ts`) still used TypeScript generic type-casting on `youtrackFetch` calls (`youtrackFetch<YtIssue>(...)`) rather than calling `.parse()` on the result. Runtime validation was therefore not actually happening — the schemas existed as unit-tested artifacts but were not wired into the production request/response path.

Additionally, a `types.ts` file containing plain TypeScript interfaces (`YtIssue`, `YtComment`, `YtProject`, `YtTag`) remained the source of truth for types consumed by `mappers.ts` and operations. This created two sources of truth for the same shapes, with `knip.jsonc` carrying an `ignoreFiles` entry to suppress unused-export warnings on the schema directory.

A related structural issue existed in `ISSUE_FIELDS`: the custom fields query requested the deeply-nested shape `customFields($type,id,projectCustomField($type,id,field($type,id,name)),value($type,name,login,isResolved))`, but `custom-fields.ts` expected the simpler name-based shape `customFields($type,name,value(...))`. This mismatch meant the schemas were misaligned with the actual API query, making `.parse()` calls unreliable before the fix.

## Decision Drivers

- Operations were calling `youtrackFetch<T>(...)` with TypeScript generics, bypassing Zod validation entirely.
- `types.ts` duplicated the domain shapes that schemas already provided.
- `knip.jsonc` had an `ignoreFiles` block suppressing unused-export warnings for the entire `schemas/` directory, signalling the schemas were not used in production code.
- `ISSUE_FIELDS` custom field query shape did not match the `CustomFieldValueSchema` expectation; `mappers.ts` was reading `f.projectCustomField?.field?.name` rather than `f.name`.
- Removing `types.ts` and wiring `.parse()` calls directly into operations would make the schema library the single source of truth.

## Considered Options

### Option 1: Introduce a separate `yt-types.ts` production schema file

- **Pros**: Clean separation between production-oriented loose schemas and the detailed test-level schemas; production schemas can be more permissive (e.g. `z.string()` fallback for all `$type` values).
- **Cons**: Further splits the type landscape — three sources of truth (`types.ts`, detailed schemas, `yt-types.ts`); more files to maintain; potential for schemas to diverge.

### Option 2: Wire `.parse()` directly to existing schemas and delete `types.ts`

- **Pros**: Single source of truth; eliminates `types.ts`; schemas serve both runtime validation and TypeScript types; no additional files; removes the `ignoreFiles` knip suppression.
- **Cons**: The existing detailed schemas (e.g. `IssueSchema` in `issue.ts`) must be permissive enough to parse real YouTrack API responses without throwing; requires aligning `ISSUE_FIELDS` with schema expectations.

## Decision

Wire Zod `.parse()` calls from the existing schemas directly into every operation, update `ISSUE_FIELDS` to the simpler name-based custom field query, update `mappers.ts` to read `f.name` directly, and delete `types.ts`. The `ignoreFiles` entry in `knip.jsonc` is also removed.

Specifically:

- `operations/tasks.ts` uses `IssueSchema.parse(raw)` and `IssueSchema.array().parse(raw)`.
- `operations/comments.ts` uses `CommentSchema.parse(raw)` and `CommentSchema.array().parse(raw)`.
- `operations/projects.ts` uses `ProjectSchema.parse(raw)` and `ProjectSchema.array().parse(raw)`.
- `labels.ts` uses `TagSchema.array().parse(raw)`, `TagSchema.parse(raw)`, and a local `IssueTagsSchema` for tag-membership reads.
- `relations.ts` uses a local `IssueLinksSchema` for relation-removal lookups.
- `ISSUE_FIELDS` custom field segment simplified to `customFields($type,name,value($type,name,login))`.
- `mappers.ts` reads `f.name === fieldName` directly.

Note: The original plan proposed a dedicated `schemas/yt-types.ts` file as an intermediate step. The final implementation bypassed this intermediate file entirely by using the existing detailed schemas directly in operations, achieving the same outcome more directly.

## Rationale

Using the existing schemas directly avoids introducing another layer while achieving full runtime validation. The key insight is that the existing schemas are already adequate for production use provided the `ISSUE_FIELDS` query is aligned with the schema shapes. Deleting `types.ts` removes the redundancy and the knip suppression, confirming to static analysis that every schema export is genuinely used in production code.

## Consequences

### Positive

- All YouTrack API responses are validated at runtime via `.parse()`; unexpected shapes from the API raise a `ZodError` immediately rather than propagating as corrupted domain objects.
- TypeScript types throughout the YouTrack provider are derived from Zod schemas; `types.ts` no longer exists as a separate interface file.
- The `ignoreFiles` suppression in `knip.jsonc` for the schemas directory is removed, meaning knip now enforces that all schema exports are used.
- `ISSUE_FIELDS` and `CustomFieldValueSchema` are aligned: the API query returns `f.name` directly and the schema expects the same.
- `mappers.ts` is simplified: `getCustomFieldValue` reads `f.name` rather than the deeply-nested `f.projectCustomField?.field?.name`.

### Negative

- `.parse()` introduces a small runtime cost on every API response; for large `issues` list responses, this may be measurable.
- Zod parse failures on malformed API responses will throw and propagate up as errors; callers must handle `ZodError` in addition to HTTP errors. In practice this is handled by `classifyYouTrackError` in each operation's `catch` block.
- Local ad-hoc schemas (`IssueTagsSchema` in `labels.ts`, `IssueLinksSchema` in `relations.ts`) are defined inline rather than in the shared `schemas/` directory, which is a minor inconsistency.

## Implementation Status

**Status**: Implemented (via direct schema reuse rather than the `yt-types.ts` intermediate)

Evidence from the codebase:

- `src/providers/youtrack/types.ts` does not exist (deleted).
- `src/providers/youtrack/schemas/yt-types.ts` does not exist (the intermediate file from the plan was never created; the existing schemas were used directly).
- `src/providers/youtrack/operations/tasks.ts`: imports `IssueSchema`, `IssueListSchema` from `../schemas/issue.js`; calls `IssueSchema.parse(raw)` on every task fetch.
- `src/providers/youtrack/operations/comments.ts`: imports `CommentSchema` from `../schemas/comment.js`; calls `CommentSchema.parse(raw)`.
- `src/providers/youtrack/operations/projects.ts`: imports `ProjectSchema` from `../schemas/project.js`; calls `ProjectSchema.parse(raw)`.
- `src/providers/youtrack/labels.ts`: imports `TagSchema`; defines a local `IssueTagsSchema`; calls `.parse(raw)` on all responses.
- `src/providers/youtrack/relations.ts`: defines a local `IssueLinksSchema`; calls `.parse(raw)` on relation lookups.
- `src/providers/youtrack/constants.ts`: `ISSUE_FIELDS` uses `customFields($type,name,value($type,name,login))` (simplified name-based shape).
- `src/providers/youtrack/mappers.ts`: `getCustomFieldValue` finds custom fields via `f.name === fieldName` directly; imports types from schema files, not `types.ts`.
- `knip.jsonc`: no `ignoreFiles` entry for `src/providers/youtrack/schemas/`.

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-18-youtrack-replace-types-with-schemas.md`
- ADR-0001: YouTrack Zod Schema Library (established the schemas that this ADR wires into production)
