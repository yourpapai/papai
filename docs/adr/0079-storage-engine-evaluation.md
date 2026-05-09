# ADR-0079: Storage Engine Evaluation — SQLite vs PostgreSQL vs Non-SQL

## Status

Accepted (deferred action) — SQLite remains the storage engine. PostgreSQL migration triggers are documented for future re-evaluation.

## Date

2026-04-26

## Context

papai uses `bun:sqlite` with Drizzle ORM as its sole persistence layer. The project has grown to 27 migrations, ~20 tables, and 30+ modules accessing the database. We evaluated whether a storage engine migration (to PostgreSQL, TimescaleDB, or non-SQL alternatives) would benefit the project now or in the foreseeable future.

Full research findings are in `docs/research/storage-engine-evaluation.md`.

## Decision Drivers

- papai is a single-instance chatbot — no horizontal scaling requirement
- Schema includes relational foreign keys, full-text search (FTS5), and in-app vector similarity
- Deployment is a single Docker container with a volume-mounted `.db` file
- 30+ modules use Drizzle ORM; 3 modules use raw SQL escape hatches

## Options Considered

### SQL engines

1. **SQLite (current)** — `bun:sqlite` + Drizzle ORM, WAL mode
2. **PostgreSQL** — Full relational DB with tsvector, pgvector, jsonb
3. **TimescaleDB** — PostgreSQL + automatic time-partitioning
4. **Turso / libSQL** — Distributed SQLite with HTTP-based access

### Non-SQL / exotic stores

5. **Redis / Valkey / Dragonfly** — In-memory KV with TTL
6. **MongoDB** — Document store with Atlas Search
7. **FoundationDB** — Distributed ordered KV with ACID
8. **CouchDB / PouchDB** — Eventual-consistency document store
9. **Datomic / XTDB** — Immutable bitemporal fact store
10. **LMDB / LevelDB / RocksDB** — Embedded ordered KV
11. **Qdrant / Milvus / ChromaDB** — Vector databases
12. **EdgeDB** — Graph-relational on PostgreSQL
13. **SurrealDB** — Multi-model (document + graph + KV)

## Decision

**Stay on SQLite.** No alternative provides net improvement for papai's combination of data patterns at current scale.

### Key reasons

1. **Single-instance deployment** — SQLite's single-writer limitation is irrelevant
2. **Relational data is core** — Disqualifies pure KV/document stores (Redis, MongoDB, LMDB)
3. **FTS5 handles memo search** — tsvector is better but FTS5 is sufficient at current volume
4. **In-app cosine similarity is fast** — Vector DBs only worthwhile at 100K+ vectors
5. **Zero operational overhead** — One container, one file, trivial backup
6. **High migration cost** — 27 migrations + 3 raw-SQL escape hatches + schema rewrite = ~10-14 days for no user-facing benefit

### Why not each alternative

| Alternative                | Rejection reason                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| PostgreSQL                 | Correct eventual choice but premature — no current pain point justifies 10-14 day migration |
| TimescaleDB                | Only 2-3 tables have time-series characteristics; negligible benefit                        |
| Turso / libSQL             | Adds latency and service dependency for no single-instance benefit                          |
| Redis                      | Cannot replace core entity store (no FTS, no relations); supplementary only                 |
| MongoDB                    | Loses relational integrity; FTS weaker than FTS5 without Atlas                              |
| FoundationDB               | No FTS, no vector; overkill for single-instance                                             |
| CouchDB / PouchDB          | Offline-first sync not needed; eventual consistency wrong for scheduling                    |
| XTDB / Datomic             | No Bun/TS-native client; massive infrastructure overhead                                    |
| LMDB / LevelDB / RocksDB   | Would reimplement SQL engine features from scratch                                          |
| Qdrant / Milvus / ChromaDB | In-app cosine is sub-ms at current scale                                                    |
| EdgeDB                     | Drizzle doesn't support it; must rewrite entire data layer in EdgeQL                        |
| SurrealDB                  | Immature tooling; Drizzle doesn't support it; production risk                               |

## PostgreSQL Migration Triggers

The following concrete conditions should trigger re-evaluation. Any single trigger is sufficient.

### T1: Multi-instance deployment

Need to run 2+ papai processes serving the same user base. SQLite single-writer serializes writes across processes.

### T2: Vector search at scale

Single user with >5,000 memos, or cross-user semantic search needed. In-app cosine becomes slow and memory-intensive. pgvector provides indexed ANN search.

### T3: FTS quality limits

FTS5 tokenization or ranking insufficient — need stemming, language-aware tokenization, typo tolerance, or phrase proximity ranking. PostgreSQL tsvector + pg_trgm addresses these.

### T4: JSONB query requirements

Need indexed queries on structured JSON inside text columns (memo tags, prompt metadata) beyond simple `json_each` extraction. PostgreSQL jsonb with GIN indexes supports arbitrary path queries.

### T5: Concurrent write contention

Write latency spikes or `SQLITE_BUSY` errors under sustained load from overlapping scheduler, poller, persistence, and cache writes.

### T6: LISTEN/NOTIFY for coordination

Real-time cross-process event notification needed (e.g., one instance notifies another of a fired task).

### T7: Operational requirements

Point-in-time recovery, replication, streaming backups, or managed database service required.

### T8: Schema complexity growth

Table count exceeds ~40 or complex multi-table joins become common. PostgreSQL's query planner handles complexity better.

### Anti-triggers (not sufficient alone)

- "SQLite is not a real database" — WAL mode is production-grade
- "We might scale someday" — premature optimization
- "PostgreSQL is more standard" — not relevant for single-instance
- "JSONB is nicer" — nice-to-have, not a trigger

## Consequences

### Positive

- No migration effort needed now
- Single-binary deployment preserved
- Backup remains a file copy
- No new operational dependencies

### Negative

- If a trigger fires, migration will touch ~15-25 files across 10-14 days
- The 3 raw-SQL escape hatches (`$client` access) deepen SQLite coupling over time
- Any future migration must handle FTS5 → tsvector as a non-trivial subtask

### Mitigation

When approaching a trigger, first reduce SQLite-specific surface area:

1. Replace `$client` raw SQL with Drizzle queries where possible
2. Abstract DB access behind a provider interface (matching existing chat/task provider patterns)
3. Keep raw SQL confined to isolated modules to limit migration blast radius

## References

- Full research: `docs/research/storage-engine-evaluation.md`
- Drizzle ORM adoption: `docs/adr/0010-drizzle-orm-migration.md`
- Current schema: `src/db/schema.ts`, `src/db/deferred-schema.ts`, `src/db/web-schema.ts`
- Docker deployment: `docker-compose.yml`, `Dockerfile`
