<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Erasure Completeness (Audit Defect 5, slice 3)

Status: approved design, pre-implementation
Date: 2026-07-26
Branch: memory-vector-graph-research
Predecessors:

- `2026-07-24-memory-durable-erasure-design.md` — migration 069, `secure_delete`,
  `purgeMemoryRecord`, extended `clearMemoryScope`, tombstone gates.
- `2026-07-25-memory-prose-as-cache-design.md` — profile contamination, summary
  deletion on purge.

## Problem

The two predecessor slices shipped. `forget_memory` purges rather than archives,
`clearMemoryScope` wipes working memory and the extraction watermark, and a
bilingual golden set asserts unreachability. Reading the shipped code against
the audit's requirement — *unreachable by every retrieval channel, and not
re-materializable* — surfaces four remaining gaps.

1. **A provisional twin survives the purge.** `purgeMemoryRecord` deletes exactly
   one id. A `provisional` record carrying the same content stays in
   `memory_records`, and `promotion.ts:114` promotes it without consulting the
   tombstone. Forget, then the next promotion sweep, and the fact is active
   again. This is re-materialization from inside the app, not from a backup.

2. **The suppression gate lives at call sites, not at the write boundary.**
   `isContentTombstoned` is checked in `capture.ts:129` and `runner.ts:122,150`.
   `saveMemoryRecord` itself is ungated, so any importer, replay, migration
   backfill, or writer added later bypasses the tombstone silently. The safety
   property currently depends on two call sites remembering to check.

3. **The semantic channel is never asserted independently.**
   `durable-erasure.golden.test.ts` asserts the lexical channel alone and the
   *fused* recall cascade. A purged row surviving in the dense scan would still
   be hidden by fusion, because lexical's absence carries the result. The dense
   path is untested in isolation.

4. **`memory_facts` is a naming trap.** It reads like a derived projection of
   memory records; it is the web-fetch title/URL cache keyed by storage user id
   (`schema.ts:67`). `clearMemoryScope` wipes it, `purgeMemoryRecord` correctly
   does not. Nothing states this, so the next reader will either add a wrong
   assertion or a wrong delete.

## Goals

- A forget destroys every row in the scope carrying the forgotten content, not
  just the row whose id was named.
- Tombstone suppression is enforced where records are written, so a new write
  path inherits it rather than having to remember it.
- The golden set proves unreachability on five independent channels, each with a
  pre-purge sanity assertion, in both scripts.
- The `memory_facts` boundary is stated in code and pinned by a test.

## Non-goals

Unchanged from the predecessor spec: backups and replicas remain an operator
retention-policy responsibility; semantic paraphrase suppression stays deferred;
crash-injection and backup-restore testing belong to the Phase-0 acceptance
harness. No storage-engine change, no hierarchy work.

## Verified findings that shape the design

Established by reading the code during design, not assumed.

- `capture.ts:136` writes through `saveMemoryRecordWithEmbedding`, which wraps
  `saveMemoryRecord` (`embedding-writer.ts:61`). Gating the inner function
  propagates to the capture path.
- `runner.ts:150` guards a different path: `updateMemoryRecord` (`store.ts:232`),
  which can rewrite an existing row's content into a tombstoned value. It already
  returns `MemoryRecord | null`, so gating it is signature-free.
- `promoteProvisionalToActive` (`provisional-store.ts:41`) is an `UPDATE` of
  status. It never crosses the save boundary, so a write-boundary gate alone does
  not cover it.
- The dense scan filters by status, validity, *and* `embeddingVersion`
  (`semantic-search.ts:46-53`). A naive "id absent from results" assertion proves
  nothing, because three separate filters could each explain the absence.
- `tools/memory.ts` saves at line 98 and deletes the matching tombstone at line
  114 — save-then-clear. Any gate must not reject that explicit re-add.
- `MemoryRecordInput` already carries `scopeId`, `scopeType`, and `source`, so a
  gate inside `saveMemoryRecord` needs no new parameter.
- `deleteMemoryRecord` (`purge.ts:32`) is the dedup path: single-id, no
  tombstone, no sweep. Its existing docstring explains why, and that reasoning is
  unchanged by this slice.

## Design

### 1. Purge becomes content-scoped

`purgeMemoryRecord(scope, recordId, now)` keeps its signature and its `boolean`
return. Its first step changes from "delete the row with this id" to "read the
row with this id, then delete every row in this scope whose content hashes to
the same value." Inside the existing transaction:

1. `SELECT content` for `recordScopeCondition(scope, recordId)` — unchanged. When
   absent, return `false` and touch nothing else.
2. Compute `contentHash(row.content)` with the existing `tombstone.ts` helper.
3. Load `{ id, content }` for the whole scope across **all statuses and with no
   validity filter** — a purge must reach the expired and provisional rows the
   read paths hide — hash each, and delete every id whose hash matches. This
   sweep is what kills the provisional twin.
4. Tombstone insert, profile contamination, and summary deletion follow
   unchanged.

The sweep hashes through `normalizeForHash`, so it also catches the case- and
whitespace-variant duplicates an extractor produces from one utterance —
consistent with what the tombstone already suppresses on the write side. The
sweep is scope-local: it never crosses `(scopeId, scopeType)`, so a forget in a
DM cannot reach a group's records.

The purge log line reports `recordsDeleted` rather than an implicit 1, since one
forget can now legitimately remove several rows. It stays metadata-only: ids and
counts, never content, never the hash.

`deleteMemoryRecord` is unchanged.

Hashing happens in JS over the scope's rows rather than as an indexed join. Per-
scope record counts are in the tens to hundreds, so an indexed `content_hash`
column plus backfill is not justified yet; it remains an option if a profile
later says otherwise.

### 2. The tombstone gate moves to the write boundary

Three functions become the boundary. The two call-site filters go away.

**`saveMemoryRecord(input): MemoryRecord | null`** returns `null` when
`input.source !== 'explicit'` and `isContentTombstoned({scopeId, scopeType},
input.content)`. Scope and intent both come off the input, so the predecessor
spec's rule — explicit remember is an intentional override — becomes structural
rather than a convention two call sites happen to honor. The save-then-clear
order in `tools/memory.ts` becomes correct by construction, because explicit
saves are never gated.

**`saveMemoryRecordWithEmbedding`** propagates the `null` and returns early,
skipping the embedding provider round-trip for a record that was not written.

**`updateMemoryRecord`** returns `null` when `patch.content` is defined and
tombstoned. Content rewrites originate only from the extractor, so no `source`
discrimination is needed here.

Callers absorb a `null` branch in place of a pre-filter. `runner.ts` counts
`null` returns as `suppressed`, keeping its existing counters and log line — the
reduce moves its test after the call. `capture.ts` drops its `filter` and derives
`suppressed` from the returned array. Net line count falls.

**Why promotion needs no gate of its own.** With §1 shipped, no tombstoned
provisional can exist to promote: one created before the forget is swept away by
the purge, one created after is refused at insert as `source: 'background'`. The
two changes close the hole jointly — either alone leaves it open. This is the
reason `promotion.ts` and `provisional-store.ts` are untouched, and the reason
the two changes ship together.

### 3. The `memory_facts` boundary

`memory_facts` is the web-fetch title/URL cache keyed by storage user id, not a
projection of memory records. `clearMemoryScope` deletes it because clearing a
scope removes everything keyed to that scope; `purgeMemoryRecord` leaves it
because no row in it derives from the purged record. A comment on the
`memory_facts` handling in `scope-clear.ts` states this, and tests pin both
halves (§4).

## Testing

Bilingual (EN + RU) throughout — the golden set already loops over both language
rows, so the new assertions inherit it. Every test is shown red before green.

**Headline acceptance test** (`durable-erasure.golden.test.ts`): seed, purge, then
assert unreachability on five independent channels, each preceded by a pre-purge
sanity assertion so absence proves deletion rather than filtering.

1. **Lexical** — `searchLexical` with `statuses: ALL_STATUSES`. Exists.
2. **Semantic** — `rankRecordsBySimilarity` called directly with
   `statuses: ALL_STATUSES`, the record's own `embeddingVersion`, and
   `threshold: 0`, disarming every filter that could mask a surviving row so
   only physical absence explains the miss. New.
3. **`listMemoryRecords`** across every status. Exists.
4. **Profile prose** — `visibleProfileText` returns `null`. Exists.
5. **Rolling summary** — the `memory_summary` row is gone. Exists.

Two raw probes below the channel layer: the canonical `memory_records` row
(exists) and a direct `memory_records_fts MATCH` query (new — the external-content
trap the predecessor spec called for and the test never got).

**Provisional twin sweep.** Seed an active record and a `provisional` record
whose content differs only in case, purge the active one by id, assert both rows
are gone and `listProvisionalRecords` returns nothing.

**Write-boundary gate.** After a forget: `saveMemoryRecord` with
`source: 'background'` returns `null`; `saveMemoryRecordWithEmbedding` returns
`null` and the injected `getEmbedding` spy records zero calls;
`updateMemoryRecord` rewriting content to the tombstoned value returns `null`.
The same save with `source: 'explicit'` succeeds, proving the override survives.

**`memory_facts` boundary.** In `scope-clear.test.ts`, assert the facts rows for
the scope's keys are deleted. In the purge test, assert a single-record purge
leaves them intact, with a comment naming the reason.

## Error handling

Purge and clear each remain a single `db.transaction`, so the sweep cannot
half-complete. A suppressed write is a `null` return plus an `info` log with
counts, never an exception. All new logging stays metadata-only — ids, counts,
booleans — never content, never the hash.

## Files touched (anticipated)

- `src/long-term-memory/purge.ts` — content-hash sweep inside the existing
  transaction; `recordsDeleted` in the log line.
- `src/long-term-memory/store.ts` — gate in `saveMemoryRecord` and
  `updateMemoryRecord`; `saveMemoryRecord` return type becomes
  `MemoryRecord | null`.
- `src/long-term-memory/embedding-writer.ts` — propagate `null`, skip embedding.
- `src/long-term-memory/capture.ts`, `src/long-term-memory/runner.ts` — drop the
  local `isContentTombstoned` filters, count `null` returns as suppressed.
- `src/long-term-memory/scope-clear.ts` — comment stating the `memory_facts`
  boundary.
- `tests/long-term-memory/durable-erasure.golden.test.ts` — semantic channel, FTS
  probe, provisional twin, write-boundary gate.
- `tests/long-term-memory/scope-clear.test.ts` — `memory_facts` deletion.
- Any caller of `saveMemoryRecord` in tests that assumes a non-null return.

## Rollout note

No migration. The behavior changes are that a forget now removes duplicate rows
carrying the same content, and that background writes of tombstoned content are
refused at the store rather than at two call sites. Both are corrections to the
approved erasure semantics, not new policy, so no feature flag.
