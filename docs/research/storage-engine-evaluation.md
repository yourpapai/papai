# Storage Engine Evaluation: SQLite vs PostgreSQL vs Non-SQL Alternatives

**Date:** 2026-04-26
**Context:** Evaluate whether papai should migrate from SQLite (`bun:sqlite` + Drizzle ORM) to PostgreSQL, TimescaleDB, or non-SQL stores.

## Current State

### Stack

- **Engine:** `bun:sqlite` (WAL mode, foreign keys enabled)
- **ORM:** Drizzle ORM (`drizzle-orm/bun-sqlite`) with `sqliteTable` schemas
- **Migrations:** 27 hand-written raw-SQL migrations using `bun:sqlite` `Database` API
- **Deployment:** Single container + volume-mounted `.db` file (`/data/papai.db`)

### Schema scope

~20 tables across 3 schema files (~353 lines total):

| Schema file                     | Tables                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts` (246 lines)         | `users`, `userConfig`, `conversationHistory`, `memorySummary`, `memoryFacts`, `versionAnnouncements`, `groupMembers`, `authorizedGroups`, `recurringTasks`, `recurringTaskOccurrences`, `userInstructions`, `messageMetadata`, `memos`, `memoLinks`, `userIdentityMappings`, `knownGroupContexts`, `groupAdminObservations` |
| `deferred-schema.ts` (79 lines) | `scheduledPrompts`, `alertPrompts`, `taskSnapshots`                                                                                                                                                                                                                                                                         |
| `web-schema.ts` (28 lines)      | `webCache`, `webRateLimit`                                                                                                                                                                                                                                                                                                  |

### Data access patterns

**Drizzle ORM queries** — majority of data access uses Drizzle query builder (~30+ modules import `getDrizzleDb`):

`users.ts`, `config.ts`, `cache.ts`, `cache-db.ts`, `recurring.ts`, `recurring-occurrences.ts`, `announcements.ts`, `authorized-groups.ts`, `memory.ts`, `memos.ts`, `history.ts`, `conversation.ts`, `message-cache/persistence.ts`, `web/cache.ts`, `web/rate-limit.ts`, `deferred-prompts/scheduled.ts`, `deferred-prompts/alerts.ts`, `deferred-prompts/snapshots.ts`, `tools/set-my-identity.ts`, `tools/clear-my-identity.ts`

**Raw SQL escape hatches** — 3 modules reach through `$client` for SQLite-specific operations:

| Module                          | Pattern                                              | Purpose                                               |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `memos.ts`                      | `getRawDb()` → `rawDb.prepare(...)`                  | FTS5 search, `json_each` tag filtering, count queries |
| `deferred-prompts/snapshots.ts` | `db.$client` → `sqlite.run('BEGIN/COMMIT/ROLLBACK')` | Manual transaction control                            |
| `authorized-groups.ts`          | `db.$client.query('SELECT changes()')`               | Check if INSERT actually inserted                     |

### SQLite-specific features in use

| Feature                               | Location                                               | Migration complexity                                          |
| ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `bun:sqlite` `Database` API           | All migrations, `db/index.ts`, `db/drizzle.ts`         | **High** — must replace connection layer                      |
| `sqliteTable` / `sqlite-core` imports | All schema files                                       | **High** — must rewrite to `pgTable` / `pg-core`              |
| `sql\`(datetime('now'))\`` defaults   | 15+ column defaults                                    | **Medium** — replace with `now()` or `CURRENT_TIMESTAMP`      |
| FTS5 virtual table                    | `memos` full-text index (`018_memos.ts`)               | **High** — no direct PG equivalent; must use `tsvector` + GIN |
| `$client` raw DB access               | `memos.ts`, `snapshots.ts`, `authorized-groups.ts`     | **Medium** — raw SQL must be rewritten                        |
| `json_each()`                         | `memos.ts` tag filtering                               | **Medium** — replace with `jsonb_array_elements`              |
| `PRAGMA` calls                        | `db/index.ts`, `drizzle.ts`                            | **Low** — remove entirely                                     |
| Manual `BEGIN`/`COMMIT`/`ROLLBACK`    | `snapshots.ts`                                         | **Low** — Drizzle handles on PG                               |
| `blob` column type                    | `memos.embedding`                                      | **Medium** — replace with `bytea`                             |
| `integer({ mode: 'boolean' })`        | `webCache.truncated`, `groupAdminObservations.isAdmin` | **Low** — PG has native `boolean`                             |

## Data pattern taxonomy

papai stores 9 distinct data access patterns:

### P1: KV config

**Tables:** `user_config`
**Shape:** `get(userId, key)` / `set(userId, key, value)` — hot path, every LLM call
**Volume:** Low (tens of entries per user)

### P2: Singleton blob

**Tables:** `conversation_history`, `memory_summary`
**Shape:** `get(userId)` → large JSON text blob; whole-read / whole-write
**Volume:** Low (one row per user, blobs up to ~100KB)

### P3: Entity + full-text search + vector

**Tables:** `memos`, `memo_links`
**Shape:** CRUD + FTS5 keyword search + in-app cosine similarity on `blob` embeddings
**Volume:** Moderate (10s-100s per user)

### P4: Time-series with TTL

**Tables:** `message_metadata`, `web_cache`, `web_rate_limit`
**Shape:** Insert + range scan by timestamp + periodic expiry
**Volume:** Moderate (1000s of rows, auto-pruned)

### P5: Scheduled jobs

**Tables:** `recurring_tasks`, `recurring_task_occurrences`, `scheduled_prompts`, `alert_prompts`
**Shape:** CRUD + query by `(status, nextRun)` for polling
**Volume:** Low (10s per user)

### P6: Relational with foreign keys

**Tables:** `recurring_tasks` → `users`, `recurring_task_occurrences` → `recurring_tasks`
**Shape:** ON DELETE CASCADE, foreign key checks
**Volume:** Low

### P7: Graph-like adjacency

**Tables:** `memo_links` (source → target memo/task)
**Shape:** Simple adjacency list queries
**Volume:** Low

### P8: Registry / lookup

**Tables:** `users`, `group_members`, `authorized_groups`, `known_group_contexts`, `group_admin_observations`, `user_identity_mappings`
**Shape:** Point lookups by ID, indexed scans
**Volume:** Low

### P9: Append-only log

**Tables:** `version_announcements`, `user_instructions`
**Shape:** Insert + scan, never update
**Volume:** Very low

## SQL alternatives evaluated

### PostgreSQL

| Pattern            | Fit       | Notes                                                    |
| ------------------ | --------- | -------------------------------------------------------- |
| P1 KV config       | Good      | Compound index, fast point lookups                       |
| P2 Singleton blob  | Good      | `jsonb` or `text` columns                                |
| P3 Entity + search | Excellent | `tsvector` + GIN for FTS; `pgvector` for semantic search |
| P4 Time-series TTL | Good      | `CURRENT_TIMESTAMP` range queries + periodic DELETE      |
| P5 Scheduled jobs  | Good      | Compound index `(status, fire_at)`                       |
| P6 Relational FK   | Excellent | Native FK constraints, CASCADE                           |
| P7 Graph-like      | Good      | Simple joins                                             |
| P8 Registry        | Good      | Standard indexed queries                                 |
| P9 Append-only     | Good      | INSERT-only tables                                       |

**Benefits over SQLite:**

- MVCC concurrent readers+writers (relevant only for multi-instance)
- `jsonb` with GIN indexing for structured JSON fields
- `tsvector` full-text search with ranking, dictionaries, stemming
- `pgvector` native vector similarity (replaces in-app cosine)
- Native `boolean`, `timestamp`, `uuid`, `bytea` types
- `LISTEN`/`NOTIFY` for inter-process events
- Advisory locks for distributed deduplication

**Costs:**

- Schema rewrite: every `sqliteTable` → `pgTable`, every `text`/`integer` → proper PG types
- 27 raw-SQL migrations must be rewritten in PostgreSQL dialect
- Operational overhead: PostgreSQL server (already in docker-compose for Kaneo)
- FTS5 → tsvector: non-trivial rewrite (tokenization, ranking, query syntax differ)
- Raw SQL escapes in 3 modules must be rewritten
- Single-binary deployment lost (two containers)
- Backup/restore: `pg_dump` vs copying `.db` file
- Connection pooling overhead

**Effort:** ~15-25 files changed. Medium-high for this codebase size.

### TimescaleDB

TimescaleDB = PostgreSQL + automatic time-partitioning (hypertables).

| Table                        | Time-series?                  | Benefit                                    |
| ---------------------------- | ----------------------------- | ------------------------------------------ |
| `message_metadata`           | Yes — `timestamp`/`expiresAt` | Moderate — `drop_chunks` for auto-eviction |
| `web_cache`                  | Yes — `fetchedAt`/`expiresAt` | Moderate — retention policies              |
| `web_rate_limit`             | Yes — `windowStart`           | Low — small table                          |
| `recurring_task_occurrences` | Semi — `createdAt`            | Low — low volume                           |
| All others                   | No                            | None                                       |

**Verdict:** Not worth it. Only 2-3 tables have meaningful time-series characteristics, and they're small. Automatic TTL expiry adds complexity for negligible gain in a single-instance chatbot.

### Turso / libSQL

Distributed SQLite fork with HTTP-based access and edge replication.

**Benefits:**

- Schema-compatible with current SQLite (FTS5, `datetime()` work)
- Drizzle support via `drizzle-orm/libsql`
- Edge replication + embedded replicas for low-latency reads

**Costs:**

- Managed service dependency (or self-hosted complexity)
- Driver change: `drizzle-orm/bun-sqlite` → `drizzle-orm/libsql`
- `$client` escape hatches change; libSQL client API differs from `bun:sqlite`
- HTTP round-trip latency on every write vs local file I/O
- 27 migrations must use `@libsql/client` instead of `bun:sqlite` `Database`

**Verdict:** Only makes sense for multi-region deployment. Adds latency and service dependency for no benefit in a single-instance chatbot.

## Non-SQL alternatives evaluated

### Redis / Valkey / Dragonfly

In-memory KV store.

| Pattern            | Fit                                             |
| ------------------ | ----------------------------------------------- |
| P1 KV config       | Excellent — native hash, sub-ms                 |
| P2 Singleton blob  | Good — `GET/SET` with JSON strings              |
| P4 Time-series TTL | Excellent — native `EXPIREAT`, `TTL`            |
| P4 Rate limiting   | Excellent — `INCR` + `EXPIRE`                   |
| P5 Scheduled jobs  | Poor — no range scan (hack via `ZRANGEBYSCORE`) |
| P3 Entity + FTS    | Poor — no FTS without RediSearch module         |
| P6 Relational FK   | None                                            |

**Verdict:** Could offload config, TTL cache, and rate-limiting — but cannot replace the core entity store (memos, recurring tasks, scheduled prompts) which need FTS, relations, and range queries. Would be supplementary only, adding an external process for marginal gain.

### MongoDB / Ferret

Document store with Atlas Search and Vector Search.

| Pattern            | Fit                                                  |
| ------------------ | ---------------------------------------------------- |
| P2 Singleton blob  | Excellent — native JSON documents                    |
| P3 Entity + FTS    | Good — Atlas Text Search or `$text` index            |
| P1 KV config       | Good — embedded sub-documents or separate collection |
| P5 Scheduled jobs  | Moderate — compound index works                      |
| P6 Relational FK   | Weak — no server-enforced FKs, `$lookup` for joins   |
| P4 Time-series TTL | Good — native TTL indexes                            |
| P8 Registry        | Good                                                 |

**Verdict:** Document model maps well to papai's user-scoped blobs. But you lose relational integrity, FTS is weaker than SQLite FTS5 without Atlas (managed), and adds mongod dependency. Drizzle has a MongoDB connector but less mature. Net benefit over SQLite is marginal.

### FoundationDB

Distributed ordered KV store with ACID transactions.

| Pattern            | Fit                                  |
| ------------------ | ------------------------------------ |
| P1 KV config       | Excellent — ordered KV               |
| P5 Scheduled jobs  | Good — ordered key range scans       |
| P6 Relational FK   | None — must implement in application |
| P3 Entity + FTS    | None                                 |
| P4 Time-series TTL | Weak — must implement GC yourself    |

**Verdict:** Overkill. Designed for distributed systems needing serializable ACID across clusters. papai is single-instance. No FTS or vector support. Not worth it.

### CouchDB / PouchDB

Eventual-consistency document store with offline-first sync.

| Pattern           | Fit                                              |
| ----------------- | ------------------------------------------------ |
| P2 Singleton blob | Good — JSON documents, MVCC                      |
| P8 Registry       | Moderate — MapReduce views                       |
| P6 Relational FK  | Poor                                             |
| P3 Entity + FTS   | Poor — basic Lucene integration only             |
| P5 Scheduled jobs | Poor — eventual consistency wrong for scheduling |

**Verdict:** Strength is offline-first sync (PouchDB). papai doesn't need this. MapReduce view model is cumbersome for papai's query patterns.

### Datomic / XTDB

Immutable fact store with bitemporal queries.

| Pattern           | Fit                                                           |
| ----------------- | ------------------------------------------------------------- |
| P2 History        | Interesting — natural append-only fact log                    |
| P4 Snapshots      | Excellent — field-level changes over time is the native model |
| P5 Scheduled jobs | Moderate — Datalog range queries                              |
| P3 Entity + FTS   | None — no FTS or vector                                       |
| P6 Relational FK  | Moderate — via Datalog, no CASCADE                            |

**Verdict:** Conceptually elegant for append-only and snapshot patterns, but XTDB (JVM-based) or Datomic (paid) are massive infrastructure overhead for a chatbot. No Bun/TypeScript-native client for XTDB v2. Interesting theoretically, impractical.

### LMDB / LevelDB / RocksDB

Embedded ordered KV engines.

| Pattern            | Fit                      |
| ------------------ | ------------------------ |
| P1 KV config       | Excellent                |
| P2 Singleton blob  | Good                     |
| P4 Time-series TTL | Weak — no TTL, manual GC |
| P3 Entity + FTS    | None                     |
| P6 Relational FK   | None                     |

**Verdict:** Low-level engines. You'd build your own query layer, indexing, FTS, and transaction management. SQLite already provides all of this. Swapping a complete SQL engine for raw KV and reimplementing half of it makes no sense.

### Qdrant / Milvus / ChromaDB

Vector databases for embedding similarity search.

**Current approach:** Store `Float32Array` as `blob` in SQLite → load all embeddings for user into memory → brute-force cosine similarity.

| Engine     | Notes                                                     |
| ---------- | --------------------------------------------------------- |
| Qdrant     | gRPC + REST, filtering + vector; separate daemon          |
| ChromaDB   | Python-native, HTTP API, slow                             |
| Milvus     | Distributed, GPU-accelerated; overkill                    |
| sqlite-vec | SQLite extension; Bun can't load native extensions easily |

**Verdict:** Current brute-force loads N embeddings per user (<1000 typically) and computes cosine similarity in sub-millisecond. Vector DB only worthwhile at 100K+ vectors. Not worth adding unless memo volume grows dramatically.

### EdgeDB

Graph-relational database built on PostgreSQL with TypeScript-native client.

| Pattern           | Fit                                       |
| ----------------- | ----------------------------------------- |
| P6 Relational FK  | Excellent — native links replace FKs      |
| P3 Entity CRUD    | Excellent — type-safe EdgeQL              |
| P5 Scheduled jobs | Good — filter expressions                 |
| P3 FTS            | Moderate — PostgreSQL tsvector underneath |
| P3 Vector         | Moderate — pgvector available underneath  |

**Verdict:** Graph-relational model maps well to papai's entity relationships. But EdgeDB is its own ecosystem: EdgeQL (not SQL), own migration system, own schema DSL. Drizzle doesn't support it. You'd rewrite the entire data layer and adopt a new query language. Migration cost higher than raw PostgreSQL.

### SurrealDB

Rust-based multi-model database (document + graph + KV) with TypeScript SDK.

| Pattern           | Fit                                         |
| ----------------- | ------------------------------------------- |
| P6 Relational     | Good — record links with `onDelete` cascade |
| P1 KV config      | Good — built-in KV access                   |
| P2 Singleton blob | Good — document model                       |
| P3 FTS            | Moderate — full-text analyzer support (v2+) |
| P3 Vector         | Good — native vector index (v2+)            |
| P7 Graph-like     | Good — `RELATE` for memo_links              |

**Verdict:** Theoretically the best single-store fit — multi-model addresses every pattern. But SurrealDB is still maturing (v2 recent), small ecosystem, Drizzle doesn't support it. You'd use the SurrealDB SDK directly, rewriting all data access. Immature tooling is a production risk.

## Summary comparison

| Option               | Config KV | History   | FTS         | Vector    | Scheduling | Relations | Ops cost  | Migration effort |
| -------------------- | --------- | --------- | ----------- | --------- | ---------- | --------- | --------- | ---------------- |
| **SQLite (current)** | Good      | Good      | FTS5        | In-app    | Good       | Full      | **Zero**  | —                |
| PostgreSQL           | Good      | Good      | tsvector    | pgvector  | Good       | Full      | Medium    | High             |
| TimescaleDB          | = PG      | = PG      | = PG        | = PG      | = PG       | Full      | Med-high  | High             |
| Redis                | Excellent | Moderate  | None        | No        | Poor       | None      | Low       | Supplement only  |
| MongoDB              | Good      | Excellent | Atlas       | Atlas     | Moderate   | Weak      | Medium    | High             |
| FoundationDB         | Excellent | Good      | None        | No        | Good       | None      | High      | Very high        |
| XTDB/Datomic         | Good      | Good      | None        | No        | Moderate   | Moderate  | Very high | Very high        |
| LMDB/LevelDB         | Excellent | Good      | None        | No        | Weak       | None      | Zero      | Very high        |
| Qdrant               | N/A       | N/A       | None        | Excellent | N/A        | N/A       | Medium    | Vector only      |
| EdgeDB               | Good      | Good      | PG tsvector | pgvector  | Good       | Excellent | Medium    | Very high        |
| SurrealDB            | Good      | Good      | Native      | Native    | Moderate   | Good      | Low-med   | High             |

## Decision

**Stay on SQLite.** No alternative provides net improvement for papai's specific combination of patterns at current scale.

Rationale:

1. Single-instance chatbot — SQLite's single-writer limitation is irrelevant
2. Schema is well-designed — proper indexes, WAL mode, foreign keys, FTS5
3. Zero operational overhead — one container, one `.db` file, trivial backup
4. 27 migrations + raw SQL escape hatches = significant migration effort for no user-facing benefit
5. Relational data is core and disqualifies pure KV/document stores
6. FTS5 + in-app cosine handles memo search well at current scale

## PostgreSQL migration triggers

The following concrete conditions should trigger re-evaluation. Any single trigger is sufficient to start planning a migration.

### T1: Multi-instance deployment

**Signal:** Need to run 2+ papai processes serving the same user base simultaneously.
**Why:** SQLite's single-writer model serializes writes across processes. WAL mode allows concurrent reads but only one writer at a time. Multiple instances would contend on the lock and degrade under load.
**Threshold:** Confirmed need for horizontal scaling or active-active deployment.

### T2: Vector search at scale

**Signal:** Memo (or other entity) embeddings exceed 10,000 per user, or cross-user similarity search is needed.
**Why:** Current in-app cosine similarity loads all embeddings into memory and brute-forces comparison. At 10K+ vectors this becomes slow and memory-intensive. PostgreSQL + `pgvector` provides indexed approximate nearest-neighbor search (IVFFlat, HNSW) that scales to millions of vectors.
**Threshold:** Single user with >5,000 memos, or cross-user semantic search feature requested.
**Measurement:** `SELECT user_id, COUNT(*) FROM memos WHERE status = 'active' GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1`

### T3: Full-text search quality limits

**Signal:** FTS5's tokenization or ranking proves insufficient for user-facing memo search (e.g., need stemming, language-aware tokenization, typo tolerance, phrase proximity ranking).
**Why:** PostgreSQL `tsvector` with `pg_trgm` provides configurable dictionaries, stemming, fuzzy matching, and relevance ranking that FTS5 cannot match.
**Threshold:** User complaints about memo search quality, or need for multi-language FTS.

### T4: JSONB query requirements

**Signal:** Need to query or index structured data inside JSON text columns (`memo.tags`, `scheduled_prompts.mention_user_ids`, `scheduled_prompts.execution_metadata`, `alert_prompts.execution_metadata`) beyond simple `json_each` extraction.
**Why:** PostgreSQL `jsonb` with GIN indexes supports arbitrary path queries, containment checks (`@>`), and indexed lookups. SQLite stores these as plain text.
**Threshold:** Feature requiring indexed JSON path queries (e.g., "find all memos tagged X and Y", "find prompts targeting user Z").

### T5: Concurrent write contention observed

**Signal:** Write latency spikes or `SQLITE_BUSY` errors under load, even with WAL mode.
**Why:** WAL mode allows one writer at a time. If the recurring task scheduler, deferred prompt poller, message persistence, and web cache writes overlap frequently, they serialize.
**Threshold:** Sustained write contention observed in production logs. papai's current write patterns are low-frequency and unlikely to hit this, but high-traffic group chats with many recurring tasks could.

### T6: LISTEN/NOTIFY for real-time coordination

**Signal:** Need real-time cross-process or cross-module event notification (e.g., one bot instance needs to notify another that a recurring task fired, or a deferred prompt triggered).
**Why:** PostgreSQL `LISTEN`/`NOTIFY` provides pub/sub without polling. SQLite has no equivalent.
**Threshold:** Multi-instance deployment or real-time event bus requirement.

### T7: Operational requirements

**Signal:** Need any of: point-in-time recovery, replication, streaming backups, or managed database service.
**Why:** SQLite backup is file copy — no PITR, no replication, no managed service. PostgreSQL provides all of these.
**Threshold:** Data loss risk unacceptable without PITR, or hosted deployment requires managed DB.

### T8: Schema complexity growth

**Signal:** Table count exceeds 40, or complex multi-table joins become common in query patterns.
**Why:** PostgreSQL's query planner handles complex joins better than SQLite's. At higher schema complexity, SQLite's simpler optimizer becomes a bottleneck.
**Threshold:** Current trajectory suggests this is distant (20 tables after 27 migrations).

### Anti-triggers (not sufficient alone)

These alone do NOT justify migration:

- "SQLite is not a real database" (it is; WAL mode is production-grade)
- "We might need to scale someday" (premature optimization)
- "PostgreSQL is more standard" (not relevant for a single-instance app)
- "JSONB is nicer than text JSON" (nice-to-have, not a trigger)
- "PostgreSQL has better types" (papai stores timestamps as text already; no pain)

### Pre-migration prerequisites

When a trigger fires, these should be in place before starting migration:

1. **Provider abstraction** — Abstract the DB layer behind a provider interface (similar to existing `ChatProvider` / `TaskProvider` pattern) so the migration can be incremental
2. **Schema dual-path** — Maintain both `sqliteTable` and `pgTable` schemas during transition
3. **Migration strategy** — Decide between: (a) port all 27 migrations to PG dialect, or (b) start fresh with a single PG schema and a data migration script
4. **FTS migration plan** — Map FTS5 queries to tsvector equivalents; test ranking quality
5. **Raw SQL elimination** — Replace `$client` escape hatches with Drizzle queries where possible before migrating, reducing the SQLite-specific surface area
6. **Embedding migration** — Decide between `pgvector` (stays in DB) vs. current `bytea` blob (load into app)
7. **Docker Compose update** — Add PostgreSQL service to `docker-compose.yml`; update `Dockerfile` if needed
8. **Environment variable change** — `DB_PATH` → `DATABASE_URL` connection string

### Estimated migration timeline

When triggered, expect:

| Phase                | Duration       | Scope                                                 |
| -------------------- | -------------- | ----------------------------------------------------- |
| Schema rewrite       | 2-3 days       | All 3 schema files + Drizzle config                   |
| Migration adaptation | 2-3 days       | 27 migrations → PG dialect (or 1 consolidated schema) |
| Raw SQL rewrites     | 1 day          | `memos.ts`, `snapshots.ts`, `authorized-groups.ts`    |
| FTS5 → tsvector      | 1-2 days       | Memo search index + query rewrite                     |
| Connection layer     | 1 day          | `db/index.ts`, `db/drizzle.ts`, env config            |
| Test adaptation      | 2-3 days       | All DB-dependent tests                                |
| Docker + deployment  | 1 day          | `docker-compose.yml`, `Dockerfile`                    |
| **Total**            | **10-14 days** |                                                       |
