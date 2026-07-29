<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Durable Memory Erasure (Audit Defect 5)

Status: approved design, pre-implementation
Date: 2026-07-24
Branch: memory-vector-graph-research
Predecessor: `2026-07-23-memory-hybrid-retrieval-design.md` (defects 1–4, shipped in PR #189)

## Problem

The agent-memory audit's defect 5 is a correctness/safety/privacy defect, not a
ranking nicety: it is the single failure that made the `as-shipped` candidate
*ineligible* in the frozen protocol-v4 study (F-01 — the active-record proxy
returned six erased evidence items). Two concrete gaps in the deployed code:

1. **`forget_memory` archives rather than purges.** The tool calls
   `archiveMemoryRecord()` (`store.ts:196`), which only flips `status` to
   `'archived'`. The canonical row, its `content` column, the FTS index entry,
   and the embedding blob all remain intact. Recall filters archived status out
   of *retrieval*, but the data is fully present, re-derivable, and recapturable.

2. **`clearMemoryScope` leaves residue.** It hard-deletes `memory_records` (FTS
   drops via the existing `AFTER DELETE` trigger) and `memory_profiles`
   (`store.ts:227`) — and nothing else. It leaves the re-extraction watermark
   (`memory_extraction_state`) and all working memory (`conversation_history`,
   `memory_summary`, `memory_facts`), plus the in-memory caches that shadow
   summary/facts. So "clear my memory" leaves recallable and re-derivable data.

The failure catalog (`docs/research/agent-memory/05-failure-catalog.md`,
§"Security, trust, and durable erasure") is explicit that even the research's
erasure slice only tested live retrieval + non-recapture. It does **not** prove
deletion from canonical rows, FTS indexes, vectors, summaries, caches, logs, or
SQLite WAL/freelist pages. This slice closes that gap for the two in-app paths.

## Goals

- **Durable single-record forget.** After `forget_memory`, the record is
  unreachable by every retrieval channel and physically zeroed on disk, and
  background capture will not silently re-learn the same fact.
- **Complete scope clear.** After `clearMemoryScope`, nothing survives for the
  scope that could be recalled or re-derived — long-term records, working
  memory, the re-extraction watermark, tombstones, and caches all go.
- **Physical durability.** Deleted bytes are zeroed in place rather than left in
  freelist/WAL pages; no content is ever written to logs.
- **Provable.** A bilingual (EN+RU) golden-set test asserts an erased id/content
  is unreachable by *every* channel, each test proven to fail before the fix.

## Non-goals

- **Backups, replicas, external artifacts.** Out of app control; documented as
  operator retention-policy responsibility, not an engineering guarantee here.
- **Semantic recapture prevention.** The tombstone catches verbatim/near-verbatim
  re-learning after content normalization; it does not block a paraphrased
  re-extraction. Embedding-similarity suppression is heavier and deferred.
- **Crash-injection / race / backup-restore testing.** These belong to the
  Phase-0 acceptance harness in `06-recommendation.md`, not this slice. We add
  transactional atomicity as a first-line defense but do not claim to have
  tested crash recovery.
- **Hierarchy, canonical event log, storage-engine migration.** Later phases.

## Verified findings that shape the design

Established by reading the code during design, not assumed.

- **FTS drops on delete already work.** `memory_records_fts` has `AFTER DELETE`
  and `AFTER UPDATE` triggers (`053_long_term_memory.ts:75`). Deleting the
  canonical row removes the FTS entry and the embedding (same row). Archive does
  *not* — the row survives, so FTS and embedding survive.
- **Archive has a second, legitimate caller.** `promotion.ts:75` uses
  `archiveMemoryRecord` to mark dedup/contradiction losers `'archived'`. That is
  a valid soft state, distinct from user-initiated forget. Archive must stay;
  only *user forget* becomes a purge.
- **Two scope-keying schemes.** Long-term memory keys by
  `(scopeId, scopeType)` (`long-term-memory-schema.ts`). Working memory keys by
  storage-context `user_id`/`context_id` (`schema.ts:58-80`,
  `long-term-memory-schema.ts:72`). `resolveMemoryScope` (`scope.ts:15`) maps
  personal DMs to `scopeId = storageContextId` and groups to
  `scopeId = getMainContextIdFromThreadContextId(storageContextId)`. A scoped
  context id is `pi:<inst>:ctx:<native>[:thread:<id>]`
  (`scoped-context.ts:26`), so a group's thread storage contexts share the
  `scopeId` prefix.
- **secure_delete is a connection pragma.** The DB connection is initialized
  once in `drizzle.ts:19-22` with WAL + foreign_keys pragmas; `secure_delete`
  belongs alongside them.
- **Caches shadow the DB.** `memory_summary`/`memory_facts` are fronted by
  in-memory caches (`memory.ts` → `cache.js`); `evictUser(userId)`
  (`cache-eviction.js`, re-exported from `cache.js:19`) drops a full per-key
  cache. Clearing the DB without evicting caches would leave stale reads.
- **Three write paths persist records, two of them background.**
  `capture.ts:130` (background provisional, `source: 'background'`) and
  `runner.ts:117` (background extraction, `source: 'background'`,
  `status: 'active'`) are both automatic; `tools/memory.ts:96` is explicit
  remember (`source: 'explicit'`). Recapture suppression must cover *both*
  background paths; explicit remember is an intentional override.
- **Transactions are available and idiomatic.** `db.transaction((tx) => …)` is
  used across the repo (`cache-db.ts:64`, settings stores).

## Design

### 1. Tombstone table — migration 069

`memory_tombstones`: a content-free suppression index.

| column        | type | notes                                        |
| ------------- | ---- | -------------------------------------------- |
| `scope_id`    | text | not null                                     |
| `scope_type`  | text | enum `personal` \| `group`, not null         |
| `content_hash`| text | SHA-256 (hex) of normalized content, not null|
| `forgotten_at`| text | ISO timestamp, not null                      |

Primary key `(scope_type, scope_id, content_hash)`. **No content column** — the
tombstone stores only a hash, so it leaks nothing about what was forgotten.

Content normalization (shared helper, e.g. `serialization.ts`): trim, lowercase,
collapse internal whitespace to single spaces, then SHA-256 → hex. Applied
identically at forget time and at capture time so hashes line up.

### 2. `secure_delete` pragma

Add `sqlite.run('PRAGMA secure_delete=ON')` to `drizzle.ts` connection init,
next to the existing WAL/foreign_keys pragmas. Deleted rows are zeroed in place,
eliminating freelist/WAL residue without a per-forget VACUUM. A test asserts
`PRAGMA secure_delete` reads back `1`.

### 3. `store.ts` — purge and extended clear

**`purgeMemoryRecord(scope, recordId, now): boolean`** — one transaction:
1. SELECT the row's `content` (scope-guarded via `recordScopeCondition`); if
   absent, return `false`.
2. DELETE the row (FTS + embedding drop via the existing trigger / same row).
3. INSERT the tombstone `(scope, contentHash(content), now)`
   (`onConflictDoNothing`).
Returns `true`.

**`forget_memory` switches to purge.** Both callers of the forget behavior —
the tool (`tools/memory.ts:190,206`) and the settings route
(`memory-routes.ts:186`) — call `purgeMemoryRecord` instead of
`archiveMemoryRecord`. The forget-by-query branch keeps its existing match
semantics (single best match), then purges the matched id.

**`archiveMemoryRecord` stays** for `promotion.ts` dedup losers. Unchanged.

**`clearMemoryScope(scope)` extended** — one transaction, returns expanded
counts `{ profileDeleted, recordsDeleted, workingMemoryKeysCleared,
extractionStateDeleted, tombstonesDeleted }`:
1. DELETE `memory_records` + `memory_profiles` for the scope (as today).
2. Compute working-memory keys for the scope (see §4); DELETE
   `conversation_history`, `memory_summary`, `memory_facts` for those keys and
   `memory_extraction_state` by `context_id` for those keys.
3. DELETE `memory_tombstones` for the scope.
4. After the transaction commits, `evictUser(key)` for each distinct
   working-memory key cleared.

Scope clear intentionally writes **no** tombstones: working memory is wiped in
the same operation, so there is nothing left to re-extract from — tombstones
would be redundant.

### 4. Scope-key reconciliation helper

A helper derives the working-memory storage keys from a `MemoryScope`:

- **personal**: `[scopeId]` (DM storage context == scopeId).
- **group**: exact `scopeId` (main thread) **plus** every key matching
  `scopeId || ':thread:%'` (each thread under the config context).

Realized as a SQL predicate (`col = scopeId OR col LIKE scopeId || ':thread:%'`)
so the same shape drives the DELETEs against `conversation_history`,
`memory_summary`, `memory_facts`, and `memory_extraction_state`. For cache
eviction, the clear collects the distinct keys actually deleted (via
`returning`) and evicts each.

### 5. Recapture prevention

A shared guard — `isTombstoned(scope, content)` / a `filterTombstoned` helper
(hash + scope lookup) — is applied at both background write paths so the logic
stays DRY:

- **Background provisional capture** (`capture.ts`, before the provisional
  insert): drop records whose content hash matches a scope tombstone; log `info`
  (ids/counts only, never content). Provisional promotion inherits this because
  nothing provisional was created.
- **Background extraction** (`runner.ts:insertRecords`, before the active
  insert): same filter — a forgotten fact re-surfaced by the extractor is
  dropped rather than re-persisted.
- **Explicit `remember_memory`** (`tools/memory.ts`, `source: 'explicit'`):
  *not* suppressed. After a successful save, DELETE any matching tombstone for
  the scope. An explicit re-add is an intentional override of an earlier forget.

**Documented limitation:** hashing is post-normalization but pre-paraphrase.
It reliably suppresses re-capture of the same or trivially reworded content and
deterministic `tool_result` facts; it does not suppress a semantically
equivalent paraphrase the extractor might produce. This is acceptable for the
slice and recorded as a known limitation; embedding-similarity suppression is a
later option.

### 6. Atomicity and logging

- Purge (select→delete→tombstone) and clear (multi-table deletes) each run in a
  single `db.transaction()`, so a crash cannot leave a half-erased state.
- All new logging is metadata-only: scope ids, counts, booleans — never content
  or hashes-of-content in a way that could be reversed against known plaintext
  (hashes are fine to omit entirely; log counts).

## Testing

Bilingual (EN + RU) golden set, mirroring
`tests/.../memory-hybrid-retrieval` structure. Every test must be shown to fail
before the corresponding fix (red → green).

1. **Purge unreachability.** Seed a record, `forget` it, then assert its id is
   absent from: the recall cascade, lexical search, semantic search,
   `listMemoryRecords` for *every* status, forget-by-query search, and turn
   injection — and that a direct `memory_records` lookup and a raw
   `memory_records_fts MATCH` probe both return nothing.
2. **Recapture suppression.** After forget, a background write of the same
   (and a whitespace/case variant of the) content is skipped on *both*
   background paths (provisional capture and extraction runner); an explicit
   `remember_memory` of the same content succeeds and removes the tombstone
   (proven by a subsequent background capture of that content now succeeding).
3. **Scope-clear completeness.** For a scope that includes a group *thread*
   storage key, assert `conversation_history`, `memory_summary`, `memory_facts`,
   `memory_extraction_state`, and `memory_tombstones` rows are all gone, and the
   in-memory caches for the cleared keys are evicted.
4. **secure_delete enabled.** `PRAGMA secure_delete` reads back `1` on the
   shared connection.

## Files touched (anticipated)

- `src/db/migrations/069_memory_tombstones.ts` (new) + registration in
  `src/db/index.ts`.
- `src/db/long-term-memory-schema.ts` — `memoryTombstones` table; re-export in
  `src/db/schema.ts`.
- `src/db/drizzle.ts` — `secure_delete` pragma.
- `src/long-term-memory/store.ts` — `purgeMemoryRecord`, extended
  `clearMemoryScope`, scope-key helper.
- `src/long-term-memory/serialization.ts` (or a small new module) — content
  hash/normalize helper.
- `src/long-term-memory/capture.ts` — tombstone filter before provisional insert.
- `src/long-term-memory/runner.ts` — tombstone filter before background insert.
- `src/tools/memory.ts` — forget → purge; remember clears tombstone.
- `src/debug/settings/memory-routes.ts` — forget route → purge; surface new
  clear counts.
- Tests under `tests/long-term-memory/` (or the established memory test dir).

## Rollout note

Migration 069 is additive (new table + pragma); no backfill. The behavior
change is that user forget now destroys data instead of hiding it — this is the
intended, approved semantics. No feature flag: the prior behavior was a defect.
