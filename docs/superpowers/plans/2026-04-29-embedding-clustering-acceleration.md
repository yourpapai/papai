# Embedding Clustering Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accelerate exact behavior-audit average/complete embedding clustering based on measured profiling evidence.

**Architecture:** Optimize the existing TypeScript HAC implementation by removing avoidable allocation and repeated active-list scans while preserving exact merge ordering and output. Start with the profiled nearest-neighbor path in the current helper modules, replacing sort-based candidate selection and repeated string-key blocked-pair churn before considering any native or WASM rewrite.

**Tech Stack:** TypeScript, Bun, measured profiling artifacts, Float32Array/Float64Array numeric arrays

---

## File Structure

| File                                                                      | Responsibility                                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`    | Replace sort/filter-heavy nearest-neighbor helpers with one-pass scans and numeric blocked-pair ids |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-chain.ts`      | Keep nearest-neighbor-chain step behavior identical while consuming faster helper primitives        |
| `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts` | Reuse optimized helper state and preserve profile counters / timings                                |
| `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`       | Regression tests for output parity and profiling counters on optimized paths                        |

---

### Task 1: Replace Sort-Based Nearest-Neighbor Search

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Add a failing regression test for profiled parity**

Add this test near the existing profiling test block in `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`:

```typescript
test('average profiling counters remain stable after nearest-neighbor optimization', () => {
  const normalized = toNormalizedFloat64Arrays([
    [1, 0, 0],
    [0.99, 0.01, 0],
    [0.98, 0.02, 0],
    [0, 1, 0],
    [0, 0.99, 0.01],
  ])

  const profiled = buildClustersAdvanced(normalized, 0.95, 2, 'average', 0, { profile: true })

  expect(profiled.clusters).toEqual([
    [0, 1, 2],
    [3, 4],
  ])
  expect(profiled.profile.counters.merges).toBe(3)
  expect(profiled.profile.counters.nearestNeighborCalls).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run the targeted test to verify the current baseline**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts -t "nearest-neighbor optimization"`

Expected: PASS. This locks the exact output/counter baseline before the helper rewrite.

- [ ] **Step 3: Replace `findNearestActiveCluster` with a one-pass minimum scan**

In `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`, replace the current `findNearestActiveCluster(...)` implementation with a one-pass scan that avoids `.filter(...).filter(...).map(...).toSorted(...)` allocation:

```typescript
export function findNearestActiveCluster(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  cluster: number,
  blockedPairs: ReadonlySet<number>,
  profile: ClusteringProfile,
): Readonly<{ nearest: number | undefined; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  const active = activeIndices(state)

  let nearest: number | undefined
  let bestDistance = Infinity
  let distanceReads = 0

  for (const candidate of active) {
    if (candidate === cluster) continue
    if (blockedPairs.has(pairKey(cluster, candidate, matrix.n))) continue

    const distance = getDistance(matrix, cluster, candidate)
    distanceReads += 1
    if (distance < bestDistance || (distance === bestDistance && (nearest === undefined || candidate < nearest))) {
      nearest = candidate
      bestDistance = distance
    }
  }

  const withCounters = incrementClusteringCounter(
    incrementClusteringCounter(incrementClusteringCounter(profile, 'nearestNeighborCalls', 1), 'activeListBuilds', 1),
    'activeItemsVisited',
    active.length,
  )

  return {
    nearest,
    profile: recordClusteringTiming(
      incrementClusteringCounter(withCounters, 'distanceReads', distanceReads),
      'nearestNeighborMs',
      performance.now() - startedAt,
    ),
  }
}
```

- [ ] **Step 4: Run the helper regression test**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts -t "nearest-neighbor optimization"`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "perf: replace sorted nearest-neighbor scans"
```

---

### Task 2: Replace String Blocked-Pair Keys with Numeric Keys

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`
- Modify: `scripts/behavior-audit/consolidate-keywords-agglomerative-chain.ts`
- Modify: `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts`
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Add a failing regression test for gap-mode parity**

Add this test near the gap-threshold coverage in `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`:

```typescript
test('average linkage gap profiling preserves blocked-pair behavior after key optimization', () => {
  const normalized = toNormalizedFloat64Arrays([
    [1, 0, 0],
    [0.85, 0.53, 0],
    [0.85, -0.53, 0],
    [0, 1, 0],
    [0, 0.99, 0.01],
  ])

  const profiled = buildClustersAdvanced(normalized, 0.8, 2, 'average', 0.2, { profile: true })

  expect(profiled.clusters).toEqual([[3, 4]])
  expect(profiled.profile.counters.blockedPairs).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run the targeted gap test**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts -t "blocked-pair behavior after key optimization"`

Expected: PASS.

- [ ] **Step 3: Change blocked-pair keys to numeric condensed indices**

In `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`, replace the string key helper:

```typescript
export function pairKey(a: number, b: number, n: number): number {
  return condensedIndex(a, b, n)
}
```

Then update all callers in:

- `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`
- `scripts/behavior-audit/consolidate-keywords-agglomerative-chain.ts`
- `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts`

so `blockedPairs` is a `ReadonlySet<number>` / `Set<number>` and every call site passes `matrix.n` when computing a key.

- [ ] **Step 4: Run focused gap tests**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts -t "gap"`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts scripts/behavior-audit/consolidate-keywords-agglomerative-chain.ts scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "perf: remove string blocked-pair keys"
```

---

### Task 3: Avoid Rebuilding Active Lists in Candidate Scans

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`
- Modify: `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts`
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Add a failing performance smoke test guard**

Add this test near the existing hundreds-of-vectors smoke test:

```typescript
test('average linkage still handles hundreds of vectors within the smoke budget', () => {
  const vectors = Array.from({ length: 600 }, (_, index) => {
    const group = Math.floor(index / 20)
    const angle = group * 0.1 + (index % 20) * 0.001
    return [Math.cos(angle), Math.sin(angle), (index % 7) / 100]
  })
  const normalized = toNormalizedFloat64Arrays(vectors)
  const startedAt = performance.now()

  const clusters = buildClustersAdvanced(normalized, 0.99, 2, 'average', 0)
  const elapsed = performance.now() - startedAt

  expect(clusters.length).toBeGreaterThan(0)
  expect(elapsed).toBeLessThan(5000)
})
```

- [ ] **Step 2: Run the smoke test baseline**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts -t "hundreds of vectors"`

Expected: PASS.

- [ ] **Step 3: Thread a reusable active snapshot through candidate-scan helpers**

In `scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts`, compute `const active = activeIndices(state)` once per outer loop iteration and pass it to `findChainStart(...)`, `hasMergeCandidate(...)`, and any helper that can reuse it instead of rebuilding the same list repeatedly.

In `scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts`, update those helpers so their signatures accept `active: readonly number[]` and remove any redundant `activeIndices(state)` calls that are no longer needed.

Keep counter accounting stable by still incrementing `activeListBuilds` only for the active lists that are truly materialized.

- [ ] **Step 4: Run full helper tests**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/behavior-audit/consolidate-keywords-agglomerative-helpers.ts scripts/behavior-audit/consolidate-keywords-agglomerative-clustering.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "perf: reuse active cluster snapshots"
```

---

### Task 4: Verify Real-Data Improvement Against the Profile Runner

**Files:**

- Modify only if verification reveals a bug

- [ ] **Step 1: Run clustering helper tests**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts tests/scripts/behavior-audit/clustering-profile.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck and lint**

Run: `bun typecheck`

Expected: PASS.

Run: `bun lint`

Expected: PASS.

- [ ] **Step 3: Re-run the profile smoke command**

Run: `bun scripts/behavior-audit/profile-clustering.ts --sizes 10 --linkage average --threshold 0.9 --output /tmp/papai-clustering-profile.md`

Expected: PASS and `Wrote /tmp/papai-clustering-profile.md`.

- [ ] **Step 4: Re-measure the main hotspot sizes**

Run: `bun scripts/behavior-audit/profile-clustering.ts --linkage average --threshold 0.9 --sizes 500,1000,2000 --output /tmp/papai-clustering-profile-after.md`

Expected: PASS. Compare `nearestNeighborMs`, `candidateScanMs`, and `totalMs` to the baseline evidence in `docs/superpowers/plans/2026-04-29-embedding-clustering-profile-results.md`. The optimized version should materially reduce `nearestNeighborMs` at 1000 and 2000.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required code changes:

```bash
git add <changed-files>
git commit -m "fix: address clustering acceleration verification failures"
```

If no code changes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan follows the evidence-driven decision to start with pure TypeScript scan optimization, targeting the measured `toSorted`, nearest-neighbor, and blocked-pair overhead before any native/WASM rewrite.
- Placeholder scan: No `TODO`, `TBD`, or deferred implementation placeholders remain. Each task names exact files, commands, and expected outcomes.
- Type consistency: The plan keeps the existing `buildClustersAdvanced(...)` API intact and optimizes the current helper modules rather than introducing a second clustering surface.
