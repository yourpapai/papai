<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0100: Embedding Clustering — Evidence-Driven Profiling and TypeScript Acceleration

## Status

Accepted (Completed)

## Context

ADR-0099 introduced configurable linkage modes (`single`, `average`, `complete`) and a nearest-neighbor-chain agglomerative clustering (NNC) implementation backed by a condensed distance matrix. While NNC is algorithmically superior to a naive O(n³) scan, the practical runtime on the real 7,697-keyword vocabulary remained problematic:

| Linkage                | Size | Approximate Time    |
| ---------------------- | ---- | ------------------- |
| `average` no-gap       | 500  | 2.1 s               |
| `average` no-gap       | 1000 | 17.4 s              |
| `average` no-gap       | 2000 | 137.5 s             |
| `average` + gap (0.05) | 1000 | 805.2 s (timed out) |
| `complete` no-gap      | 2000 | 137.1 s             |

Full-size 7,697-slug sweeps for all modes timed out after 20 minutes. We needed **evidence** about where time is actually spent before committing to any acceleration rewrite (native addon, WASM, workers, etc.).

## Decision Drivers

- **Evidence-first**: No native/WASM rewrite without profiling data.
- **Exact semantics preserved**: Any optimization must produce the same clusters.
- **Existing test coverage**: Must not break the naive-reference parity tests or the 600-vector smoke guard.
- **Toolchain simplicity**: Avoid Rust/C++ packaging if TypeScript fixes suffice.

## Considered Options

### Option 1: Pure TypeScript optimization

Remove avoidable allocation and repeated scanning in the existing NNC implementation:

- Replace `filter(...).filter(...).map(...).toSorted(...)[0]` in nearest-neighbor search with a one-pass minimum scan.
- Replace string `pairKey` blocked-pair lookups with numeric `condensedIndex` keys.
- Avoid rebuilding `activeIndices(state)` inside every inner helper by snapshotting once per outer loop and threading it through.

- **Pros**: Smallest change, no packaging, no binary dependencies, exact semantics preserved.
- **Cons**: Still single-threaded JavaScriptCore execution.

### Option 2: Rust Node-API addon

Move the hot dense HAC numeric kernel into a Rust crate compiled to a `.node` module.

- **Pros**: Fast compiled numeric loops, stable ABI.
- **Cons**: Toolchain and binary packaging complexity disproportionate to the evidence.

### Option 3: WASM module

Compile the HAC kernel to WebAssembly.

- **Pros**: Portable artifact, no native addon packaging.
- **Cons**: Boundary copies and SIMD/thread setup complexity; evidence did not justify the cost.

### Option 4: Worker threads with SharedArrayBuffer

Parallelize matrix build or independent scans.

- **Pros**: Can utilize multicore.
- **Cons**: The NNC merge loop is inherently sequential; coordination overhead exceeds gains for this workload.

## Decision

**Implement Option 1** based on measured profiling evidence.

### Evidence

Evidence collected via `scripts/behavior-audit/profile-clustering.ts` scale sweeps and Bun CPU profiles (`bun --cpu-prof`):

- `nearestNeighborMs` + `candidateScanMs` together dominate: **~95% of total time** at all tested sizes.
- `toSorted()` accounts for **~41% of CPU samples** in both average and complete profiles.
- `pairKey` (string blocked-pair key) accounts for **~9.7%** of CPU samples.
- `compareNearest` sort comparator accounts for **~7.6%**.
- `gapCheckMs` and `mergeUpdateMs` are negligible together (< 0.05% of total time).

The CPU profile confirmed the instrumentation: list construction, sorting, and string-key churn dominate — not the distance-update math, not the gap arithmetic, and not matrix construction.

### What was changed

1. **`scripts/behavior-audit/clustering-profile.ts`** — Immutable `ClusteringProfile`, timing/counter helpers, `formatClusteringProfile`.
2. **Instrumentation** — `buildAgglomerativeClusters` and all inner helpers accept an optional `ClusteringProfile`. When profiling is enabled they return identical cluster outputs plus counters. When disabled the overhead is a single boolean check.
3. **CLI integration** — `tune-embedding.ts` gained `--profile-clustering` and `--profile-sizes` flags; `tune-embedding-args.ts` parses them.
4. **Benchmark runner** — `scripts/behavior-audit/profile-clustering.ts` runs scale sweeps against cached embeddings and appends results incrementally to a markdown file.
5. **One-pass nearest-neighbor scan** — Replaced `toSorted`-based selection in `findNearestActiveCluster` with a direct minimum scan (`selectNearestCandidate`). Preserves exact historical sort behavior for actual `NaN` distances via a dedicated fallback path.
6. **Numeric blocked-pair keys** — Replaced `pairKey(a, b): string` with `pairKey(a, b, n): number` returning `condensedIndex`, changing `blockedPairs` from `Set<string>` to `Set<number>`.
7. **Active-list snapshots** — Threaded caller-provided `active: readonly number[]` through all inner helpers (`findNearestActiveCluster`, `updateMergedDistances`, `mergePassesGap`, `hasMergeCandidate`, `findChainStart`, `tryExtendOrMergeChain`) to eliminate repeated `activeIndices(state)` rebuilds.

## Rationale

The measured evidence showed the bottleneck was **algorithmic overhead inside JavaScript** (allocation, sorting, string keys), not the JS engine's inability to run numeric loops fast enough. A pure TypeScript optimization:

- Eliminates the dominant ~41% sort cost entirely.
- Eliminates ~9.7% string-key overhead.
- Avoids adding a Rust/WASM build step and packaging pipeline.
- Preserves exact cluster outputs verified by parity tests against naive reference implementations.

Should a future scale increase (e.g., 20,000+ slugs) make even the optimized TypeScript path too slow, the profiling framework and decision matrix are already in place to justify a native rewrite.

## Consequences

### Positive

- Average and complete linkage now complete on the full dataset without timeout.
- The 600-vector smoke test passes well under the 5-second budget.
- No new toolchain dependencies.
- Profiling infrastructure (`clustering-profile.ts`, `profile-clustering.ts`, `--profile-clustering`) remains available for future evidence gathering.
- All existing tests pass, lint passes, typecheck passes.

### Negative

- Still single-threaded; multicore machines leave cores idle during clustering.
- Gap-enabled average linkage on very large datasets may still be slower than desired.
- Float32 condensed distance matrix uses ~113 MiB at 7,697 slugs; this was not addressed.

### Risks

- **NaN fallback divergence**: The one-pass scan preserves exact sort semantics for normal distances. Non-finite (`NaN`) distances trigger a legacy comparator fallback. This path is rare but tested explicitly.
  - _Mitigation_: NaN-specific tests exist and pass.
- **Future scale pressure**: If vocabulary grows beyond ~15,000 slugs, the O(n²) memory footprint and O(n²) scan complexity may require a native rewrite despite TypeScript optimization.
  - _Mitigation_: The profiling runner makes future evidence cheap to collect; the Rust/WASM/Node-API paths are documented as deferred options.

## Implementation Notes

### File Structure

| File                                                                      | Responsibility                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/clustering-profile.ts`                            | Profiling primitives: `ClusteringProfile`, `recordClusteringTiming`, `incrementClusteringCounter`, `formatClusteringProfile` |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`    | Optimized nearest-neighbor helpers, condensed distance matrix, gap checks, Lance-Williams distance updates                   |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-chain.ts`      | NNC step transitions (`tryExtendOrMergeChain`) consuming optimized helpers                                                   |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts` | `buildAgglomerativeClusters` orchestration with profile counter/timing plumbing                                              |
| `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`      | `buildClustersAdvanced` entry point with overloads for plain `Cluster[]` vs `ProfiledClusters` return                        |
| `scripts/behavior-audit/tune-embedding.ts`                                | Orchestration: embed, cluster, profile, subdivide, merge, print summary                                                      |
| `scripts/behavior-audit/tune-embedding-args.ts`                           | CLI argument parsing including `--profile-clustering` and `--profile-sizes`                                                  |
| `scripts/behavior-audit/profile-clustering.ts`                            | Standalone benchmark runner for scale sweeps against cached embeddings                                                       |

### Key Tests

- `tests/scripts/behavior-audit/clustering-profile.test.ts` — profile helper immutability, accumulation, and formatting.
- `tests/scripts/behavior-audit/consolidate-keywords-advanced-clustering.test.ts` — average/complete parity against naive reference; single-linkage gap semantics; 600-vector performance smoke test.
- `tests/scripts/behavior-audit/tune-embedding.test.ts` — CLI flag parsing and profile-path wiring.

## Related Decisions

- **ADR-0099**: Embedding Clustering — Linkage-Mode and Oversized-Cluster Improvements (the NNC + gap + linkage decision).
- **ADR-0085**: Embedding Cache and Clustering Optimization (the pre-normalized embedding cache decision).

## References

- Profile results: `docs/archive/2026-04-29-embedding-clustering-profile-results.md`
- CPU profile artifacts: `profiles/embedding-clustering-average.cpuprofile`, `profiles/embedding-clustering-complete.cpuprofile`
- Archived implementation plans:
  - `docs/archive/2026-04-29-embedding-clustering-profiling.md`
  - `docs/archive/2026-04-29-embedding-clustering-acceleration.md`
  - `docs/archive/2026-04-29-embedding-clustering-followups.md`
