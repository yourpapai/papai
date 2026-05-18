# ADR-0103: Behavior Audit Keyword Consolidation — Embedding-Based Vocabulary Deduplication

## Status

Accepted

## Date

2026-04-27

## Context

Phase 1 of the behavior-audit pipeline resolves keywords per-test against the existing vocabulary at the time of extraction. Over hundreds of tests, vocabulary drift accumulates: later tests may coin `task-create` when `create-task` already exists, or `admin-restriction` when `admin-revocation` was coined earlier. Because Phase 2 batches behaviors by primary keyword, fragmented synonyms split related behaviors into separate consolidation groups, degrading consolidation quality.

The vocabulary at the time of this decision contained ~2715 slugs for roughly one-third of all tests. At full scale (~3× more tests), projecting ~8000+ slugs was plausible. Without a global normalization pass, Phase 2 keyword batching would fragment badly.

Two predecessor documents defined the desired outcome:

- **Spec** (`2026-04-27-behavior-audit-keyword-consolidation-design.md`) — defined the problem, goals, non-goals, approach, data model, config, canonical election rules, error handling, and idempotency behavior.
- **Implementation Plan** (`2026-04-27-behavior-audit-keyword-consolidation.md`) — defined the file-level changes, 8 tasks, and step-by-step implementation with TDD ordering.

The work was implemented between 2026-04-27 and 2026-05-17.

## Decision Drivers

1. **Vocabulary fragmentation degrades Phase 2 consolidation** — synonym slugs split related behaviors into separate batches.
2. **Post-hoc normalization is preferred** — Phase 1's per-test resolver cannot see the global vocabulary; a global pass after Phase 1 is the cleanest fix.
3. **Embedding similarity is sufficient** — LLM-based semantic arbitration is overkill; cosine similarity on embedding vectors finds near-duplicate slugs accurately.
4. **Configurability matters** — the similarity threshold must be tunable per project / per embedding model.
5. **Dry-run safety** — users need to preview merges before committing to them.
6. **Downstream invalidation is mandatory** — when merges are applied, Phase 2 and Phase 3 results become stale and must be recomputed.

## Considered Options

### Option 1: Replace Phase 1's per-test vocabulary resolver with a global LLM arbiter (rejected)

- **Pros**: Single-pass resolution; no downstream invalidation needed.
- **Cons**: Dramatically increases Phase 1 cost (every test requires a global vocabulary lookup); couples Phase 1 to embedding infrastructure; fundamentally changes the incremental extraction model.
- **Verdict**: Rejected. Violates the non-goal of replacing Phase 1's resolver.

### Option 2: Post-hoc embedding-based clustering with union-find (chosen)

- **Pros**: Clean separation of concerns; Phase 1 remains unchanged; deterministic; configurable threshold; dry-run support; pure computation after embedding.
- **Cons**: O(n²) pairwise comparisons after embedding; requires a separate embedding model configuration; adds a new pipeline phase (1b) between Phase 1 and Phase 2a.
- **Verdict**: Accepted.

### Option 3: Post-hoc string-similarity clustering (rejected)

- **Pros**: No embedding model required; fast.
- **Cons**: Slug strings are short and often share substrings without semantic overlap (e.g., `task-create` vs `task-cancel`); description text is ignored.
- **Verdict**: Rejected. Embedding similarity leverages both slug and description semantics.

## Decision

Add a **Phase 1b pipeline step** between Phase 1 (extract) and Phase 2a (classify). Phase 1b:

1. Loads the full keyword vocabulary.
2. Builds embedding input strings as `"${slug}: ${description}"`.
3. Calls `embedMany()` in batches to get vector representations.
4. Applies union-find clustering: for every pair (i, j) where cosine similarity ≥ `CONSOLIDATION_THRESHOLD`, merge them into one cluster.
5. For each cluster of size > `CONSOLIDATION_MIN_CLUSTER_SIZE`, elect a canonical slug (shortest slug, tie-break by earliest `createdAt`).
6. Builds a merge map `{ old_slug → canonical_slug }`.
7. Writes the updated vocabulary with merged entries removed and canonical entries updated.
8. Walks every extracted behavior file and remaps each `keywords` array through the merge map, deduplicating.
9. If any merges were applied, resets Phase 2a, 2b, and Phase 3 progress.

The implementation is **soft-skip capable** — if `BEHAVIOR_AUDIT_EMBEDDING_MODEL` is empty, Phase 1b marks itself `done` with zero merges and continues.

## Rationale

- **Separation of concerns**: Phase 1 remains focused on per-test extraction. Phase 1b is a pure data-normalization pass that operates on the aggregate output.
- **Embedding quality**: Local LLM embedding models (e.g., Qwen3-Embedding-8B) produce high-quality semantic representations for short technical phrases, making cosine similarity reliable for this domain.
- **Union-find correctness**: The transitive closure property of union-find correctly captures chains of similarity (a ~ b and b ~ c → a ~ c), which is desirable for keyword consolidation.
- **Config-driven tuning**: The threshold, min cluster size, and batch size are all environment-overridable, enabling per-deployment tuning without code changes.
- **Idempotency**: By comparing stored `slugsBefore` against current vocabulary size (and later, clustering settings), Phase 1b skips redundant work.

## Implementation Notes

### New files

| File                                                                   | Purpose                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/consolidate-keywords.ts`                       | Phase 1b runner: orchestrates load → embed → cluster → apply merges → reset downstream phases                 |
| `scripts/behavior-audit/consolidate-keywords-helpers.ts`               | Pure functions: `electCanonical`, `buildMergeMap`, `remapKeywords`, `buildConsolidatedVocabulary`             |
| `scripts/behavior-audit/consolidate-keywords-agent.ts`                 | `embedSlugBatch`: wraps `embedMany()` with retry, batching, and `createOpenAICompatible` provider setup       |
| `scripts/behavior-audit/consolidate-keywords-clustering.ts`            | Core clustering: `buildClustersNormalized`, `toNormalizedFloat64Arrays`, `dotProduct`, `LinkageMode`          |
| `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`   | Extended clustering: `buildClustersAdvanced` with multiple linkage modes, `subdivideOversizedClusters`        |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts` | Agglomerative clustering primitives: condensed distance matrix, Lance-Williams updates, gap checks            |
| `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`    | Unit tests for pure helper functions                                                                          |
| `tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts`      | Unit tests for `embedSlugBatch` batching and retry                                                            |
| `tests/scripts/behavior-audit/extracted-store-remap.test.ts`           | Unit tests for `remapKeywordsInExtractedFile`                                                                 |
| `tests/scripts/behavior-audit/consolidate-keywords.test.ts`            | Integration tests for `runPhase1b` embedding cache identity                                                   |
| `tests/scripts/behavior-audit-phase1b.test.ts`                         | Integration tests for `runPhase1b`: skip, soft-skip, merges, dry-run, idempotency, config change invalidation |
| `tests/scripts/behavior-audit/progress.test.ts`                        | Unit tests for `emptyPhase1b`, `createEmptyProgress` v5, `resetPhase1bAndBelow`                               |
| `tests/scripts/behavior-audit/progress-migrate.test.ts`                | Unit tests for v4→v5 migration and legacy v5 backfill                                                         |

### Modified files

| File                                                          | Change                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/progress.ts`                          | Added `Phase1bProgress` interface; `version` bumped to `5`; added `emptyPhase1b`; `createEmptyProgress` includes `phase1b`                                                                                                                                                  |
| `scripts/behavior-audit/progress-migrate.ts`                  | Added `ProgressV5Schema`, `LegacyProgressV5Schema`; `validateOrMigrateProgress` supports v4→v5 injection and legacy v5 backfill                                                                                                                                             |
| `scripts/behavior-audit/progress-resets.ts`                   | Added `resetPhase1bAndBelow` (resets phase1b + phase2a + phase2b + phase3)                                                                                                                                                                                                  |
| `scripts/behavior-audit/config.ts`                            | Added 9 env vars: `EMBEDDING_MODEL`, `EMBEDDING_BASE_URL`, `CONSOLIDATION_THRESHOLD`, `CONSOLIDATION_MIN_CLUSTER_SIZE`, `CONSOLIDATION_DRY_RUN`, `CONSOLIDATION_EMBED_BATCH_SIZE`, `CONSOLIDATION_LINKAGE`, `CONSOLIDATION_MAX_CLUSTER_SIZE`, `CONSOLIDATION_GAP_THRESHOLD` |
| `scripts/behavior-audit/extracted-store.ts`                   | Added `remapKeywordsInExtractedFile`: reads extracted file, remaps keywords, writes back if changed                                                                                                                                                                         |
| `scripts/behavior-audit/extract.ts`                           | `Phase1Deps` uses `resetPhase1bAndBelow` instead of `resetPhase2AndPhase3`; invalidates Phase 1b on re-extract                                                                                                                                                              |
| `scripts/behavior-audit/index.ts`                             | Added `runPhase1bIfNeeded` to `BehaviorAuditDeps`; wired between `runPhase1IfNeeded` and `runPhase2aIfNeeded`                                                                                                                                                               |
| `tests/scripts/behavior-audit-integration.helpers.ts`         | Added clustering config fields to `BehaviorAuditTestConfig`/`DEFAULT_CONFIG`; updated `createEmptyProgressFixture` for v5                                                                                                                                                   |
| `tests/scripts/behavior-audit-integration.runtime-helpers.ts` | Added env keys, clear cases, and apply lines for all new config values                                                                                                                                                                                                      |
| `tests/scripts/behavior-audit-integration.support.ts`         | Added `ConsolidateKeywordsModuleShape`, `isConsolidateKeywordsModule`, `loadConsolidateKeywordsModule`                                                                                                                                                                      |
| `tests/scripts/behavior-audit/entrypoint.test.ts`             | Updated mock deps to include `runPhase1bIfNeeded`                                                                                                                                                                                                                           |
| `tests/scripts/behavior-audit-config.test.ts`                 | Added tests for new config defaults and override behavior                                                                                                                                                                                                                   |

### Divergences from the original plan

The implementation is **superset-compliant** — every requirement from the spec is present, with the following additions:

1. **Embedding cache** (`embedding-cache.ts`) — avoid re-embedding unchanged vocabularies between runs. Not mentioned in the original spec.
2. **Additional clustering settings** — `CONSOLIDATION_LINKAGE` (single/average/complete, default complete), `CONSOLIDATION_MAX_CLUSTER_SIZE` (triggers iterative re-clustering within oversized clusters), `CONSOLIDATION_GAP_THRESHOLD` (rejects borderline merges). Added in follow-up ADR-0099.
3. **Legacy v5 backfill** — `LegacyProgressV5Schema` handles older v5 progress files created mid-migration before the clustering fields were added.
4. **Config-change invalidation** — `shouldSkipCompletedPhase1b` checks not only vocab size but also clustering settings, embedding model, base URL, and cache path. Added in follow-up commits to prevent stale results when parameters change.
5. **Nearest-neighbor-chain agglomerative clustering** — for `average` and `complete` linkage, the implementation uses the NNC algorithm (O(n²)) instead of naive O(n³). Described in ADR-0099; the clustering modules were added after the initial Phase 1b implementation.

## Consequences

### Positive

- Vocabulary fragmentation reduced: synonym slugs merge into canonical representatives, improving Phase 2 batching quality.
- Configurable aggressiveness: threshold, min cluster size, linkage mode, and gap threshold can be tuned per deployment.
- Dry-run safety: `BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN=1` prints proposed merges without writing files.
- Soft-skip when unconfigured: no hard dependency on embedding infrastructure; Phase 1b gracefully degrades.
- Idempotent: redundant runs are skipped when vocabulary size and settings are unchanged.
- Incremental invalidation: Phase 1 re-extraction resets Phase 1b automatically via `resetPhase1bAndBelow`.
- Pure helper functions are fully unit-testable without LLM infrastructure.

### Negative

- O(n²) pairwise computation after embedding is CPU-bound; at ~8000 slugs, ~32M pair comparisons. Mitigation: pre-normalized `Float64Array` dot products and the fast path in `consolidate-keywords-clustering.ts`.
- Additional config surface: 9 new environment variables increase operational complexity.
- Embedding model must be local-LLM-compatible (OpenAI-compatible API). Cloud embedding services require `OPENAI_API_KEY`.
- The initial implementation's `embedSlugBatch` does not directly cache embeddings; caching is handled at the `runPhase1b` level via `getOrEmbed`, which adds a layer of indirection.

### Risks

- **Transitive chaining in single-linkage**: Union-find can produce giant clusters through intermediate similarities. Mitigation: `complete` linkage is now the default; `maxClusterSize` subdivides oversized clusters; `gapThreshold` rejects borderline merges.
- **Embedding model drift**: Changing the embedding model changes similarity scores. Mitigation: `shouldSkipCompletedPhase1b` compares `embeddingModel`, `embeddingBaseUrl`, and `embeddingCachePath`; any change triggers re-run.
- **Vocabulary write failure before behavior remap**: The implementation writes vocabulary first, then remaps behavior files. A crash between these steps could leave behavior files referencing merged slugs that no longer exist in the vocabulary. Mitigation: vocabulary write is atomic (Bun.write); behavior remap failures are logged but do not crash the pipeline.

## Related Decisions

- **ADR-0077** — Behavior Audit Test-Driven UX Evaluation: established the behavior-audit architecture into which Phase 1b was inserted.
- **ADR-0073** — Behavior Audit Incremental Runs: established the incremental selection and checkpoint system that Phase 1b participates in.
- **ADR-0085** — Embedding Cache and Clustering Optimization: superseded by ADR-0099; introduced pre-normalized embeddings and fast dot-product clustering that Phase 1b leverages.
- **ADR-0099** — Embedding Clustering — Linkage-Mode and Oversized-Cluster Improvements: extended the initial single-linkage clustering with `average`/`complete` linkage, `maxClusterSize`, and `gapThreshold`.
- **ADR-0102** — Behavior Audit Progress Reporting: the progress reporter was retrofitted into Phase 1b after this ADR's work.

## References

- Original spec (archived): `docs/archive/2026-04-27-behavior-audit-keyword-consolidation-design.md`
- Implementation plan (archived): `docs/archive/2026-04-27-behavior-audit-keyword-consolidation.md`
- Divergence notes: none written (this ADR captures divergences inline)
- Test results at implementation: 64 pass / 0 fail across target test files; `bun typecheck`: clean
