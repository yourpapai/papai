# ADR-0099: Embedding Clustering — Linkage-Mode and Oversized-Cluster Improvements

## Status

Accepted (Supersedes ADR-0085 — embedding cache and clustering optimization)

## Context

ADR-0085 introduced pre-normalized embeddings and a fast `dotProduct`-based clustering path, dramatically improving execution time. However, the single-linkage Union-Find algorithm it relied on remained susceptible to **transitive chaining** — one high-similarity pair could pull in dissimilar keywords through intermediate links, producing giant clusters that degraded consolidation quality. Testing different thresholds was still difficult because the cluster-size distribution was unstable.

We needed a way to:

1. Prevent giant clusters from forming in the first place.
2. Allow tuning via different linkage strategies (`single`, `average`, `complete`) instead of being locked into single-linkage.
3. Prevent borderline merges that happen only because a candidate similarity barely exceeds the threshold with no clear gap over alternatives.

## Decision Drivers

- **Cluster quality**: Giant clusters reduce the semantic precision of keyword consolidation.
- **Tunability**: Users need to experiment with linkage modes interactively.
- **Stability**: Threshold tuning should produce monotonically predictable cluster-size distributions.
- **Backwards compatibility**: Existing single-linkage behavior must remain available as a default-safe path.

## Considered Options

### Option 1: Post-hoc split (heuristic)

- **Pros**: Simple to bolt onto existing single-linkage output.
- **Cons**: Splits are unprincipled; cluster coherence is not guaranteed after splitting.

### Option 2: Replace single-linkage with nearest-neighbor-chain agglomerative clustering supporting configurable linkage

- **Pros**:
  - `average` and `complete` linkage naturally prevent transitive chaining.
  - `maxClusterSize` can trigger iterative re-clustering at progressively higher thresholds within oversized clusters.
  - `gapThreshold` merges only when the best similarity exceeds the next-best alternative by a configurable margin.
  - The nearest-neighbor-chain algorithm runs in O(n²) for average/complete instead of the naive O(n³).
- **Cons**:
  - More code surface (condensed distance matrix, Lance-Williams update formulas, chain extension/merge logic).
  - `average` linkage on 600+ vectors is still not interactive; a profiling path was added to expose performance characteristics.

### Option 3: Keep single-linkage, only add gap threshold

- **Pros**: Minimal change.
- **Cons**: Does not solve the giant-cluster problem; only blocks some borderline merges.

## Decision

We will implement **Option 2**.

Specifically:

1. Introduce `LinkageMode = 'single' | 'average' | 'complete'`.
2. Implement `buildClustersAdvanced` that delegates to:
   - Union-Find + sorted candidate pairs for `single` (matching prior behavior).
   - Nearest-neighbor-chain agglomerative clustering with condensed distance matrix and Lance-Williams distance updates for `average` and `complete`.
3. Add `gapThreshold` parameter: for `single`, reject a merge if the gap to either element's next-best alternative is too small; for `average`/`complete`, reject if the gap to the next-best merge candidate is too small.
4. Add `subdivideOversizedClusters`: when a cluster exceeds `maxClusterSize`, re-cluster its members at a threshold one step above the weakest internal similarity, recursively until all clusters are within size or no further split is possible.
5. Expose `--linkage`, `--max-cluster-size`, and `--gap-threshold` CLI flags in `tune-embedding.ts`.
6. Wire `CONSOLIDATION_LINKAGE`, `CONSOLIDATION_MAX_CLUSTER_SIZE`, and `CONSOLIDATION_GAP_THRESHOLD` as environment-overridable config values in `config.ts`.

## Rationale

Option 2 addresses the root cause (linkage strategy) rather than post-processing symptoms. The nearest-neighbor-chain approach is provably equivalent to naive agglomerative clustering for the linkage criteria we support, and the condensed distance matrix reduces memory from O(n²) full matrix to O(n²/2) — a meaningful win for larger vocabularies.

The `gapThreshold` concept is a principled way to express "confidence in merge" and works uniformly across all three linkage modes.

## Consequences

### Positive

- `complete` linkage (the new default) produces smaller, tighter clusters than single-linkage at the same threshold.
- `maxClusterSize` eliminates runaway giant clusters in practice.
- `gapThreshold` prevents ambiguous merges where a keyword is equally similar to two different clusters.
- The `tune-embedding.ts` CLI now supports full-parameter sweep experiments.
- Existing behavior is preserved when all new parameters remain at their defaults (`single`, `maxClusterSize=0`, `gapThreshold=0`).

### Negative

- The clustering codebase is now split across three modules (`consolidate-keywords-clustering.ts`, `consolidate-keywords-advanced-clustering.ts`, `consolidate-keywords-agglomerative-helpers.ts`) plus a profiling module, increasing cognitive load for maintainers.
- `average` linkage is still O(n²) per merge with an active-list scan; while NNC reduces the coefficient, very large vocabularies (thousands of slugs) still take several seconds. The profiling flag helps diagnose this.

### Risks

- **Default linkage change risk**: The default shifted from `single` to `complete`. Existing automated pipelines that relied on single-linkage transitive chaining may see different merge maps. Mitigation: the config is overridable via `BEHAVIOR_AUDIT_CONSOLIDATION_LINKAGE=single`.
- **Agglomerative clustering correctness risk**: The Lance-Williams updates must exactly match the naive pairwise formulas. Mitigation: comprehensive tests compare the NNC implementation against naive reference implementations for both `average` and `complete` linkage on deterministic fixtures.

## Implementation Notes

### File Structure

| File                                                                   | Responsibility                                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/consolidate-keywords-clustering.ts`            | `LinkageMode` type, `buildClustersNormalized` (Union-Find single-linkage), `dotProduct`, `toNormalizedFloat64Arrays`                    |
| `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`   | `buildClustersAdvanced` (entry point with profiling support), `subdivideOversizedClusters` (iterative re-clustering)                    |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts` | Condensed distance matrix, active-state management, nearest-neighbor-chain primitives, Lance-Williams distance updates, gap-check logic |
| `scripts/behavior-audit/clustering-profile.ts`                         | Profiling object creation, timing/counter recording, formatted output                                                                   |
| `scripts/behavior-audit/tune-embedding-args.ts`                        | CLI argument parsing for `--linkage`, `--max-cluster-size`, `--gap-threshold`, `--profile-clustering`, `--profile-sizes`                |
| `scripts/behavior-audit/tune-embedding.ts`                             | Orchestration: collect keywords, embed/cache, cluster, subdivide, merge, print summary                                                  |
| `scripts/behavior-audit/consolidate-keywords.ts`                       | Production Phase 1b pipeline using config-driven clustering parameters                                                                  |
| `scripts/behavior-audit/config.ts`                                     | `CONSOLIDATION_LINKAGE`, `CONSOLIDATION_MAX_CLUSTER_SIZE`, `CONSOLIDATION_GAP_THRESHOLD` env overrides                                  |

### Key Algorithms

- **Nearest-neighbor chain**: Builds a chain of mutual nearest-neighbor relationships; when a pair of reciprocal nearest neighbors is found and passes the gap check, they are merged. This replaces the O(n³) all-pairs scan with an O(n²) chain walk.
- **Lance-Williams updates**:
  - `average`: weighted average of distances to the merged clusters.
  - `complete`: maximum of distances to the merged clusters.
- **Subdivision**: Finds weakest internal similarity within an oversized cluster, then re-clusters with `threshold = weakest_sim + step`, repeating recursively. This guarantees the weakest link is broken first.

### Divergences from the Original Plan

The original plan (`docs/superpowers/plans/2026-04-29-embedding-clustering-improvements.md`) described a naive O(n³) agglomerative implementation for `average`/`complete` linkage with pairwise nested loops. The actual implementation uses the nearest-neighbor-chain algorithm with a condensed distance matrix, which is algorithmically superior while producing identical cluster results. The subdivision logic also differs: instead of re-clustering all oversized clusters simultaneously in a loop, the implemented `reclusterOversizedCluster` is recursive per-cluster and uses `buildClustersAdvanced` directly on sub-embeddings.

## Related Decisions

- ADR-0085: Embedding Cache and Clustering Optimization — superseded; the fast pre-normalized dot-product path and embedding cache remain in use.
- ADR-0077: Behavior Audit — Test-Driven UX Evaluation — the consolidation pipeline this ADR improves is part of the behavior audit system.

## References

- Murtagh, F. (1985). "Multidimensional Clustering Algorithms". COMPSTAT Lectures 4, Physica-Verlag, Vienna.
- Plan: `docs/superpowers/plans/2026-04-29-embedding-clustering-improvements.md` (archived)
- Tests: `tests/scripts/behavior-audit/consolidate-keywords-advanced-clustering.test.ts`, `tests/scripts/behavior-audit/tune-embedding.test.ts`, `tests/scripts/behavior-audit/clustering-profile.test.ts`
