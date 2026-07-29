<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Hybrid memory retrieval: Unicode lexical, query-time validity, RRF fusion, embedding identity

Date: 2026-07-23
Status: approved for planning

## Problem

The current-state audit
([`docs/research/agent-memory/01-current-state-audit.md`](../../research/agent-memory/01-current-state-audit.md))
verified six defects in the long-term memory subsystem from executable code at
commit `eab9ed2b4e2dac0279d338436b59c3a89d87bc8a`. This spec covers four of
them. Two are deferred to their own specs because each carries a decision that
should be reviewed separately.

| # | Defect | Source evidence | This spec |
| --- | --- | --- | --- |
| 1 | Lexical fallback tokenizer is `[a-z0-9]+`, so Cyrillic queries produce zero tokens | `recall-ranking.ts:13` | in scope |
| 2 | `expiresAt` and validity windows are never checked at query time | `store.ts:135-183`, `semantic-search.ts:50-60` | in scope |
| 3 | Retrieval returns semantic hits *or* lexical hits, never both; two of three write paths persist no embedding | `recall-cascade.ts:65-81`, `tools/memory.ts:83-119`, `runner.ts:101-198` | in scope |
| 4 | No embedding model, dimension, or version metadata | `long-term-memory-schema.ts:25-63` | in scope |
| 5 | `forget_memory` archives rather than purges; scope-clear leaves residue | `store.ts:185-229` | deferred |
| 6 | Turn injection selects three records by `lastSeenAt`, ignoring the query | `conversation.ts:61-84` | deferred |

Defects 1-4 correspond to the `corrected-hybrid` candidate in the frozen
benchmark, which scored `0.7595` nDCG against `0.5233` for the active-record
proxy — about 75% of the total gain available from the full architecture
([`04-results.md`](../../research/agent-memory/04-results.md)).

Defect 2 is partially load-bearing for defect 6: enforcing expiry at query time
stops expired records being injected, without changing injection's
recency-based nature. That improvement lands here; making injection
query-aware does not.

## Non-goals

- Erasure semantics (defect 5). Purge-versus-archive is a product and
  retention-policy decision, not an engineering one.
- Query-aware injection (defect 6). It adds a retrieval call to every turn,
  which is a latency and token-cost change on the hot path, and it depends on
  fusion landing first.
- Hierarchical summaries, canonical event log, or temporal graph. Those belong
  to the accepted ADR's later phases, not this slice.
- Changing the FTS5 tokenizer. `unicode61` was verified sufficient; changing it
  forces a full index rebuild for no measured gain.
- Russian stemming. Prefix matching partially compensates; full morphology is
  out of scope and recorded as a known limitation.

## Verified findings that shape the design

These were established empirically during design, not assumed.

**FTS5 already provides a Unicode lexical channel.** `memory_records_fts` is
created with the default `unicode61` tokenizer and maintained by insert,
update, and delete triggers
([`053_long_term_memory.ts:55-79`](../../../src/db/migrations/053_long_term_memory.ts)).
A probe confirmed it case-folds Cyrillic correctly (`МАРШРУТ` matches
`Маршрут`, `ПРОПИСНЫЕ` matches `прописные`) and that `bm25()` ranking works.
The dead ASCII tokenizer is the JavaScript one in `recall-ranking.ts`; the
recall cascade uses it instead of FTS, while `searchMemoryRecords()`, which
does use FTS, is wired only to the forget-by-query path.

**FTS5 does not stem.** Bare `маршрут` does not match `Маршруты`. The prefix
form `"маршрут"*` matches both `Маршруты` and `маршруту`, so the query builder
must emit prefix terms to cover Russian inflection.

**Quoted-prefix OR queries are safe and valid.** `"маршрут"* OR "доставк"*`
parses, mixes scripts, and returns an empty result rather than a syntax error
when a term is degenerate.

**Migrations cannot embed.** `applyMigration` wraps a synchronous
`up(db: Database): void` in `db.transaction()`
([`src/db/migrate.ts:110-117`](../../../src/db/migrate.ts)), so async network
I/O cannot be awaited inside. Independently, embeddings resolve credentials per
config context through `resolveLlmConfig(configContextId)` with BYOK and global
fallback ([`src/llm-providers/resolver.ts:60-72`](../../../src/llm-providers/resolver.ts)),
so a migration has no context from which to choose a model. Re-embedding must
happen after boot, grouped by config context.

**Timestamps are safe to compare as strings.** Every timestamp is written as
`new Date().toISOString()`, fixed-width UTC. `maintenance.ts` already relies on
lexicographic comparison via `lte()`.

**Provisional records are FTS-indexed.** They live in `memory_records` with
status `provisional`, so one hybrid search parameterized by status and thread
filters can serve all three recall-cascade layers, replacing the current split
where layer 2 ranks differently from layers 1 and 3.

## Design

### Data model: migration 068

Add four nullable columns to `memory_records`:

| Column | Type | Meaning |
| --- | --- | --- |
| `embedding_model` | TEXT | model id that produced the vector |
| `embedding_dimension` | INTEGER | vector length |
| `embedding_version` | TEXT | compatibility identity for the dense channel |
| `embedded_at` | TEXT | ISO-8601 UTC timestamp of embedding |

Existing rows with a non-null `embedding` are stamped
`embedding_version = 'unknown'`. Rows without an embedding keep all four NULL.
A partial index covers rows needing backfill so the sweep does not table-scan.

The migration is synchronous and metadata-only. It performs no network I/O.

The FTS table is unchanged.

### Embedding backfill

A new `src/long-term-memory/embedding-backfill.ts` job, registered in the
existing scheduler and run eagerly after boot.

- Selects rows where `embedding IS NULL` or `embedding_version = 'unknown'`.
- Groups them **by config context**, so `resolveLlmConfig` resolves the correct
  BYOK credentials for each scope.
- Drains with `p-limit` bounded concurrency, per repo convention.
- Checkpoints per row, so a restart resumes rather than restarts.
- Writes vector and all four metadata columns in one update.
- Logs at `warn` and skips a context whose credentials are missing or
  unreadable; it must not retry into a hot loop.

`embedding-writer.ts` stamps the same metadata on every write, so newly created
records never enter the `unknown` state.

Records awaiting backfill remain fully retrievable through the lexical channel.
Nothing becomes invisible while the sweep runs.

### Retrieval pipeline

Delete the JavaScript token-overlap scorer `rankCandidatesByQuery` and the
either/or branch in `searchActiveHybrid`. Replace with four focused modules.

**`lexical-query.ts`** — Unicode-aware tokenization (`\p{L}\p{N}`), then an
FTS5 query builder emitting escaped quoted prefix terms joined by `OR`:
`"маршрут"* OR "выезд"*`. Escaping doubles internal quotes. An empty token set
short-circuits to "no lexical hits" rather than building a degenerate MATCH.

**`lexical-search.ts`** — FTS5 search ranked by `bm25()`, returning scored
rows. Replaces the 500-row in-process cap with an index lookup.

The new builder is used for **recall only**. `searchMemoryRecords()`, which
backs forget-by-query, keeps the existing phrase semantics of
`sanitizeFtsQuery`. Prefix-OR is deliberately broader than phrase matching, and
broadening the match set of a destructive operation would mean `forget_memory`
silently archiving more records than the same query archives today. Widening
recall is the goal; widening deletion is not.

**`semantic-search.ts`** (modified) — the dense channel gains a
version-compatibility predicate and returns scores rather than bare records.

The version identity is `${model}:${dimension}` — the two properties that make
two vectors comparable at all. A record is dense-eligible only when its
`embedding_version` equals the identity resolved for **the config context
executing the query**, not a global constant: BYOK means two scopes can
legitimately sit on different embedding models, so "current" is
per-config-context. Comparing vectors across models produces meaningless cosine
scores, which is precisely what this column exists to prevent.

Ineligible records — `unknown`, mismatched, or absent — drop out of the dense
channel only. They remain lexically retrievable.

**`fusion.ts`** — weighted reciprocal rank fusion, ported faithfully from the
measured candidate
([`corrected-hybrid.ts:178-212`](../../../scripts/memory-research/candidates/corrected-hybrid.ts)):

- rank-fusion offset `k = 60`;
- lexical channel weight `2`, dense channel weight `1`;
- union of both channel candidate lists;
- score `= Σ weight / (k + rank)` per channel in which the record appears;
- deterministic tie-break by record id.

The `0.65` cosine threshold is retained but changes job: it gates entry to the
*dense candidate list* and no longer suppresses lexical results. Because RRF
consumes ranks rather than raw scores, substituting production `bm25()` for the
research token-overlap scorer changes ordering within the lexical channel while
leaving the fusion arithmetic identical to what was measured.

### Query-time validity and expiry

One shared SQL predicate in `record-conditions.ts`:

```sql
(valid_from  IS NULL OR valid_from  <= :now) AND
(valid_until IS NULL OR valid_until >  :now) AND
(expires_at  IS NULL OR expires_at  >  :now)
```

Validity is half-open, matching the research semantics. The predicate is
applied to every read path: `listMemoryRecords` (which feeds turn injection),
`searchMemoryRecords`, the new lexical search, the dense scan, and provisional
listing.

`now` is supplied through a `now: () => string` dependency, following the
existing pattern in `capture.ts` and `capture-debounce.ts`, so boundary
behavior is testable without manipulating the clock.

This demotes hourly maintenance from a correctness mechanism to housekeeping.
It keeps archiving expired rows, but is no longer what stands between an
expired record and the model.

## Affected files

Created:

- `src/db/migrations/068_memory_embedding_identity.ts`
- `src/long-term-memory/lexical-query.ts`
- `src/long-term-memory/lexical-search.ts`
- `src/long-term-memory/fusion.ts`
- `src/long-term-memory/embedding-backfill.ts`

Modified:

- `src/db/long-term-memory-schema.ts` — four new columns
- `src/db/index.ts` — register migration 068
- `src/long-term-memory/types.ts` — embedding identity on record and input types
- `src/long-term-memory/serialization.ts` — map new columns; `sanitizeFtsQuery`
  is retained, not retired (see below)
- `src/long-term-memory/semantic-search.ts` — version predicate, scored results
- `src/long-term-memory/recall-cascade.ts` — call unified hybrid search
- `src/long-term-memory/record-conditions.ts` — validity predicate
- `src/long-term-memory/store.ts` — apply validity predicate to read paths
- `src/long-term-memory/provisional-store.ts` — apply validity predicate
- `src/long-term-memory/embedding-writer.ts` — stamp identity metadata
- `src/scheduler-instance.ts` — register the backfill job

Deleted:

- `src/long-term-memory/recall-ranking.ts` — the ASCII token-overlap scorer

## Testing

Test-driven per repo policy: write the behavior test, run it, record the
failing result, then implement.

**Unit tests**

- tokenizer: Cyrillic, mixed script, punctuation, empty input
- FTS query builder: quote escaping, adversarial input, empty-token
  short-circuit
- fusion: rank arithmetic, tie-break determinism, single-channel and
  both-channel cases
- validity predicate: exactly-at-boundary, half-open edges

**Integration tests** — a seeded-SQLite bilingual golden set under
`tests/long-term-memory/`, with one assertion per defect so each stays fixed:

| Assertion | Guards |
| --- | --- |
| A Cyrillic query returns hits | 1 |
| An expired-but-active record is neither returned nor injected | 2 |
| An unembedded record still surfaces when a semantic hit also exists | 3 |
| An `unknown`-version record is excluded from dense, still found lexically | 4 |

**Other gates** — `bun test`, `bun typecheck`, `bun lint`, `bun format:check`,
and `bun security`, the last because the MATCH builder is an
injection-adjacent surface.

Existing memory tests that assert current ranking will need updating; that is
expected and should be done deliberately, not by loosening assertions.

## Risks

**Ranking shifts for every existing user.** There is no shadow mode in this
slice, so results reorder on deploy. The golden set proves the defects are
fixed; it is synthetic and does not prove real-world recall improved.

**Recall broadens.** Prefix-OR with bm25 surfaces more candidates than exact
token overlap. RRF's `k = 60` damps the tail; precision assertions in the
golden set are the check.

**Boot-time burst against the embedding API.** Bounded concurrency and
per-context credential skipping keep it civil, but a large table means real
cost on the first boot after deploy.

**Temporary dense-coverage gap.** `unknown`-version rows sit out of the dense
channel until backfilled. Lexical keeps them reachable throughout. This is the
deliberate trade that prevents the invisible-record bug from recurring during
migration.

**No stemming.** Prefix matching covers much Russian inflection but not all;
`бежать` will not match `побежал`. Recorded as a known limitation.

## Success criteria

- A Cyrillic query against Cyrillic content returns relevant records.
- No expired or out-of-validity record is returned from any read path or
  injected into any turn.
- A record without a compatible embedding is retrievable lexically, including
  when other records do produce semantic hits.
- Embedding model, dimension, and version are recorded for every embedded
  record, and a model change is detectable from row metadata.
- Backfill completes for every context with resolvable credentials, and is
  resumable across restart.
- All repo gates pass, and no existing memory test is weakened to accommodate
  the change.
