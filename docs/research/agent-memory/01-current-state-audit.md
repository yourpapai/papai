<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Current-state memory audit

Audit date: 2026-07-23  
Audited revision: `eab9ed2b4e2dac0279d338436b59c3a89d87bc8a`

This document audits the deployed memory subsystem from executable code. It
does not use archived-plan intent as evidence. Source comments are treated as
orientation only and checked against call sites, schemas, and queries.

The research artifact id `as-shipped` does not represent this entire system. It
is a deliberately narrow active-record retrieval/injection proxy whose exact
modeled boundary is listed below. Production behaviors audited here but absent
from that boundary remain design inputs and limitations, not benchmarked
baseline behavior.

## System map

Papai currently has two distinct memory planes plus transient tool-result
compaction:

| Plane                       | Canonical/persistent state                                                                                | Read path                                                                                                                           | Write/maintenance path                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Working conversation memory | `conversation_history`, `memory_summary`, `memory_facts` in SQLite, fronted by a process-local cache      | A low-trust system block containing summary and up to 10 recent entity facts is prepended to history                                | Assistant turns append history; a background small-model trim retains 50–100 messages and rewrites a maximum-200-word summary   |
| Long-term memory            | `memory_profiles`, `memory_records`, FTS5 external-content index, and `memory_extraction_state` in SQLite | Every turn injects the profile plus three most-recent active records; the `search_memory` tool performs the explicit recall cascade | Explicit tool writes, two automatic extraction paths, provisional promotion, and hourly stale/expiry maintenance                |
| Tool-result compaction      | Raw oversized results in a process-local per-context map                                                  | The model receives a compacted envelope and can page raw text with `expand_result`                                                  | Results over 8,000 bytes are summarized or preview-truncated; entries have a 30-minute TTL and a 64-entry per-context LRU bound |

The process uses one SQLite database path (`DB_PATH`, default `papai.db`) and
opens it in WAL mode with foreign keys enabled
([`src/db/drizzle.ts`](../../../src/db/drizzle.ts#L10-L27)).

## Working memory

Conversation history is keyed by the raw storage context id. It is loaded from
SQLite into an in-process `Map`, copied on reads, and synchronously written back
through the cache persistence helper on append/set
([`src/cache.ts`](../../../src/cache.ts#L35-L81),
[`src/history.ts`](../../../src/history.ts#L13-L34)). The cache itself expires
after 30 minutes of inactivity; eviction drops only the process copy, not the
SQLite rows
([`src/cache-eviction.ts`](../../../src/cache-eviction.ts#L9-L32)).

Trimming is triggered when any of these conditions holds:

- every tenth user message once history exceeds 50 messages;
- total history reaches 100 messages;
- estimated tokens reach 50% of a known model context window, once history
  exceeds 50 messages.

The small-model prompt requests 50–100 retained message indices and a
maximum-200-word cumulative summary. Each serialized message is capped at 2,000
characters before the trim prompt. The response is schema-validated and
tool-call/result pairing is repaired by `resolveTrimmedIndices`
([`src/conversation.ts`](../../../src/conversation.ts#L23-L94),
[`src/memory.ts`](../../../src/memory.ts#L139-L249)).

Only one trim runs per storage context in a process. When it finishes, messages
appended after its input snapshot are added after the retained set. A trim
failure leaves the existing history intact
([`src/conversation.ts`](../../../src/conversation.ts#L96-L168)). Trimming is
deferred when a turn stops at the tool-step cap so an in-progress tool trace is
not summarized before a resume turn
([`src/llm-history.ts`](../../../src/llm-history.ts#L18-L65)).

Working facts are not general conversation extraction. The orchestrator
deterministically derives a small entity-reference cache from selected
task/project tool results and upserts those facts for the storage context
([`src/llm-orchestrator-support.ts`](../../../src/llm-orchestrator-support.ts#L193-L203),
[`src/memory.ts`](../../../src/memory.ts#L82-L138)).

Before each turn, the working-memory block contains the cumulative summary and
at most 10 facts ordered by recent observation. Facts older than 14 days are
marked stale in the prompt and facts older than 45 days are omitted from the
block, but omission is not database deletion
([`src/memory-context-block.ts`](../../../src/memory-context-block.ts#L8-L65)).

## Long-term storage model

`memory_records` stores scope, kind, content, optional summary, tags,
confidence, status, source, evidence JSON, optional thread provenance,
created/updated/last-seen timestamps, optional validity/expiry timestamps, and
an optional embedding BLOB. It does not store an embedding model id, dimension,
normalization, content hash, or embedding version
([`src/db/long-term-memory-schema.ts`](../../../src/db/long-term-memory-schema.ts#L25-L63)).

The FTS5 table indexes `content`, `summary`, and serialized tags. Insert, update,
and delete triggers keep the external-content index synchronized
([`src/db/migrations/053_long_term_memory.ts`](../../../src/db/migrations/053_long_term_memory.ts#L48-L86)).

Supported memory kinds are preference, fact, decision, project context, person
context, procedure, episode, and reference. Statuses are active, stale,
archived, contradicted, and provisional. These labels provide useful lifecycle
metadata, but current retrieval does not consistently enforce validity windows
or expiry at query time
([`src/long-term-memory/types.ts`](../../../src/long-term-memory/types.ts#L8-L72)).

## Capture paths

There are three write surfaces, two of them automatic:

### Explicit tool capture

`remember_memory` writes an active record with confidence `1`, source
`explicit`, and optional expiry. It calls `saveMemoryRecord` directly and does
not request or persist an embedding
([`src/tools/memory.ts`](../../../src/tools/memory.ts#L83-L119)).

### Trim-coupled background extraction

Whenever working-memory trim is triggered, non-guest turns also call
`runMemoryExtractionInBackground`. This path operates in both DM and group
contexts, reads the existing active profile/records, and can replace the
profile, insert active records, and update records. Inserted records call
`saveMemoryRecord` directly and therefore have no embedding
([`src/llm-history.ts`](../../../src/llm-history.ts#L47-L65),
[`src/long-term-memory/runner.ts`](../../../src/long-term-memory/runner.ts#L101-L198)).

The path has a process-local in-flight guard keyed by effective memory scope.
Concurrent triggers for the same scope are skipped rather than queued
([`src/long-term-memory/runner.ts`](../../../src/long-term-memory/runner.ts#L67-L69),
[`src/long-term-memory/runner.ts`](../../../src/long-term-memory/runner.ts#L211-L235)).

### Idle group-thread provisional capture

Every completed non-guest group turn arms a ten-minute process-local debounce.
It also writes an activity watermark to SQLite. Only group contexts with an
actual thread id pass the capture guard. The extractor writes provisional
records tagged with the source thread, then requests and awaits an embedding
for each record
([`src/long-term-memory/capture-debounce.ts`](../../../src/long-term-memory/capture-debounce.ts#L9-L83),
[`src/long-term-memory/capture.ts`](../../../src/long-term-memory/capture.ts#L99-L136)).

A five-minute scheduled sweep loads dirty activity watermarks that have been
idle for ten minutes and retries capture from cached/persisted history
([`src/long-term-memory/extraction-state.ts`](../../../src/long-term-memory/extraction-state.ts#L12-L71),
[`src/long-term-memory/capture-sweep.ts`](../../../src/long-term-memory/capture-sweep.ts#L27-L47)).

The embedding writer intentionally saves the row first. A `null` embedding or
embedding exception leaves that record committed without a vector; there is no
repair queue or re-embedding sweep
([`src/long-term-memory/embedding-writer.ts`](../../../src/long-term-memory/embedding-writer.ts#L32-L56)).

These two automatic extractors are not one staged pipeline. They have different
trigger conditions, statuses, embedding behavior, update behavior, and
concurrency keys. On a group thread that reaches a trim threshold, both paths
are armed from the same assistant-history function.

## Retrieval and injection

### Unconditional turn injection

`buildMessagesWithMemory` prepends one combined low-trust system message. The
long-term portion is the profile plus the three active records with greatest
`lastSeenAt`; it does not use the current user query, an embedding, FTS, or
validity timestamps
([`src/conversation.ts`](../../../src/conversation.ts#L61-L84),
[`src/long-term-memory/store.ts`](../../../src/long-term-memory/store.ts#L135-L152),
[`src/long-term-memory/context.ts`](../../../src/long-term-memory/context.ts#L8-L67)).

The result is a recency injection, not retrieval. A relevant fourth record can
be omitted while an unrelated recently touched record is injected.

Injection filters on `status = active` but not `expiresAt`. An active record
whose expiry timestamp has passed can therefore remain injectable until the
hourly maintenance job changes its status to archived.

### Explicit `search_memory` recall

The search tool resolves an effective scope and obtains one query embedding.
For DMs it searches active personal records. For groups it cascades:

1. provisional records from the current thread;
2. active records in the shared group scope;
3. provisional records from sibling threads when the first two layers do not
   fill the limit.

Sibling hits asynchronously schedule promotion evaluation
([`src/long-term-memory/recall-cascade.ts`](../../../src/long-term-memory/recall-cascade.ts#L103-L133)).

For active records, a non-null query embedding causes an in-process cosine scan
over every row in the scope/status set that has an embedding. If one or more
semantic hits pass `0.65`, only those semantic hits are returned. Lexical
candidates are consulted only when query embedding is unavailable or semantic
search returns zero hits; there is no score fusion
([`src/long-term-memory/semantic-search.ts`](../../../src/long-term-memory/semantic-search.ts#L40-L78),
[`src/long-term-memory/recall-cascade.ts`](../../../src/long-term-memory/recall-cascade.ts#L55-L73)).

The fallback loads up to 500 records ordered by recency and applies token
overlap. Its tokenizer is `[a-z0-9]+`, so Cyrillic and other non-ASCII scripts
produce no lexical tokens
([`src/long-term-memory/recall-ranking.ts`](../../../src/long-term-memory/recall-ranking.ts#L8-L50)).

The separate `searchMemoryRecords` FTS5 query is used by the forget-by-query
path, not by the recall cascade's active-memory fallback
([`src/long-term-memory/store.ts`](../../../src/long-term-memory/store.ts#L154-L183),
[`src/tools/memory.ts`](../../../src/tools/memory.ts#L179-L214)).

Neither vector nor lexical recall applies an `expiresAt` predicate. An expired
row that is still active remains retrievable during the interval before hourly
maintenance archives it.

## Promotion and maintenance

A provisional candidate is eligible for promotion when its cluster covers at
least three distinct thread ids. Clustering uses cosine similarity `>= 0.8`
when both records have embeddings and exact normalized content equality
otherwise. A small model then answers whether the fact is durable/general.
Confirmation promotes one candidate to active and archives other cluster
members; rejection records a one-week cooldown timestamp
([`src/long-term-memory/promotion.ts`](../../../src/long-term-memory/promotion.ts#L21-L117)).

Promotion can be triggered opportunistically by sibling-thread recall or by a
30-minute scheduled sweep. The sweep processes scopes and candidates
sequentially
([`src/long-term-memory/promotion-sweep.ts`](../../../src/long-term-memory/promotion-sweep.ts#L38-L65),
[`src/scheduler-instance.ts`](../../../src/scheduler-instance.ts#L78-L95)).

Hourly maintenance:

- archives any non-archived row whose `expiresAt` is at or before the current
  timestamp;
- marks non-explicit active rows stale after a kind-specific 45-, 90-, or
  180-day last-seen cutoff.

It does not physically purge archived/stale records, embeddings, profiles, or
extraction watermarks
([`src/long-term-memory/maintenance.ts`](../../../src/long-term-memory/maintenance.ts#L12-L72)).

## Deletion, retention, and rebuild

`forget_memory` and per-record settings deletion are archive operations. The
content, evidence, and embedding remain in `memory_records`; normal recall
filters them out by status
([`src/long-term-memory/store.ts`](../../../src/long-term-memory/store.ts#L185-L193),
[`src/debug/settings/memory-routes.ts`](../../../src/debug/settings/memory-routes.ts#L151-L183)).

The settings "clear memory" operation physically deletes the long-term profile
and all long-term records in the selected scope. It does not clear
conversation history, working summary/facts, memory extraction state, pending
process timers, or tool-result compaction state
([`src/long-term-memory/store.ts`](../../../src/long-term-memory/store.ts#L216-L229),
[`src/debug/settings/memory-routes.ts`](../../../src/debug/settings/memory-routes.ts#L185-L227)).

Working history, summary, and facts each have separate clear functions. No
single audited operation erases all working-memory, long-term-memory,
watermark, and process-local derivatives for one context
([`src/history.ts`](../../../src/history.ts#L28-L34),
[`src/memory.ts`](../../../src/memory.ts#L32-L63)).

The long-term store has no canonical event log from which profiles, facts,
summaries, embeddings, and graph-like derivatives can be rebuilt. FTS is
rebuildable from `memory_records`, but extracted records themselves are the
canonical copy. This differs from the research requirement that graph data be
a rebuildable projection of canonical evidence.

## Scoping and guest behavior

Working conversation history, summary, and facts are thread scoped. Long-term
memory resolves DMs to a personal storage-context scope and groups to the main
group context, deliberately shared across sibling threads
([`src/chat/context-scope.ts`](../../../src/chat/context-scope.ts#L28-L60),
[`src/long-term-memory/scope.ts`](../../../src/long-term-memory/scope.ts#L12-L21)).

Provisional records add `threadContextId` inside the shared group scope so the
recall cascade can distinguish current and sibling evidence. Capture requires a
thread-bearing group id; providers without a distinct thread scope therefore
do not receive this provisional capture behavior
([`src/long-term-memory/capture.ts`](../../../src/long-term-memory/capture.ts#L99-L104)).

Guests are excluded from both automatic capture routes at the audited call
site. The trim-coupled extractor checks `actorRole !== 'guest'`; the debounce
returns before writing an activity watermark
([`src/llm-history.ts`](../../../src/llm-history.ts#L47-L65),
[`src/long-term-memory/capture-debounce.ts`](../../../src/long-term-memory/capture-debounce.ts#L54-L58)).

Guests are nevertheless given every statically classified read-risk tool.
`search_memory` and `list_memory` are read-risk tools, so a guest in an
authorized group can read group-shared active memory. Per-context tool
preferences cannot narrow this guest surface because the fixed guest filter
bypasses them
([`src/tools/tool-metadata.ts`](../../../src/tools/tool-metadata.ts#L128-L131),
[`src/tools/index.ts`](../../../src/tools/index.ts#L67-L78)).

This is "no guest capture," not "no guest visibility." Whether that exposure is
desired is a product-policy question; the benchmark must model it explicitly
instead of assuming guest isolation.

## Compaction and concurrency

Tool-result compaction on the normal chat path is independent of both memory
planes. Successful results over 8,000 bytes are stored in a process-local
per-context map and replaced with a summary or 600-character preview plus a
handle. The raw result expires after 30 minutes and is capped at 64 entries per
context
([`src/tools/compaction/constants.ts`](../../../src/tools/compaction/constants.ts#L6-L12),
[`src/tools/compaction/result-store.ts`](../../../src/tools/compaction/result-store.ts#L10-L66)).
Restart or another process cannot expand an old handle.

Within one process, same-context trims and trim-coupled extractions have
in-flight guards. Debounced captures have pending/in-flight registries and a
teardown drain. These guards are process-local; they do not coordinate multiple
papai replicas. Capture writes all extracted embeddings through unbounded
`Promise.all`, while capture sweeps map all dirty contexts concurrently.
Promotion sweeps deliberately sequence work
([`src/long-term-memory/capture.ts`](../../../src/long-term-memory/capture.ts#L122-L133),
[`src/long-term-memory/capture-sweep.ts`](../../../src/long-term-memory/capture-sweep.ts#L27-L47),
[`src/long-term-memory/promotion-sweep.ts`](../../../src/long-term-memory/promotion-sweep.ts#L45-L65)).

All maintenance, capture-sweep, and promotion-sweep schedules live in the
singleton in-process scheduler. Jobs are not leased, persisted as executions,
or elected across replicas
([`src/scheduler-instance.ts`](../../../src/scheduler-instance.ts#L21-L95)).

## Deployment implications

The shipped topology is well aligned with a single papai process and a local
SQLite file. WAL helps one database file handle concurrent readers/writers, but
the audited code provides no distributed scheduler ownership, cross-process
debounce/in-flight lock, shared tool-result store, or vector index service.

Running multiple replicas against separate database files diverges memory.
Running them against one shared file does not make process-local guards and
timers cluster-safe. The research comparison therefore keeps the default
deployment local and measures whether SQLite crosses explicit scale thresholds
before proposing a storage migration.

## Verified production gaps informing the active-record proxy

These are characterization requirements, not benchmark findings:

| Gap                                | Current-code evidence                                                                                                                                                                           | Consequence to test                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Competing capture paths            | Trim-coupled extraction writes active, unembedded records; idle thread capture writes provisional, embedded records. Both originate in `appendAssistantHistory`.                                | Duplicate/conflicting extraction, inconsistent lifecycle and representation.                               |
| Incomplete embeddings              | Explicit and trim-coupled writes call `saveMemoryRecord`; only provisional capture calls `saveMemoryRecordWithEmbedding`. Failed embedding writes remain committed.                             | Some active records are invisible whenever semantic search returns at least one hit from embedded records. |
| Semantic-or-lexical fallback       | Active recall returns semantic hits when any pass threshold and uses lexical only when embedding is absent or semantic returns zero.                                                            | Lexical evidence cannot complement partial semantic results.                                               |
| ASCII lexical fallback             | Tokenization is `[a-z0-9]+`.                                                                                                                                                                    | Russian/Cyrillic fallback queries can produce no tokens or hits.                                           |
| Recency injection                  | Turn assembly injects three active records ordered by `lastSeenAt`, independent of the user query.                                                                                              | Irrelevant recent records consume context while relevant older records are omitted.                        |
| O(N) vector scan                   | `rankRecordsBySimilarity` selects all in-scope/status rows, deserializes every non-null embedding, scores, sorts, and slices.                                                                   | Retrieval cost grows linearly with candidate rows and performs an additional sort.                         |
| Missing embedding version metadata | Schema stores only an optional embedding BLOB.                                                                                                                                                  | Dimension/model changes cannot be detected, migrated, or selectively rebuilt from row metadata.            |
| Incomplete erasure/retention       | Forget archives; hourly maintenance archives expiry; no purge. Expiration is not checked at query time. Scope clear omits working memory, extraction watermarks, and process-local derivatives. | Test physical/derived state, non-recapture, and the pre-maintenance expired-active visibility window.      |
| Guest visibility                   | Guests cannot capture but retain read-risk `search_memory`/`list_memory` over group scope.                                                                                                      | Guest test cases must distinguish write exclusion from shared-memory read access.                          |
| Process-local scheduling           | Debounce, in-flight guards, compaction handles, and scheduler ownership are process memory.                                                                                                     | Restarts and multiple replicas can lose timers/handles or duplicate scheduled work.                        |

## Active-record proxy boundary

The historical artifact id `as-shipped` models only these selected observable
behaviors:

- in-memory event rows become active records within an exact authorized scope;
- deterministic fixture records may have an embedding or deliberately lack
  one;
- retrieval uses a `0.65` cosine threshold and chooses semantic results or an
  ASCII lowercase-alphanumeric lexical fallback rather than fusing them;
- lexical fallback considers at most 500 eligible records;
- retrieval honors the requested depth, which defaults to 8 in the corpus;
- archived records are excluded while active expired records remain eligible
  because query-time validity is intentionally ignored;
- archive followed by reingestion follows the fixture event sequence; and
- context assembly selects three records by the proxy's ingest/event-time
  recency order.

The proxy uses deterministic substitutes for the configured embedding model.
It exercises retrieval branching and selected lifecycle blind spots, not the
prevalence or accuracy of production extraction.

### Audited but not modeled

The adapter does not execute or approximate:

- working conversation history, trimming, cumulative summaries, entity facts,
  profiles, or tool-result compaction;
- explicit tool capture, either automatic extraction path, provisional
  thread capture, recall cascade, clustering, promotion, or model judgments;
- production SQLite rows, embedding BLOB serialization, FTS5, transactions,
  WAL behavior, or the actual store queries;
- exact task-tool permissions, guest authorization, provider scoping, and
  sibling-thread policy;
- hourly maintenance, scheduled sweeps, process-local debounce/locks, physical
  deletion, backup state, or restored derivatives; or
- real restart/multi-process behavior or a production canonical event log.

Consequently, proxy safety and resource observations are component-fixture
results, not production incidents, guarantees, or performance measurements.
Context assembly is checked for bounded successful completion, but the
relevance of the assembled context is not scored.

## Audit limits

This was a static source audit, not a production-data inspection or load test.
It confirms reachable call paths and query shapes at one commit. It does not
measure prevalence, latency, extraction accuracy, data corruption, or the
behavior of a particular configured LLM provider. Those questions remain for
the controlled experiment and must not be inferred from this document.
