# Behavior Audit Keyword Consolidation Design

Date: 2026-04-27
Status: Approved

## Problem

Phase 1 resolves keywords per-test against the existing vocabulary at the time of extraction. Over hundreds of tests, vocabulary drift accumulates: later tests may coin `task-create` when `create-task` already exists, or `admin-restriction` when `admin-revocation` was coined earlier. Because Phase 2 batches behaviors by primary keyword, fragmented synonyms split related behaviors into separate consolidation groups, degrading consolidation quality.

The current vocabulary contains ~2715 slugs for roughly one-third of all tests. At full scale (~3× more tests), projecting ~8000+ slugs is plausible. At that scale, Phase 2 keyword batching would fragment badly without a global normalization pass.

## Goals

1. Add a Phase 1b pipeline step that runs after Phase 1 and before Phase 2a.
2. Reduce vocabulary fragmentation by merging slug clusters using embedding-based cosine similarity.
3. Remap keywords in all extracted behavior records to use canonical slugs after merging.
4. Make the similarity threshold a tunable parameter so the user can find the right level of aggressiveness.
5. Support a dry-run mode that prints proposed merges without writing any files.
6. Track phase 1b status in `progress.json` (version bump to 5).
7. Automatically invalidate Phase 2 and Phase 3 when consolidation applies any merges.

## Non-Goals

1. Replacing the per-test vocabulary resolver in Phase 1. Phase 1b is a post-hoc global pass, not a replacement for incremental resolution.
2. Building an LLM-based semantic arbiter in this implementation. Embedding similarity is sufficient for finding near-duplicate slugs.
3. Backfilling embeddings for behaviors that were processed before Phase 1b existed.
4. Requiring a mandatory embedding model — Phase 1b soft-skips when `BEHAVIOR_AUDIT_EMBEDDING_MODEL` is not configured.
5. Changing the Phase 2 batching algorithm beyond what is needed to handle re-canonicalized keywords.

## Approach

Use embedding-based cosine similarity clustering:

1. Load the full keyword vocabulary.
2. Build an embedding input string per entry as `"${slug}: ${description}"`.
3. Call `embedMany()` in batches to get vector representations.
4. Apply union-find clustering: for every pair (i, j) where cosine similarity ≥ threshold, merge them into one cluster.
5. For each cluster of size > 1, elect a canonical slug (shortest slug, tie-break by earliest `createdAt`).
6. Build a merge map `{ old_slug → canonical_slug }`.
7. Write the updated vocabulary with merged entries removed and canonical entries updated.
8. Walk every extracted behavior file and remap each `keywords` array through the merge map, then deduplicate.
9. If any merges were applied, reset Phase 2a, 2b, and Phase 3.

The cosine similarity threshold is the primary tuning parameter. Dry-run mode (stage 7–9 skipped) enables parameter sweep without touching files.

## Phase Flow

```
Phase 1 (extract) → Phase 1b (keyword consolidation) → Phase 2a (classify) → Phase 2b (consolidate) → Phase 3 (evaluate)
```

Phase 1b is inserted between the existing phase 1 completion check and the phase 2a start. It reads `progress.phase1.status === 'done'` before running.

## Data Model

### Phase1bProgress

```ts
interface Phase1bProgress {
  status: PhaseStatus // 'not-started' | 'in-progress' | 'done'
  lastRunAt: string | null
  threshold: number
  stats: {
    slugsBefore: number
    slugsAfter: number
    mergesApplied: number
    behaviorsUpdated: number
    keywordsRemapped: number
  }
}
```

### Progress version bump

`Progress.version` increments from 4 to 5. `phase1b` is added as a top-level field alongside `phase1`, `phase2a`, `phase2b`, and `phase3`.

### Migration v4 → v5

Inject `phase1b: emptyPhase1b()` into any successfully parsed v4 progress. Do not reset any existing phase statuses during migration — only apply resets when phase 1b actually runs and applies merges.

## Configuration

New environment variables added to `config.ts`:

| Variable                                        | Default                           | Purpose                                                                                 |
| ----------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `BEHAVIOR_AUDIT_EMBEDDING_MODEL`                | `''`                              | Embedding model name. Required when phase 1b runs. If empty, phase 1b soft-skips.       |
| `BEHAVIOR_AUDIT_EMBEDDING_BASE_URL`             | same as `BEHAVIOR_AUDIT_BASE_URL` | Override base URL for the embedding provider. Defaults to the same base URL as the LLM. |
| `BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD`        | `0.92`                            | Cosine similarity merge threshold (0–1). Higher = more conservative merging.            |
| `BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE` | `2`                               | Minimum cluster size to trigger a merge. Must be ≥ 2.                                   |
| `BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN`          | `0`                               | Set to `1` to print proposed merges without applying them.                              |
| `BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE` | `100`                             | Slugs per `embedMany()` API call.                                                       |

## Canonical Election Rule

Within a merged cluster:

1. **Canonical slug**: shortest slug in the cluster. Tie-break: earliest `createdAt`.
2. **Description**: longest description among all merged entries (richest description wins).
3. **createdAt**: earliest timestamp across merged entries (preserves original introduction date).
4. **updatedAt**: timestamp of this consolidation run.

## Algorithm Detail

### Embedding

- Provider: same `createOpenAICompatible` used by other agents, with `BEHAVIOR_AUDIT_BASE_URL` and `BEHAVIOR_AUDIT_EMBEDDING_MODEL`.
- Call: `embedMany(model, values, { maxRetries: MAX_RETRIES })` from `ai` SDK.
- Batch size: configurable, default 100.
- Retry: use the same backoff pattern as other behavior-audit agents.

### Clustering (union-find)

```ts
// For each pair (i, j) where i < j:
//   if cosineSimilarity(embeddings[i], embeddings[j]) >= threshold
//     union(i, j)
//
// After processing all pairs:
//   find(i) returns the root/representative of i's cluster
```

Time complexity: O(n²) pairwise comparisons with early termination when n is small. At 2715 slugs, ~3.7M pairs — acceptable at local LLM latency since this is pure computation after embedding.

### Cosine similarity

```ts
const cosineSimilarity = (a: readonly number[], b: readonly number[]): number => {
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0)
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB)
}
```

## File Responsibilities

### New files

**`scripts/behavior-audit/consolidate-keywords.ts`**

- Phase 1b runner
- Orchestrates: load vocabulary → embed → cluster → apply merges → reset downstream phases
- Handles dry-run output
- Updates `phase1b` progress on completion

**`scripts/behavior-audit/consolidate-keywords-helpers.ts`**

- Pure functions only (no I/O, no LLM calls):
  - `cosineSimilarity(a, b)`
  - `buildUnionFind(n)` / `union(uf, i, j)` / `find(uf, i)`
  - `buildClusters(embeddings, threshold, minClusterSize)`
  - `electCanonical(cluster: KeywordVocabularyEntry[]): KeywordVocabularyEntry`
  - `buildMergeMap(vocabulary, clusters)`
  - `remapKeywords(keywords, mergeMap)`
  - `buildConsolidatedVocabulary(vocabulary, mergeMap, canonicalEntries)`

**`scripts/behavior-audit/consolidate-keywords-agent.ts`**

- `embedSlugBatch(slugInputs, model): Promise<number[][]>`
- Wraps `embedMany()` with retry and batching
- Uses `BEHAVIOR_AUDIT_BASE_URL` and `BEHAVIOR_AUDIT_EMBEDDING_MODEL`

### Modified files

**`scripts/behavior-audit/progress.ts`**

- Add `Phase1bProgress` interface
- Add `emptyPhase1b(): Phase1bProgress`
- Update `Progress` type: add `phase1b`, change `version` to 5
- Update `createEmptyProgress()` to include `phase1b`
- Add `resetPhase1bAndBelow(progress)` which resets `phase1b`, `phase2a`, `phase2b`, `phase3` — replaces the `resetPhase2AndPhase3` call in `extract.ts` so that Phase 1 changes also invalidate Phase 1b

**`scripts/behavior-audit/progress-migrate.ts`**

- Add v4→v5 migration: inject `phase1b: emptyPhase1b()` into a validated v4 object

**`scripts/behavior-audit/config.ts`**

- Add 5 new env vars with defaults
- Add them to `reloadBehaviorAuditConfig()`

**`scripts/behavior-audit/extracted-store.ts`**

- Add `remapKeywordsInExtractedFile(testFilePath, mergeMap)` helper:
  - Reads existing extracted file
  - Remaps each record's `keywords` array through `mergeMap`, deduplicates, preserves order
  - Writes back if any keyword changed
  - Returns `{ updated: boolean; remappedCount: number }`

**`scripts/behavior-audit.ts`** (main runner)

- Add `runPhase1bIfNeeded` to `BehaviorAuditDeps`
- Call it between `runPhase1IfNeeded` and `runPhase2aIfNeeded` in `runBehaviorAudit`

## Error Handling

| Condition                                   | Behavior                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `BEHAVIOR_AUDIT_EMBEDDING_MODEL` not set    | Log warning, mark phase 1b `'done'` with soft-skip stats (0 merges), continue to phase 2a |
| Embedding API call fails after retries      | Abort phase 1b; phase 2a is not started                                                   |
| Vocabulary write fails                      | Abort before touching any behavior files (fail-fast; vocabulary not corrupted)            |
| Individual behavior file remap fails        | Log error, continue to next file; count failures in stats                                 |
| No merges produced (all clusters size 1)    | Mark phase 1b `'done'`, log "no merges needed", continue to phase 2a without reset        |
| Phase 1 not done when phase 1b is requested | Skip phase 1b, return immediately                                                         |

## Incremental / Idempotency Behavior

- If `progress.phase1b.status === 'done'` and vocabulary has not been modified since the last run, phase 1b is skipped.
- Vocabulary modification is detected by comparing `slugsBefore` vs current vocabulary size. If they differ, phase 1b re-runs.
- Dry-run always runs regardless of status (does not write progress).

## Reporting and Observability

Phase 1b should log:

```
[Phase 1b] Embedding 2715 slugs in 28 batches...
[Phase 1b] Clustering at threshold 0.92...
[Phase 1b] Found 143 merge clusters (412 slugs → 143 canonicals; 269 slugs merged)
[Phase 1b] Updated 847 behavior files, remapped 3241 keyword occurrences
[Phase 1b complete] 2715 → 2446 slugs, 269 merges applied in 4.2s
```

In dry-run mode, print a human-readable merge table:

```
[Phase 1b DRY RUN] Proposed merges at threshold 0.92:
  admin-restriction         → admin-revocation
  context-authorization     → authorization-context
  bot-admin-check           → admin-detection
  ... (143 total)
No files were modified.
```

## Testing Strategy

### Unit tests (`tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`)

- `cosineSimilarity`: orthogonal vectors → 0, identical vectors → 1, known angle
- `buildClusters`: below threshold → no merge, above threshold → merge, transitivity through union-find
- `electCanonical`: shorter slug wins, tie-break by `createdAt`
- `buildMergeMap`: identity entries not included (slug maps to itself), merged entries present
- `remapKeywords`: known merge map applied, duplicate removal, ordering preserved
- `buildConsolidatedVocabulary`: merged entries removed, canonical entries have correct merged description and dates

### Integration tests (`tests/scripts/behavior-audit/consolidate-keywords.test.ts`)

- Dry-run: no vocabulary write, no behavior file write, progress unchanged
- Apply merges: vocabulary reduced, behavior files updated, phase 2/3 reset
- No embedding model configured: soft-skip, phase 1b marked done, no crash
- No merges at high threshold: phase 2/3 not reset, vocab unchanged
- Re-run when already done: idempotent skip
- Behavior file with only canonical keywords already: no change written

## Open Decisions for Implementation Planning

1. Whether the O(n²) pairwise computation should be bounded with an early-exit per row when a slug has already been assigned to a cluster (minor optimization, negligible at 2715 slugs).
2. Whether dry-run output should also be written to a file for easier inspection at large vocabulary sizes.
