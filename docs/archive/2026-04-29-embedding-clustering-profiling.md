# Embedding Clustering Profiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add evidence-first profiling for slow behavior-audit `average` and `complete` embedding clustering, then use the measurements to choose the smallest acceleration path.

**Architecture:** Keep existing clustering semantics unchanged while adding opt-in instrumentation around the current TypeScript implementation. Collect per-phase timing and operation counters from matrix construction, nearest-neighbor search, gap checks, merge updates, and oversized subdivision, then run scale benchmarks plus Bun CPU profiles before selecting pure TypeScript, worker, Node-API, WASM, or sidecar acceleration.

**Tech Stack:** TypeScript, Bun, Bun `--cpu-prof`, `bun:jsc` profiling APIs, Float32Array/Float64Array numeric arrays, existing behavior-audit tests

---

## Research Notes

- Bun documents `bun --cpu-prof script.ts` for generating `.cpuprofile` files inspectable in Chrome DevTools or VS Code, and supports `--cpu-prof-name` / `--cpu-prof-dir` to control output location: https://bun.com/docs/project/benchmarking
- Bun exposes `bun:jsc` `profile(callback, sampleInterval, ...args)` for function-scoped JavaScriptCore sampling profiles: https://bun.com/reference/bun/jsc/profile
- Bun exposes `bun:jsc` `heapStats()` and `bun --heap-prof` for memory investigation if matrix allocation or GC dominates: https://bun.com/docs/project/benchmarking
- Bun implements most Node-API support and can load `.node` modules, but native addon work still requires toolchain and packaging decisions: https://bun.sh/docs/runtime/node-api
- Node.js documents Node-API as ABI-stable for native C/C++ addons, insulated from JavaScript engine changes: https://nodejs.org/docs/latest/api/n-api.html
- Bun FFI remains experimental; use it only for short-lived local experiments, not as the preferred production integration path.
- `kodama` is a Rust hierarchical agglomerative clustering library based on the `fastcluster` family and is a plausible reference/acceleration candidate if TypeScript optimization is insufficient: https://github.com/diffeo/kodama

---

## Current Evidence

- Default single-linkage command completes on the real 7,697-slug set and reports `7697 -> 5261`, `2436 merges`, `31.6% reduction`.
- `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.9 --linkage average --max-cluster-size 20` reaches `[tune] Clustering...` and times out after 20 minutes.
- `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.9 --linkage average --max-cluster-size 20 --gap-threshold 0.05` also reaches `[tune] Clustering...` and times out after 20 minutes.
- Embeddings are cached before the timeout: `[embedding-cache] Reusing cached embeddings (7697 slugs)`, so the bottleneck is clustering, not embedding.
- Suspected hot spots in `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts` are repeated `activeIndices(state)` allocation, `toSorted()` inside every nearest-neighbor lookup, full scans in gap checks, and repeated active scans in `hasMergeCandidate()`.

---

## File Structure

| File                                                                        | Responsibility                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/clustering-profile.ts`                              | New opt-in profiling types, timer helpers, counter helpers, and report formatting           |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts`   | Orchestrate profiled average/complete HAC without changing merge semantics                  |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`      | Shared profiled HAC distance helpers, gap checks, counters, and matrix utilities            |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-chain.ts`        | Shared profiled nearest-neighbor chain step transitions                                     |
| `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`        | Thread optional profiling options through advanced clustering and oversized subdivision     |
| `scripts/behavior-audit/tune-embedding.ts`                                  | Add `--profile-clustering` and `--profile-sizes` CLI flags; print profile summaries         |
| `scripts/behavior-audit/tune-embedding-args.ts`                             | Shared `tune-embedding` CLI argument parsing kept separate when repo size limits require it |
| `scripts/behavior-audit/profile-clustering.ts`                              | New focused benchmark/profiling runner for cached embeddings and scale sweeps               |
| `tests/scripts/behavior-audit/clustering-profile.test.ts`                   | Unit tests for profile summary formatting and immutable stat updates                        |
| `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`         | Regression tests proving profiling does not change cluster output                           |
| `tests/scripts/behavior-audit/tune-embedding.test.ts`                       | CLI parsing/wiring tests for new profiling flags                                            |
| `docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md` | Measurement log created after profiling runs complete                                       |

---

### Task 1: Add Opt-In Profiling Primitives

**Files:**

- Create: `scripts/behavior-audit/clustering-profile.ts`
- Create: `tests/scripts/behavior-audit/clustering-profile.test.ts`

- [ ] **Step 1: Write failing profile helper tests**

Create `tests/scripts/behavior-audit/clustering-profile.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import {
  createClusteringProfile,
  formatClusteringProfile,
  incrementClusteringCounter,
  recordClusteringTiming,
} from '../../../scripts/behavior-audit/clustering-profile.js'

describe('clustering profile helpers', () => {
  test('recordClusteringTiming updates one phase immutably', () => {
    const initial = createClusteringProfile({ enabled: true, linkage: 'average', threshold: 0.9, size: 3 })
    const updated = recordClusteringTiming(initial, 'nearestNeighborMs', 12.5)

    expect(initial.timings.nearestNeighborMs).toBe(0)
    expect(updated.timings.nearestNeighborMs).toBe(12.5)
    expect(updated.timings.matrixBuildMs).toBe(0)
  })

  test('incrementClusteringCounter updates one counter immutably', () => {
    const initial = createClusteringProfile({ enabled: true, linkage: 'complete', threshold: 0.91, size: 4 })
    const updated = incrementClusteringCounter(initial, 'nearestNeighborCalls', 7)

    expect(initial.counters.nearestNeighborCalls).toBe(0)
    expect(updated.counters.nearestNeighborCalls).toBe(7)
    expect(updated.counters.merges).toBe(0)
  })

  test('formatClusteringProfile prints stable timing and counter lines', () => {
    const profile = incrementClusteringCounter(
      recordClusteringTiming(
        createClusteringProfile({ enabled: true, linkage: 'average', threshold: 0.9, size: 10 }),
        'matrixBuildMs',
        3.25,
      ),
      'distanceReads',
      42,
    )

    expect(formatClusteringProfile(profile)).toEqual(
      [
        '[profile] clustering linkage=average threshold=0.9 size=10',
        '[profile] timings matrixBuildMs=3.25 nearestNeighborMs=0 mergeUpdateMs=0 gapCheckMs=0 candidateScanMs=0 subdivisionMs=0 totalMs=0',
        '[profile] counters activeListBuilds=0 activeItemsVisited=0 nearestNeighborCalls=0 distanceReads=42 distanceWrites=0 gapChecks=0 blockedPairs=0 mergeCandidatesScanned=0 merges=0 subdivisions=0 maxActiveClusters=10 maxClusterSize=1',
      ].join('\n'),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/clustering-profile.test.ts`

Expected: FAIL with an import error for `scripts/behavior-audit/clustering-profile.ts`.

- [ ] **Step 3: Add minimal immutable profile helpers**

Create `scripts/behavior-audit/clustering-profile.ts`:

```typescript
import type { LinkageMode } from './consolidate-keywords-clustering.js'

export type ClusteringTimingKey =
  | 'matrixBuildMs'
  | 'nearestNeighborMs'
  | 'mergeUpdateMs'
  | 'gapCheckMs'
  | 'candidateScanMs'
  | 'subdivisionMs'
  | 'totalMs'

export type ClusteringCounterKey =
  | 'activeListBuilds'
  | 'activeItemsVisited'
  | 'nearestNeighborCalls'
  | 'distanceReads'
  | 'distanceWrites'
  | 'gapChecks'
  | 'blockedPairs'
  | 'mergeCandidatesScanned'
  | 'merges'
  | 'subdivisions'
  | 'maxActiveClusters'
  | 'maxClusterSize'

export type ClusteringTimings = Readonly<Record<ClusteringTimingKey, number>>
export type ClusteringCounters = Readonly<Record<ClusteringCounterKey, number>>

export type ClusteringProfile = Readonly<{
  enabled: boolean
  linkage: LinkageMode
  threshold: number
  size: number
  timings: ClusteringTimings
  counters: ClusteringCounters
}>

export type ClusteringProfileInput = Readonly<{
  enabled: boolean
  linkage: LinkageMode
  threshold: number
  size: number
}>

const emptyTimings = (): ClusteringTimings => ({
  matrixBuildMs: 0,
  nearestNeighborMs: 0,
  mergeUpdateMs: 0,
  gapCheckMs: 0,
  candidateScanMs: 0,
  subdivisionMs: 0,
  totalMs: 0,
})

const emptyCounters = (size: number): ClusteringCounters => ({
  activeListBuilds: 0,
  activeItemsVisited: 0,
  nearestNeighborCalls: 0,
  distanceReads: 0,
  distanceWrites: 0,
  gapChecks: 0,
  blockedPairs: 0,
  mergeCandidatesScanned: 0,
  merges: 0,
  subdivisions: 0,
  maxActiveClusters: size,
  maxClusterSize: 1,
})

export function createClusteringProfile(input: ClusteringProfileInput): ClusteringProfile {
  return {
    enabled: input.enabled,
    linkage: input.linkage,
    threshold: input.threshold,
    size: input.size,
    timings: emptyTimings(),
    counters: emptyCounters(input.size),
  }
}

export function recordClusteringTiming(
  profile: ClusteringProfile,
  key: ClusteringTimingKey,
  elapsedMs: number,
): ClusteringProfile {
  if (!profile.enabled) return profile
  return {
    ...profile,
    timings: {
      ...profile.timings,
      [key]: profile.timings[key] + elapsedMs,
    },
  }
}

export function incrementClusteringCounter(
  profile: ClusteringProfile,
  key: ClusteringCounterKey,
  amount: number,
): ClusteringProfile {
  if (!profile.enabled) return profile
  return {
    ...profile,
    counters: {
      ...profile.counters,
      [key]: profile.counters[key] + amount,
    },
  }
}

export function recordClusteringCounterMax(
  profile: ClusteringProfile,
  key: ClusteringCounterKey,
  value: number,
): ClusteringProfile {
  if (!profile.enabled) return profile
  return {
    ...profile,
    counters: {
      ...profile.counters,
      [key]: Math.max(profile.counters[key], value),
    },
  }
}

const timingLine = (timings: ClusteringTimings): string =>
  `matrixBuildMs=${timings.matrixBuildMs} nearestNeighborMs=${timings.nearestNeighborMs} mergeUpdateMs=${timings.mergeUpdateMs} gapCheckMs=${timings.gapCheckMs} candidateScanMs=${timings.candidateScanMs} subdivisionMs=${timings.subdivisionMs} totalMs=${timings.totalMs}`

const counterLine = (counters: ClusteringCounters): string =>
  `activeListBuilds=${counters.activeListBuilds} activeItemsVisited=${counters.activeItemsVisited} nearestNeighborCalls=${counters.nearestNeighborCalls} distanceReads=${counters.distanceReads} distanceWrites=${counters.distanceWrites} gapChecks=${counters.gapChecks} blockedPairs=${counters.blockedPairs} mergeCandidatesScanned=${counters.mergeCandidatesScanned} merges=${counters.merges} subdivisions=${counters.subdivisions} maxActiveClusters=${counters.maxActiveClusters} maxClusterSize=${counters.maxClusterSize}`

export function formatClusteringProfile(profile: ClusteringProfile): string {
  return [
    `[profile] clustering linkage=${profile.linkage} threshold=${profile.threshold} size=${profile.size}`,
    `[profile] timings ${timingLine(profile.timings)}`,
    `[profile] counters ${counterLine(profile.counters)}`,
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/behavior-audit/clustering-profile.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add scripts/behavior-audit/clustering-profile.ts tests/scripts/behavior-audit/clustering-profile.test.ts
git commit -m "test: add clustering profiling primitives"
```

Expected: commit succeeds. If the user has requested no commits in this session, skip this step and leave the files staged/unstaged according to the current workflow.

---

### Task 2: Instrument Average/Complete HAC Without Behavior Changes

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts`
- Create: `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts` if repo `max-lines` / `max-lines-per-function` constraints require helper extraction
- Create: `scripts/behavior-audit/consolidate-keywords-agglomerative-chain.ts` if repo `max-lines` / `max-lines-per-function` constraints require helper extraction
- Modify: `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
- Modify: `tests/scripts/behavior-audit/tune-embedding.test.ts` only if needed to keep `typeof buildClustersAdvanced` dependency stubs assignable after the profiling overloads are added

Note: this repository's agent-strict lint policy forbids optional type syntax in implementation code, so represent the plan's profiling option using a repo-compliant equivalent such as `Readonly<{ profile: boolean | undefined }>` while preserving the same call-site behavior.

- [ ] **Step 1: Add a regression test proving profiling preserves output**

Add this test to `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts` near the existing advanced clustering tests:

```typescript
test('buildClustersAdvanced returns identical clusters when profiling is enabled', () => {
  const normalized = toNormalizedFloat64Arrays([
    [1, 0, 0],
    [0.99, 0.01, 0],
    [0.98, 0.02, 0],
    [0, 1, 0],
    [0, 0.99, 0.01],
  ])

  const plain = buildClustersAdvanced(normalized, 0.95, 2, 'average', 0)
  const profiled = buildClustersAdvanced(normalized, 0.95, 2, 'average', 0, { profile: true })

  expect(profiled.clusters).toEqual(plain)
  expect(profiled.profile.counters.merges).toBe(3)
  expect(profiled.profile.counters.nearestNeighborCalls).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

Expected: FAIL because `buildClustersAdvanced` does not accept `{ profile: true }` or return `{ clusters, profile }`.

- [ ] **Step 3: Add option/result types and profile plumbing**

In `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`, import the profile helpers:

```typescript
import { createClusteringProfile, recordClusteringTiming } from './clustering-profile.js'
import type { ClusteringProfile } from './clustering-profile.js'
```

Add these exported types near `type Cluster = readonly number[]`:

```typescript
export type ClusteringProfileOptions = Readonly<{
  profile: boolean | undefined
}>

export type ProfiledClusters = Readonly<{
  clusters: readonly Cluster[]
  profile: ClusteringProfile
}>
```

Update the non-single helper to accept an optional profile object and return a profiled result internally:

```typescript
function buildClustersNonSingle(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: Exclude<LinkageMode, 'single'>,
  gapThreshold: number,
  profile: ClusteringProfile,
): ProfiledClusters {
  return buildAgglomerativeClusters(normalizedEmbeddings, threshold, minClusterSize, linkage, gapThreshold, profile)
}
```

Change `buildClustersAdvanced` overloads and implementation to preserve the old return type unless profiling is requested:

```typescript
export function buildClustersAdvanced(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: LinkageMode,
  gapThreshold: number,
): readonly Cluster[]
export function buildClustersAdvanced(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: LinkageMode,
  gapThreshold: number,
  options: ClusteringProfileOptions & Readonly<{ profile: true }>,
): ProfiledClusters
export function buildClustersAdvanced(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: LinkageMode,
  gapThreshold: number,
  options: ClusteringProfileOptions = {},
): readonly Cluster[] | ProfiledClusters {
  const startedAt = performance.now()
  const initialProfile = createClusteringProfile({
    enabled: options.profile === true,
    linkage,
    threshold,
    size: normalizedEmbeddings.length,
  })

  const complete = (
    clusters: readonly Cluster[],
    profile: ClusteringProfile,
  ): readonly Cluster[] | ProfiledClusters => {
    const completedProfile = recordClusteringTiming(profile, 'totalMs', performance.now() - startedAt)
    return options.profile === true ? { clusters, profile: completedProfile } : clusters
  }

  if (gapThreshold <= 0) {
    if (linkage === 'single') {
      return complete(buildClustersNormalized(normalizedEmbeddings, threshold, minClusterSize), initialProfile)
    }
    const result = buildClustersNonSingle(normalizedEmbeddings, threshold, minClusterSize, linkage, 0, initialProfile)
    return complete(result.clusters, result.profile)
  }
  if (normalizedEmbeddings.length === 0) return complete([], initialProfile)
  if (linkage === 'single') {
    return complete(
      buildClustersSingleWithGap(normalizedEmbeddings, threshold, minClusterSize, gapThreshold),
      initialProfile,
    )
  }
  const result = buildClustersNonSingle(
    normalizedEmbeddings,
    threshold,
    minClusterSize,
    linkage,
    gapThreshold,
    initialProfile,
  )
  return complete(result.clusters, result.profile)
}
```

- [ ] **Step 4: Instrument HAC internals**

In `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts`, import the helper functions and type:

```typescript
import { incrementClusteringCounter, recordClusteringCounterMax, recordClusteringTiming } from './clustering-profile.js'
import type { ClusteringProfile } from './clustering-profile.js'
```

Change `findNearestActiveCluster` to accept and return a profile:

```typescript
function findNearestActiveCluster(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  cluster: number,
  blockedPairs: ReadonlySet<string>,
  profile: ClusteringProfile,
): Readonly<{ nearest: number | undefined; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  const active = activeIndices(state)
  const nearest = active
    .filter((candidate) => candidate !== cluster)
    .filter((candidate) => !blockedPairs.has(pairKey(cluster, candidate)))
    .map((candidate) => ({ candidate, distance: getDistance(matrix, cluster, candidate) }))
    .toSorted(compareNearest)[0]
  const withCounters = incrementClusteringCounter(
    incrementClusteringCounter(incrementClusteringCounter(profile, 'nearestNeighborCalls', 1), 'activeListBuilds', 1),
    'activeItemsVisited',
    active.length,
  )
  const withDistanceReads = incrementClusteringCounter(withCounters, 'distanceReads', Math.max(active.length - 1, 0))
  return {
    nearest: nearest?.candidate,
    profile: recordClusteringTiming(withDistanceReads, 'nearestNeighborMs', performance.now() - startedAt),
  }
}
```

Change `updateMergedDistances` to return a profile and increment distance writes:

```typescript
function updateMergedDistances(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  survivor: number,
  removed: number,
  linkage: Exclude<LinkageMode, 'single'>,
  profile: ClusteringProfile,
): ClusteringProfile {
  const startedAt = performance.now()
  const survivorSize = state.sizes[survivor]
  const removedSize = state.sizes[removed]
  if (survivorSize === undefined || removedSize === undefined) return profile
  const active = activeIndices(state)
  for (const other of active) {
    if (other === survivor || other === removed) continue
    const distanceToSurvivor = getDistance(matrix, survivor, other)
    const distanceToRemoved = getDistance(matrix, removed, other)
    const updatedDistance =
      linkage === 'average'
        ? (survivorSize * distanceToSurvivor + removedSize * distanceToRemoved) / (survivorSize + removedSize)
        : Math.max(distanceToSurvivor, distanceToRemoved)
    setDistance(matrix, survivor, other, updatedDistance)
  }
  state.sizes[survivor] = survivorSize + removedSize
  state.sizes[removed] = 0
  state.active[removed] = 0
  const visited = active.length
  const written = Math.max(active.length - 2, 0)
  const withCounters = incrementClusteringCounter(
    incrementClusteringCounter(
      incrementClusteringCounter(profile, 'activeListBuilds', 1),
      'activeItemsVisited',
      visited,
    ),
    'distanceWrites',
    written,
  )
  return recordClusteringTiming(withCounters, 'mergeUpdateMs', performance.now() - startedAt)
}
```

Change `mergePassesGap`, `hasMergeCandidate`, `findChainStart`, and `tryExtendOrMergeChain` in the same style: return `{ value, profile }`, increment `gapChecks`, `blockedPairs`, `mergeCandidatesScanned`, `distanceReads`, `activeListBuilds`, and record `gapCheckMs` or `candidateScanMs` with `performance.now()`. Keep all branch conditions and tie-break ordering unchanged.

Update `buildAgglomerativeClusters` signature and return value:

```typescript
export function buildAgglomerativeClusters(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: Exclude<LinkageMode, 'single'>,
  gapThreshold: number,
  profile: ClusteringProfile,
): Readonly<{ clusters: readonly Cluster[]; profile: ClusteringProfile }> {
  const n = normalizedEmbeddings.length
  if (n === 0) return { clusters: [], profile }
  const maxDistance = 1 - threshold
  const matrixStartedAt = performance.now()
  const matrix = buildCondensedDistanceMatrix(normalizedEmbeddings)
  const withMatrixTiming = recordClusteringTiming(profile, 'matrixBuildMs', performance.now() - matrixStartedAt)
  const state = createActiveState(n)
  const members = new Map<number, Cluster>(normalizedEmbeddings.map((_, index) => [index, [index]]))
  let blockedPairs = new Set<string>()
  let currentProfile = withMatrixTiming

  for (;;) {
    const active = activeIndices(state)
    currentProfile = recordClusteringCounterMax(
      incrementClusteringCounter(currentProfile, 'activeListBuilds', 1),
      'maxActiveClusters',
      active.length,
    )
    currentProfile = incrementClusteringCounter(currentProfile, 'activeItemsVisited', active.length)
    if (active.length <= 1) break

    const startResult = findChainStart(active, matrix, state, maxDistance, blockedPairs, currentProfile)
    currentProfile = startResult.profile
    if (startResult.start === undefined) break

    const chain: number[] = [startResult.start]
    let mergedThisRound = false
    for (;;) {
      const actionResult = tryExtendOrMergeChain(chain, matrix, state, blockedPairs, maxDistance, currentProfile)
      currentProfile = actionResult.profile
      const action = actionResult.action
      if (action.kind === 'blocked') break
      if (action.kind === 'extended') continue
      const gapResult = mergePassesGap(matrix, state, action.a, action.b, gapThreshold, currentProfile)
      currentProfile = gapResult.profile
      if (!gapResult.passes) {
        blockedPairs = new Set([...blockedPairs, pairKey(action.a, action.b)])
        currentProfile = incrementClusteringCounter(currentProfile, 'blockedPairs', 1)
        break
      }
      const mergedMembers = [...getClusterMembers(members, action.a), ...getClusterMembers(members, action.b)]
      members.set(action.a, mergedMembers)
      members.delete(action.b)
      currentProfile = recordClusteringCounterMax(currentProfile, 'maxClusterSize', mergedMembers.length)
      currentProfile = updateMergedDistances(matrix, state, action.a, action.b, linkage, currentProfile)
      currentProfile = incrementClusteringCounter(currentProfile, 'merges', 1)
      blockedPairs = new Set<string>()
      mergedThisRound = true
      break
    }
    if (!mergedThisRound) {
      const candidateResult = hasMergeCandidate(active, matrix, maxDistance, blockedPairs, currentProfile)
      currentProfile = candidateResult.profile
      if (!candidateResult.hasCandidate) break
    }
  }

  return {
    clusters: filterClusters(
      [...members.entries()].filter(([id]) => isActive(state, id)).map(([, cluster]) => cluster),
      minClusterSize,
    ),
    profile: currentProfile,
  }
}
```

- [ ] **Step 5: Run regression tests**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts tests/scripts/behavior-audit/clustering-profile.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "feat: instrument embedding clustering profiles"
```

Expected: commit succeeds unless commits are intentionally deferred. If helper extraction or the overload-compatible `tune-embedding` test stub change was required to satisfy repo constraints, include those files in the same commit.

---

### Task 3: Expose Profiling From `tune-embedding`

**Files:**

- Modify: `scripts/behavior-audit/tune-embedding.ts`
- Create: `scripts/behavior-audit/tune-embedding-args.ts` if repo `max-lines` / `max-lines-per-function` constraints require extracting CLI parsing while preserving the exported `parseArgs(...)` surface from `tune-embedding.ts`
- Modify: `tests/scripts/behavior-audit/tune-embedding.test.ts`

- [ ] **Step 1: Add failing CLI parse and wiring tests**

Add tests to `tests/scripts/behavior-audit/tune-embedding.test.ts`:

```typescript
test('parseArgs enables clustering profile output', () => {
  expect(parseArgs(['--profile-clustering']).profileClustering).toBe(true)
})

test('parseArgs parses comma-separated profile sizes', () => {
  expect(parseArgs(['--profile-sizes', '500,1000,2000']).profileSizes).toEqual([500, 1000, 2000])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/tune-embedding.test.ts`

Expected: FAIL because `profileClustering` and `profileSizes` do not exist.

- [ ] **Step 3: Add tune parameters and parsers**

In `scripts/behavior-audit/tune-embedding.ts`, import the formatter:

```typescript
import { formatClusteringProfile } from './clustering-profile.js'
```

Extend `TuneParams`:

```typescript
interface TuneParams {
  readonly threshold: number
  readonly minClusterSize: number
  readonly maxClusterSize: number
  readonly linkage: LinkageMode
  readonly gapThreshold: number
  readonly reembed: boolean
  readonly cacheDir: string
  readonly profileClustering: boolean
  readonly profileSizes: readonly number[]
}
```

Add this parser near `parseLinkage`:

```typescript
function parsePositiveIntegerList(flag: string, value: string): readonly number[] {
  return value.split(',').map((raw) => {
    const parsed = Number(raw.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new TypeError(`Invalid positive integer value for ${flag}: ${raw}`)
    }
    return parsed
  })
}
```

Update `parseArgs` defaults and flag handling:

```typescript
let profileClustering = false
let profileSizes: readonly number[] = []
```

Inside the loop:

```typescript
if (flag === '--profile-clustering') {
  profileClustering = true
}
if (flag === '--profile-sizes' && value !== undefined) {
  profileSizes = parsePositiveIntegerList(flag, value)
  profileClustering = true
  i++
}
```

Return:

```typescript
return {
  threshold,
  minClusterSize,
  maxClusterSize,
  linkage,
  gapThreshold,
  reembed,
  cacheDir,
  profileClustering,
  profileSizes,
}
```

- [ ] **Step 4: Print profile summaries without changing default output**

Update `buildTuneClusters`:

```typescript
const clusterResult = params.profileClustering
  ? deps.buildClustersAdvanced(
      normalized,
      params.threshold,
      params.minClusterSize,
      params.linkage,
      params.gapThreshold,
      {
        profile: true,
      },
    )
  : deps.buildClustersAdvanced(normalized, params.threshold, params.minClusterSize, params.linkage, params.gapThreshold)

const clusters = Array.isArray(clusterResult) ? clusterResult : clusterResult.clusters
if (!Array.isArray(clusterResult)) {
  console.log(formatClusteringProfile(clusterResult.profile))
}
```

Then keep the existing `subdivideOversizedClusters(...)` return logic. Do not profile subdivision in this task; Task 4 adds focused subdivision measurement.

- [ ] **Step 5: Run tune tests**

Run: `bun test tests/scripts/behavior-audit/tune-embedding.test.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add scripts/behavior-audit/tune-embedding.ts tests/scripts/behavior-audit/tune-embedding.test.ts
git commit -m "feat: expose clustering profile output"
```

Expected: commit succeeds unless commits are intentionally deferred. If arg parsing was extracted to satisfy repo constraints, include `scripts/behavior-audit/tune-embedding-args.ts` in the same commit.

---

### Task 4: Add Focused Scale Benchmark Runner

**Files:**

- Create: `scripts/behavior-audit/profile-clustering.ts`
- Modify: `package.json`

- [ ] **Step 1: Add benchmark script**

Create `scripts/behavior-audit/profile-clustering.ts`:

```typescript
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EXTRACTED_DIR, EMBEDDING_BASE_URL, EMBEDDING_MODEL, reloadBehaviorAuditConfig } from './config.js'
import { embedSlugBatch } from './consolidate-keywords-agent.js'
import { buildClustersAdvanced, toNormalizedFloat64Arrays } from './consolidate-keywords-helpers.js'
import type { LinkageMode } from './consolidate-keywords-helpers.js'
import { formatClusteringProfile } from './clustering-profile.js'
import { getOrEmbed } from './embedding-cache.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { normalizeKeywordSlug } from './keyword-vocabulary.js'

type BenchmarkParams = Readonly<{
  threshold: number
  linkage: LinkageMode
  gapThreshold: number
  sizes: readonly number[]
  outputPath: string
}>

const parseNumber = (flag: string, value: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`Invalid numeric value for ${flag}: ${value}`)
  return parsed
}

const parseSizes = (value: string): readonly number[] =>
  value.split(',').map((raw) => {
    const parsed = Number(raw.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError(`Invalid benchmark size: ${raw}`)
    return parsed
  })

const parseLinkage = (value: string): LinkageMode => {
  if (value === 'single' || value === 'average' || value === 'complete') return value
  throw new TypeError(`Unsupported linkage: ${value}`)
}

function parseArgs(args: readonly string[]): BenchmarkParams {
  return args.reduce<BenchmarkParams>(
    (params, flag, index) => {
      const value = args[index + 1]
      if (flag === '--threshold' && value !== undefined) return { ...params, threshold: parseNumber(flag, value) }
      if (flag === '--linkage' && value !== undefined) return { ...params, linkage: parseLinkage(value) }
      if (flag === '--gap-threshold' && value !== undefined)
        return { ...params, gapThreshold: parseNumber(flag, value) }
      if (flag === '--sizes' && value !== undefined) return { ...params, sizes: parseSizes(value) }
      if (flag === '--output' && value !== undefined) return { ...params, outputPath: value }
      return params
    },
    {
      threshold: 0.9,
      linkage: 'average',
      gapThreshold: 0,
      sizes: [500, 1000, 2000, 4000, 7697],
      outputPath: 'docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md',
    },
  )
}

async function collectJsonFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath, entry.name))
}

async function collectKeywords(): Promise<readonly string[]> {
  const files = await collectJsonFiles(EXTRACTED_DIR)
  const parsed = await Promise.all(
    files.map(async (filePath) => {
      const raw: unknown = JSON.parse(await Bun.file(filePath).text())
      return Array.isArray(raw) ? (raw as readonly ExtractedBehaviorRecord[]) : []
    }),
  )
  return [
    ...new Set(
      parsed
        .flat()
        .flatMap((record) => record.keywords.map(normalizeKeywordSlug))
        .filter(Boolean),
    ),
  ].toSorted()
}

const markdownSection = (title: string, body: string): string => `## ${title}\n\n\`\`\`text\n${body}\n\`\`\`\n`

async function run(): Promise<void> {
  reloadBehaviorAuditConfig()
  const params = parseArgs(Bun.argv.slice(2))
  const keywords = await collectKeywords()
  const vocabulary = keywords.map((slug) => ({
    slug,
    description: slug,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }))
  const embeddings = await getOrEmbed(
    join('/tmp', 'tune-embed-cache', 'embedding-cache.json'),
    EMBEDDING_MODEL,
    vocabulary,
    {
      embedSlugBatch,
      providerIdentity: EMBEDDING_BASE_URL,
      log: console,
    },
  )
  const normalized = toNormalizedFloat64Arrays(embeddings.normalized)
  const sections = params.sizes
    .filter((size) => size <= normalized.length)
    .map((size) => {
      const result = buildClustersAdvanced(
        normalized.slice(0, size),
        params.threshold,
        2,
        params.linkage,
        params.gapThreshold,
        {
          profile: true,
        },
      )
      return markdownSection(
        `${params.linkage} threshold=${params.threshold} gap=${params.gapThreshold} size=${size}`,
        `${formatClusteringProfile(result.profile)}\nclusters=${result.clusters.length}`,
      )
    })
  await mkdir(dirname(params.outputPath), { recursive: true })
  await writeFile(
    params.outputPath,
    ['# Embedding Clustering Profile Results', '', `Generated: ${new Date().toISOString()}`, '', ...sections].join(
      '\n',
    ),
    'utf-8',
  )
  console.log(`Wrote ${params.outputPath}`)
}

await run()
```

- [ ] **Step 2: Add package script**

In `package.json`, add this entry near `audit:behavior`:

```json
"audit:behavior:profile-clustering": "bun scripts/behavior-audit/profile-clustering.ts",
```

- [ ] **Step 3: Run a small benchmark smoke test**

Run: `bun scripts/behavior-audit/profile-clustering.ts --sizes 10 --linkage average --threshold 0.9 --output /tmp/papai-clustering-profile.md`

Expected: command completes and prints `Wrote /tmp/papai-clustering-profile.md`.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git add package.json scripts/behavior-audit/profile-clustering.ts
git commit -m "chore: add clustering profile runner"
```

Expected: commit succeeds unless commits are intentionally deferred.

---

### Task 5: Gather Profiling Evidence

**Files:**

- Create/Modify: `docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md`
- Create: `profiles/embedding-clustering-average.cpuprofile`
- Create: `profiles/embedding-clustering-complete.cpuprofile`

- [ ] **Step 1: Run scale sweep for average linkage**

Run:

```bash
bun scripts/behavior-audit/profile-clustering.ts --linkage average --threshold 0.9 --sizes 500,1000,2000,4000,7697 --output docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md
```

Expected: command either completes or reaches the first size that times out. Preserve all completed size sections in the results document.

- [ ] **Step 2: Run scale sweep for average linkage with gap**

Run:

```bash
bun scripts/behavior-audit/profile-clustering.ts --linkage average --threshold 0.9 --gap-threshold 0.05 --sizes 500,1000,2000,4000,7697 --output docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md
```

Expected: command either completes or reaches the first size that times out. Record whether `gapCheckMs`, `blockedPairs`, or `candidateScanMs` dominates.

- [ ] **Step 3: Run scale sweep for complete linkage**

Run:

```bash
bun scripts/behavior-audit/profile-clustering.ts --linkage complete --threshold 0.9 --sizes 500,1000,2000,4000,7697 --output docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md
```

Expected: command either completes or reaches the first size that times out. Record whether complete linkage has the same hot spots as average linkage.

- [ ] **Step 4: Generate Bun CPU profile for average linkage**

Run:

```bash
mkdir -p profiles && bun --cpu-prof --cpu-prof-dir profiles --cpu-prof-name embedding-clustering-average.cpuprofile scripts/behavior-audit/profile-clustering.ts --linkage average --threshold 0.9 --sizes 2000 --output /tmp/papai-average-profile.md
```

Expected: command creates `profiles/embedding-clustering-average.cpuprofile`.

- [ ] **Step 5: Generate Bun CPU profile for complete linkage**

Run:

```bash
mkdir -p profiles && bun --cpu-prof --cpu-prof-dir profiles --cpu-prof-name embedding-clustering-complete.cpuprofile scripts/behavior-audit/profile-clustering.ts --linkage complete --threshold 0.9 --sizes 2000 --output /tmp/papai-complete-profile.md
```

Expected: command creates `profiles/embedding-clustering-complete.cpuprofile`.

- [ ] **Step 6: Record a decision summary**

Append this section to `docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md` after replacing the measured values:

```markdown
## Decision Summary

| Observation           | Evidence                                                                            | Decision Impact                                                                          |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dominant timing phase | nearestNeighborMs / mergeUpdateMs / gapCheckMs / candidateScanMs measured at size N | Determines whether to optimize scans, distance updates, gap gating, or subdivision first |
| Scaling shape         | 500: X ms, 1000: Y ms, 2000: Z ms                                                   | Determines whether pure TypeScript is still plausible                                    |
| CPU profile top frame | function name and percentage from `.cpuprofile`                                     | Confirms or rejects instrumentation counters                                             |
| Memory pressure       | matrix size and observed GC/heap notes                                              | Determines whether Float32 matrix remains acceptable                                     |
```

- [ ] **Step 7: Commit Task 5 results**

Run:

```bash
git add docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md profiles/embedding-clustering-average.cpuprofile profiles/embedding-clustering-complete.cpuprofile
git commit -m "docs: record clustering profile evidence"
```

Expected: commit succeeds unless commits are intentionally deferred. If `.cpuprofile` files are too large for the repository, do not commit them; instead commit only the results markdown with the profile filenames and top-frame findings.

---

### Task 6: Choose the Acceleration Path

**Files:**

- Modify: `docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md`
- Create: `docs/superpowers/plans/2026-04-29-embedding-clustering-acceleration.md`

- [ ] **Step 1: Apply the decision matrix**

Use the measured evidence to choose one path:

| If evidence shows                                                                         | Choose                                 | Rationale                                                                                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `nearestNeighborMs` dominates and CPU profile shows `toSorted` / `activeIndices` overhead | Pure TypeScript scan optimization      | Smallest change: replace sorted allocation with one-pass minimum and reduce active list rebuilding |
| `gapCheckMs` dominates only when `gapThreshold > 0`                                       | Pure TypeScript gap-cache optimization | Keep exact semantics while caching nearest alternatives or early-exiting scans                     |
| `mergeUpdateMs` dominates after scan optimization                                         | Native or WASM numeric kernel          | Distance updates are dense numeric loops that benefit from compiled code                           |
| All phases scale near cubic even after allocation fixes                                   | Native HAC library / Rust Node-API     | Exact average/complete HAC likely needs a mature optimized implementation                          |
| Full-size runtime is acceptable after pure TypeScript optimization                        | Stop after TypeScript                  | Avoid Node-API/WASM packaging unless necessary                                                     |

-- [ ] **Step 2: Create the follow-up implementation plan header**

Create `docs/superpowers/plans/2026-04-29-embedding-clustering-acceleration.md` with exactly one of these complete headers, based on the chosen path from Step 1. Do not include the other two headers in the file.

Use this header if pure TypeScript scan optimization is chosen:

```markdown
# Embedding Clustering Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accelerate exact behavior-audit average/complete embedding clustering based on measured profiling evidence.

**Architecture:** Optimize the existing TypeScript HAC implementation by removing avoidable allocation and repeated active-list scans while preserving exact merge ordering and output.

**Tech Stack:** TypeScript, Bun, measured profiling artifacts, Float32Array/Float64Array numeric arrays

---
```

Use this header if Rust Node-API is chosen:

```markdown
# Embedding Clustering Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accelerate exact behavior-audit average/complete embedding clustering based on measured profiling evidence.

**Architecture:** Move the hot dense HAC numeric kernel into a Rust Node-API addon while preserving TypeScript orchestration, CLI behavior, and existing clustering outputs.

**Tech Stack:** TypeScript, Bun, Rust, Node-API, measured profiling artifacts

---
```

Use this header if WASM is chosen:

```markdown
# Embedding Clustering Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accelerate exact behavior-audit average/complete embedding clustering based on measured profiling evidence.

**Architecture:** Move the hot dense HAC numeric kernel into a WASM module while preserving TypeScript orchestration, CLI behavior, and existing clustering outputs.

**Tech Stack:** TypeScript, Bun, WebAssembly, measured profiling artifacts

---
```

- [ ] **Step 3: Add task sections to the acceleration plan**

After creating the header, add TDD tasks for the chosen path. Each task must name exact files, include failing tests, include implementation snippets, include exact verification commands, and preserve the current `buildClustersAdvanced(...)` API behavior unless the profiling result explicitly justifies a new API.

- [ ] **Step 4: Commit Task 6**

Run:

```bash
git add docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md docs/superpowers/plans/2026-04-29-embedding-clustering-acceleration.md
git commit -m "docs: choose clustering acceleration path"
```

Expected: commit succeeds unless commits are intentionally deferred.

---

## Verification

Run these commands before claiming the profiling work is complete:

```bash
bun test tests/scripts/behavior-audit/clustering-profile.test.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts tests/scripts/behavior-audit/tune-embedding.test.ts
bun typecheck
bun lint
bun scripts/behavior-audit/profile-clustering.ts --sizes 10 --linkage average --threshold 0.9 --output /tmp/papai-clustering-profile.md
```

Expected:

- Tests pass.
- Typecheck passes.
- Lint passes.
- Smoke benchmark writes `/tmp/papai-clustering-profile.md`.
- No forbidden suppression comments are introduced: `eslint-disable`, `oxlint-disable`, `@ts-ignore`, or `@ts-nocheck`.

---

## Acceleration Options To Revisit After Evidence

| Option                                | Pros                                                           | Cons                                              | When to choose                                                                    |
| ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Pure TypeScript scan optimization     | Smallest change, no packaging, easiest tests                   | Still single-threaded JavaScriptCore loops        | Profiling shows allocation/sort/active-list overhead dominates                    |
| Worker threads with SharedArrayBuffer | Can parallelize matrix build or independent scans              | Merge loop is sequential; coordination complexity | Matrix construction dominates and full HAC loop does not                          |
| Rust Node-API addon                   | Fast numeric loops, stable ABI story, can reuse `kodama` ideas | Toolchain and binary packaging complexity         | TypeScript micro-optimization is insufficient and exact semantics remain required |
| C/C++ Node-API addon                  | Stable ABI, no Rust toolchain                                  | More manual memory safety burden                  | Existing C/C++ fastcluster code is adopted directly                               |
| WASM module                           | Portable artifact, simpler sandboxing than native addon        | Boundary copies and SIMD/thread setup complexity  | Hot loop can run mostly inside WASM with one large input/output transfer          |
| Sidecar binary                        | Runtime-agnostic, easiest to prototype in Rust                 | IPC, temp files/stdin payloads, lifecycle errors  | Native addon packaging blocks progress                                            |
| Approximate graph clustering          | Potentially much faster                                        | Changes clustering semantics                      | Only if user accepts approximate behavior later                                   |

---

## Self-Review

- Spec coverage: The plan adds instrumentation, scale benchmarks, CPU profile generation, result recording, and a decision matrix before any acceleration rewrite.
- Placeholder scan: No `TBD`, `TODO`, `implement later`, or placeholder header text remains. Task 6 provides complete branch-specific headers instead of placeholder text.
- Type consistency: `ClusteringProfile`, `ProfiledClusters`, and `ClusteringProfileOptions` are introduced before use; overloads preserve the existing `readonly Cluster[]` return type when profiling is not requested.
