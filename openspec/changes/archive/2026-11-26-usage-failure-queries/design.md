<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

Usage events are already persisted with failure detail: `llm_usage_events.error`
(non-null exactly when a turn errored, written by `buildUsageFromLlmError` in
`src/usage/index.ts`) and `tool_call_events.success` / `error_type` /
`error_code` / `retryable` / `recovered`. Existing query helpers over these
tables (`listSubjects` in `src/usage/query.ts`, `listRecentRequests` in
`src/usage/recent-requests.ts`) are token/request-oriented and never surface
failures. See `proposal.md` for motivation; see `specs/usage-failure-queries/spec.md`
for the behavior contract.

Established query-module conventions this design follows:

- Query helpers are standalone modules imported directly where needed
  (as `src/debug/admin-system.ts` imports them); `src/usage/index.ts` is the
  recorder subscriber, not a barrel, and stays untouched.
- Time-window semantics mirror `computeSince` in `src/usage/query.ts`:
  positive `windowMs` → `occurred_at >= Date.now() - windowMs`;
  `null`/omitted → all time.
- Limit semantics mirror `recent-requests.ts`:
  `Math.max(0, Math.min(200, Math.floor(limit)))`, default 25, `0` → `[]`.
- DB access goes through Drizzle (`getDrizzleDb()`, `src/db/schema.js`).

## Goals / Non-Goals

**Goals:**

- One read-only helper, `listRecentFailures(options)` in a new
  `src/usage/failures.ts`, returning a merged newest-first failure list as a
  discriminated union (`kind: 'llm' | 'tool'`).
- Reuse the existing window/limit conventions exactly, so operators get
  predictable semantics across usage queries.

**Non-Goals:**

- No debug/settings-server or dashboard wiring (follow-up change).
- No aggregations, analytics backfill, schema or index changes.
- No changes to usage recording.

## Decisions

### D1: New standalone module vs extending an existing one

New `src/usage/failures.ts`. No existing module covers failure listing —
`query.ts` lists subjects, `recent-requests.ts` lists per-request token usage;
both would need their row shapes bent to host a two-source union. A separate
module keeps each query's row type honest and matches the existing
one-module-per-query pattern. `src/usage/index.ts` is not touched (it is the
recorder subscriber; importing query modules from it would couple recording to
querying for no benefit).

### D2: Two selects + in-memory merge vs a single UNION query

Two Drizzle selects (one per table, each filtered to its failure predicate and
each limited to the clamped row cap), then map to the union row shapes and merge
+ sort in memory by `occurred_at` descending, then apply the clamped limit.

Why not SQL `UNION`: the tables have different columns, so a UNION needs a
padded shared column list and per-branch discriminators, all to produce a shape
Drizzle maps less cleanly than two typed selects. Correctness of the merge is
also easier to see: because the final top-N (N ≤ 200) newest overall must be a
subset of the top-N of each source, fetching N per source is provably sufficient
— the in-memory sort is over at most 2 × 200 rows.

The limit is applied after merging/ordering (not pushed into one source's
query) so the newest failures win regardless of source, per the spec.

### D3: Row shape as a TypeScript discriminated union

`kind: 'llm' | 'tool'` plus shared fields (`ts`, `turnId`, `storageContextId`,
`contextType`, `chatUserId`, `model`, `modelRole`, `durationMs`); `llm` adds
`error: string`, `finishReason: string | null`; `tool` adds `toolName`,
`errorType` / `errorCode: string | null`, `retryable` / `recovered:
boolean | null`. Nullable source columns are normalized to `null` (never
`undefined`) so consumers can rely on `== null` checks and stable JSON shape.
No Zod schema is introduced: the helper is internal and typed at the boundary
by its return type, matching `recent-requests.ts`.

### D4: No capability/tool-prefs impact

`listRecentFailures` is a plain function for internal operator tooling, not a
chat tool surface: it is not registered with the tool registry, so capability
gating and `tool_prefs` (allow/ask/deny) do not apply. When a later change wires
it into a surface, that change must spec the gating.

### D5: Scope-model impact — none

The helper introduces no persisted state. It reads rows already keyed by their
existing ids (storage context id, chat user id, turn id) and returns them
verbatim; it does not resolve or re-scope them.

### D6: No DB changes

Tables and supporting indexes already exist; no Drizzle migration, no
backfill. Rollout is adding one file.

## Risks / Trade-offs

- [Per-source SQL limit relies on the top-N-subset argument] → Covered by a
  test that interleaves the two sources and asserts the merged top-N is exact;
  the argument is noted in a comment-free but test-enforced form (N ≤ 200
  bounds memory).
- [Timestamp tie between sources makes "newest-first" non-deterministic for
  equal `occurred_at`] → Sort is stable and sources are concatenated in a fixed
  order, so output is deterministic; ties are acceptable for a post-mortem list.
- [`Date.now()` at query time makes window edges slightly skippable in tests]
  → Tests insert rows well inside/outside the window (minutes, not
  milliseconds), the same approach `recent-requests` tests use.

## Migration Plan

None. Purely additive module with no schema, config, or runtime wiring
changes; rollback is deleting `src/usage/failures.ts` and its test.

## TDD / hook interactions

Both new files (`src/usage/failures.ts`, `tests/usage/failures.ts`) fall under
the Write/Edit TDD hook pipeline. Order of work: write
`tests/usage/failures.test.ts` first (failing: module does not exist), using
`setupTestDb()` + direct Drizzle inserts per `tests/usage/recent-requests.test.ts`,
then implement `src/usage/failures.ts` until green. Coverage cases are listed
in `proposal.md` → Verification.
