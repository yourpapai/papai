# Embedding Clustering Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-linkage Union-Find clustering with an iterative multi-threshold, multi-linkage approach that prevents giant clusters while maintaining good merges.

**Architecture:** The current `buildClustersNormalized` uses single-linkage (Union-Find) which causes transitive chaining — one high-similarity pair can pull in dissimilar keywords through intermediaries. We replace it with: (1) configurable linkage mode (`single` / `average` / `complete`), (2) a `maxClusterSize` parameter that triggers iterative re-clustering of oversized clusters at progressively higher thresholds, and (3) a `gapThreshold` that prevents borderline merges. The `tune-embedding.ts` CLI gets new flags; `consolidate-keywords.ts` picks up the new parameters from config.

**Tech Stack:** TypeScript, Bun test runner, existing Float64Array embedding pipeline

---

## File Structure

| File                                                                | Responsibility                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/consolidate-keywords-helpers.ts`            | Core clustering algorithms — new `buildClustersAdvanced`, `subdivideOversizedClusters`, linkage helpers                         |
| `scripts/behavior-audit/config.ts`                                  | New config exports: `CONSOLIDATION_LINKAGE`, `CONSOLIDATION_MAX_CLUSTER_SIZE`, `CONSOLIDATION_GAP_THRESHOLD`                    |
| `scripts/behavior-audit/tune-embedding.ts`                          | New CLI flags: `--linkage`, `--max-cluster-size`, `--gap-threshold`; new `TuneParams` fields; iterative clustering in `runTune` |
| `scripts/behavior-audit/consolidate-keywords.ts`                    | Wire new config values into `computeMergeMap`                                                                                   |
| `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts` | Tests for new clustering functions                                                                                              |

---

### Task 1: Add `averageLinkageSimilarity` and `completeLinkageSimilarity` helpers

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-helpers.ts`
- Test: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Write failing tests for linkage similarity helpers**

```typescript
// in tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
// add imports for the new functions at the top

describe('averageLinkageSimilarity', () => {
  test('returns 1 for identical singleton clusters', () => {
    const embs = [new Float64Array([1, 0, 0])]
    const result = averageLinkageSimilarity(embs, [0], [0])
    expect(result).toBeCloseTo(1)
  })

  test('returns correct average for known vectors', () => {
    const s = 1 / Math.sqrt(2)
    const embs = [
      new Float64Array([1, 0]), // 0
      new Float64Array([s, s]), // 1
      new Float64Array([0, 1]), // 2
    ]
    // cluster A = [0,1]: dot(0,1) = s ≈ 0.7071
    // cluster B = [2]: dot(0,2)=0, dot(1,2)=s
    // average = (0 + s) / 2 = s/2
    const result = averageLinkageSimilarity(embs, [0, 1], [2])
    expect(result).toBeCloseTo(s / 2)
  })

  test('returns 0 for orthogonal clusters', () => {
    const embs = [new Float64Array([1, 0, 0]), new Float64Array([0, 1, 0])]
    const result = averageLinkageSimilarity(embs, [0], [1])
    expect(result).toBeCloseTo(0)
  })
})

describe('completeLinkageSimilarity', () => {
  test('returns 1 for identical singleton clusters', () => {
    const embs = [new Float64Array([1, 0, 0])]
    const result = completeLinkageSimilarity(embs, [0], [0])
    expect(result).toBeCloseTo(1)
  })

  test('returns minimum pairwise similarity', () => {
    const s = 1 / Math.sqrt(2)
    const embs = [
      new Float64Array([1, 0]), // 0
      new Float64Array([s, s]), // 1
      new Float64Array([0, 1]), // 2
    ]
    // cluster A = [0,1], B = [2]
    // dot(0,2)=0, dot(1,2)=s
    // complete = min(0, s) = 0
    const result = completeLinkageSimilarity(embs, [0, 1], [2])
    expect(result).toBeCloseTo(0)
  })

  test('returns max when all pairs have same similarity', () => {
    const embs = [new Float64Array([1, 0]), new Float64Array([1, 0])]
    const result = completeLinkageSimilarity(embs, [0], [1])
    expect(result).toBeCloseTo(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: FAIL — `averageLinkageSimilarity` and `completeLinkageSimilarity` are not exported

- [ ] **Step 3: Implement linkage similarity helpers**

Add to `scripts/behavior-audit/consolidate-keywords-helpers.ts` after the `dotProduct` function:

```typescript
export function averageLinkageSimilarity(
  embeddings: readonly Float64Array[],
  clusterA: readonly number[],
  clusterB: readonly number[],
): number {
  if (clusterA.length === 0 || clusterB.length === 0) return 0
  let total = 0
  let count = 0
  for (const i of clusterA) {
    const embI = embeddings[i]
    if (embI === undefined) continue
    for (const j of clusterB) {
      const embJ = embeddings[j]
      if (embJ === undefined) continue
      total += dotProduct(embI, embJ)
      count++
    }
  }
  return count === 0 ? 0 : total / count
}

export function completeLinkageSimilarity(
  embeddings: readonly Float64Array[],
  clusterA: readonly number[],
  clusterB: readonly number[],
): number {
  if (clusterA.length === 0 || clusterB.length === 0) return 0
  let minSim = Infinity
  for (const i of clusterA) {
    const embI = embeddings[i]
    if (embI === undefined) continue
    for (const j of clusterB) {
      const embJ = embeddings[j]
      if (embJ === undefined) continue
      const sim = dotProduct(embI, embJ)
      if (sim < minSim) minSim = sim
    }
  }
  return minSim === Infinity ? 0 : minSim
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-helpers.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "feat(behavior-audit): add average and complete linkage similarity helpers"
```

---

### Task 2: Add `buildClustersAdvanced` with linkage mode support

This replaces `buildClustersNormalized` with a new function that supports all three linkage modes. It uses agglomerative clustering instead of Union-Find when linkage is `average` or `complete`.

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-helpers.ts`
- Test: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Write failing tests for `buildClustersAdvanced`**

```typescript
// in tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
// add imports: buildClustersAdvanced
import type { LinkageMode } from '../../../scripts/behavior-audit/consolidate-keywords-helpers.js'

describe('buildClustersAdvanced', () => {
  const s = 1 / Math.sqrt(2)

  function makeNormalized(vectors: number[][]): Float64Array[] {
    return vectors.map((v) => {
      const arr = new Float64Array(v)
      const mag = Math.sqrt(arr.reduce((sum, x) => sum + x * x, 0))
      if (mag > 0) for (let k = 0; k < arr.length; k++) arr[k] = arr[k]! / mag
      return arr
    })
  }

  test('single linkage matches buildClustersNormalized behavior', () => {
    const embs = makeNormalized([
      [1, 0, 0], // 0
      [s, s, 0], // 1 — cos(0,1)=s
      [0, 1, 0], // 2 — cos(1,2)=s, cos(0,2)=0
    ])
    const single = buildClustersAdvanced(embs, 0.5, 2, 'single')
    const original = buildClustersNormalized(embs, 0.5, 2)
    expect(single).toHaveLength(original.length)
    expect(single[0]!.length).toBe(original[0]!.length)
  })

  test('average linkage prevents transitive chaining', () => {
    // a~b=0.9, b~c=0.9, a~c=0.1
    // average linkage between {a,c} = 0.1, so {a,b,c} won't form
    // because avg({a,b}, {c}) = (0.1+0.9)/2 = 0.5, but we set threshold=0.7
    const embs = makeNormalized([
      [1, 0, 0],
      [0.9, 0.44, 0],
      [0.1, 0.99, 0],
    ])
    const clusters = buildClustersAdvanced(embs, 0.7, 2, 'average')
    // a and b cluster together (cos ≈ 0.9), c stays solo
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.length).toBe(2)
  })

  test('complete linkage is most conservative', () => {
    // Same setup: a~b high, b~c high, a~c low
    const embs = makeNormalized([
      [1, 0, 0],
      [0.9, 0.44, 0],
      [0.1, 0.99, 0],
    ])
    const clusters = buildClustersAdvanced(embs, 0.7, 2, 'complete')
    // complete({a,b},{c}) = min(cos(a,c), cos(b,c))
    // if min < 0.7, only {a,b} forms
    expect(clusters).toHaveLength(1)
  })

  test('returns empty for threshold above all similarities', () => {
    const embs = makeNormalized([
      [1, 0],
      [0, 1],
    ])
    const clusters = buildClustersAdvanced(embs, 0.99, 2, 'average')
    expect(clusters).toHaveLength(0)
  })

  test('respects minClusterSize', () => {
    const embs = makeNormalized([
      [1, 0],
      [1, 0],
    ])
    const clusters = buildClustersAdvanced(embs, 0.5, 3, 'average')
    expect(clusters).toHaveLength(0)
  })

  test('single linkage with all identical vectors returns one cluster', () => {
    const embs = makeNormalized([
      [1, 0],
      [1, 0],
      [1, 0],
    ])
    const clusters = buildClustersAdvanced(embs, 0.99, 2, 'single')
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: FAIL — `buildClustersAdvanced` is not exported

- [ ] **Step 3: Define `LinkageMode` type and implement `buildClustersAdvanced`**

Add the type and function to `scripts/behavior-audit/consolidate-keywords-helpers.ts`:

```typescript
export type LinkageMode = 'single' | 'average' | 'complete'

export function buildClustersAdvanced(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: LinkageMode,
): readonly (readonly number[])[] {
  if (linkage === 'single') {
    return buildClustersNormalized(normalizedEmbeddings, threshold, minClusterSize)
  }

  const n = normalizedEmbeddings.length
  if (n === 0) return []

  // Agglomerative clustering: start with singletons, merge closest pair above threshold
  const clusterMap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) clusterMap.set(i, [i])

  const linkageFn = linkage === 'average' ? averageLinkageSimilarity : completeLinkageSimilarity

  let merged = true
  while (merged) {
    merged = false
    let bestSim = -1
    let bestA = -1
    let bestB = -1

    const entries = [...clusterMap.entries()]

    for (let ei = 0; ei < entries.length; ei++) {
      const [idA, membersA] = entries[ei]!
      for (let ej = ei + 1; ej < entries.length; ej++) {
        const [idB, membersB] = entries[ej]!
        const sim = linkageFn(normalizedEmbeddings, membersA, membersB)
        if (sim >= threshold && sim > bestSim) {
          bestSim = sim
          bestA = idA
          bestB = idB
          merged = true
        }
      }
    }

    if (merged && bestA >= 0 && bestB >= 0) {
      const clusterA = clusterMap.get(bestA)!
      const clusterB = clusterMap.get(bestB)!
      clusterMap.set(bestA, [...clusterA, ...clusterB])
      clusterMap.delete(bestB)
    }
  }

  return [...clusterMap.values()].filter((g) => g.length >= minClusterSize)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-helpers.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "feat(behavior-audit): add buildClustersAdvanced with average and complete linkage"
```

---

### Task 3: Add `subdivideOversizedClusters` for iterative re-clustering

This is the core of the "gradually increase threshold" strategy. When clusters exceed `maxClusterSize`, they get re-clustered at a higher threshold. This repeats until all clusters are within size or we hit a maximum threshold ceiling.

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-helpers.ts`
- Test: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Write failing tests for `subdivideOversizedClusters`**

```typescript
// in tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
// add import: subdivideOversizedClusters

describe('subdivideOversizedClusters', () => {
  function makeNormalized(vectors: number[][]): Float64Array[] {
    return vectors.map((v) => {
      const arr = new Float64Array(v)
      const mag = Math.sqrt(arr.reduce((sum, x) => sum + x * x, 0))
      if (mag > 0) for (let k = 0; k < arr.length; k++) arr[k] = arr[k]! / mag
      return arr
    })
  }

  test('returns clusters unchanged when all are within maxClusterSize', () => {
    const embs = makeNormalized([
      [1, 0],
      [0.99, 0.14],
      [0, 1],
    ])
    const clusters = [[0, 1]]
    const result = subdivideOversizedClusters(embs, clusters, 5, 'single', 0.01)
    expect(result).toEqual(clusters)
  })

  test('splits an oversized cluster by re-clustering at higher threshold', () => {
    // 5 nearly-identical vectors that form one big cluster at low threshold
    const embs = makeNormalized([
      [1, 0],
      [0.99, 0.14],
      [0.98, 0.2],
      [0.5, 0.87],
      [0, 1],
    ])
    const clusters = [[0, 1, 2, 3, 4]]
    // maxClusterSize=2 — must split
    const result = subdivideOversizedClusters(embs, clusters, 2, 'single', 0.01)
    // Should produce multiple smaller clusters
    for (const cluster of result) {
      expect(cluster.length).toBeLessThanOrEqual(2)
    }
  })

  test('keeps singletons as-is when cluster cannot be split further', () => {
    // 3 identical vectors — no threshold will split them
    const embs = makeNormalized([
      [1, 0],
      [1, 0],
      [1, 0],
    ])
    const clusters = [[0, 1, 2]]
    // Even at threshold 0.999 they stay together; should still return them
    // but split into singletons if threshold step reaches ceiling
    const result = subdivideOversizedClusters(embs, clusters, 2, 'single', 0.05)
    // Identical vectors can't be split by threshold; they remain oversized
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(3)
  })

  test('does not recurse infinitely — stops when threshold reaches 1.0', () => {
    const embs = makeNormalized([
      [1, 0],
      [0.99, 0.14],
      [0.98, 0.2],
    ])
    const clusters = [[0, 1, 2]]
    const result = subdivideOversizedClusters(embs, clusters, 2, 'average', 0.1)
    // Should terminate without hanging
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: FAIL — `subdivideOversizedClusters` is not exported

- [ ] **Step 3: Implement `subdivideOversizedClusters`**

Add to `scripts/behavior-audit/consolidate-keywords-helpers.ts`:

```typescript
export function subdivideOversizedClusters(
  normalizedEmbeddings: readonly Float64Array[],
  clusters: readonly (readonly number[])[],
  maxClusterSize: number,
  linkage: LinkageMode,
  thresholdStep: number,
): readonly (readonly number[])[] {
  let currentClusters = clusters.map((c) => [...c])

  for (;;) {
    const oversized = currentClusters.filter((c) => c.length > maxClusterSize)
    if (oversized.length === 0) break

    // Find the lowest threshold needed for the next split
    // Start from current threshold and increase by step each round
    // We track a per-cluster threshold, starting from the cluster's internal min-sim
    let changed = false
    const result: number[][] = []

    for (const cluster of currentClusters) {
      if (cluster.length <= maxClusterSize) {
        result.push(cluster)
        continue
      }

      // Find the minimum pairwise similarity within this cluster
      let minSim = Infinity
      for (let i = 0; i < cluster.length; i++) {
        const embI = normalizedEmbeddings[cluster[i]!]
        if (embI === undefined) continue
        for (let j = i + 1; j < cluster.length; j++) {
          const embJ = normalizedEmbeddings[cluster[j]!]
          if (embJ === undefined) continue
          const sim = dotProduct(embI, embJ)
          if (sim < minSim) minSim = sim
        }
      }

      // Re-cluster at one step above the minimum similarity
      // This guarantees at least one split (the weakest link breaks)
      const subThreshold = minSim === Infinity ? 1.0 : Math.min(minSim + thresholdStep, 1.0)
      const subEmbeddings = cluster.map((idx) => normalizedEmbeddings[idx]!)

      // Re-index: map local indices back to global
      let subClusters: readonly (readonly number[])[]
      if (subThreshold >= 1.0) {
        // Can't split further — identical or near-identical vectors
        subClusters = [cluster.map((_, i) => i)]
      } else {
        subClusters = buildClustersAdvanced(subEmbeddings, subThreshold, 1, linkage)
      }

      if (subClusters.length === 1 && subClusters[0]!.length === cluster.length) {
        // No split happened — accept as-is (identical embeddings)
        result.push(cluster)
      } else {
        changed = true
        for (const sub of subClusters) {
          result.push(sub.map((localIdx) => cluster[localIdx]!))
        }
      }
    }

    if (!changed) break
    currentClusters = result
  }

  return currentClusters
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-helpers.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "feat(behavior-audit): add subdivideOversizedClusters for iterative threshold increase"
```

---

### Task 4: Add gap threshold filter to clustering

The gap threshold prevents borderline merges: a merge only happens if the similarity between the two clusters exceeds the best alternative by at least `gapThreshold`.

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-helpers.ts`
- Test: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Write failing test for gap threshold in `buildClustersAdvanced`**

Add `gapThreshold` parameter (default 0) to `buildClustersAdvanced`:

```typescript
// in tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts

describe('buildClustersAdvanced gap threshold', () => {
  function makeNormalized(vectors: number[][]): Float64Array[] {
    return vectors.map((v) => {
      const arr = new Float64Array(v)
      const mag = Math.sqrt(arr.reduce((sum, x) => sum + x * x, 0))
      if (mag > 0) for (let k = 0; k < arr.length; k++) arr[k] = arr[k]! / mag
      return arr
    })
  }

  test('gap threshold prevents merge when similarity is close to alternatives', () => {
    // a is equally similar to b and c; gap is ~0
    // Without gap: a merges with b (just above threshold)
    // With gap=0.2: a does NOT merge with b (gap too small)
    const embs = makeNormalized([
      [1, 0, 0], // 0: a
      [0.85, 0.53, 0], // 1: b — cos(a,b) ≈ 0.85
      [0.85, -0.53, 0], // 2: c — cos(a,c) ≈ 0.85
    ])
    // cos(a,b) ≈ 0.85, cos(a,c) ≈ 0.85 — gap is ~0
    // Without gap, a merges with b at threshold 0.8
    const noGap = buildClustersAdvanced(embs, 0.8, 2, 'single', 0)
    expect(noGap.length).toBeGreaterThanOrEqual(1)

    // With gap=0.2, a should not merge because gap between best and second-best is ~0
    const withGap = buildClustersAdvanced(embs, 0.8, 2, 'single', 0.2)
    // All remain solo or only one pair merges
    expect(withGap.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: FAIL — `buildClustersAdvanced` does not accept 5 arguments

- [ ] **Step 3: Add `gapThreshold` parameter to `buildClustersAdvanced`**

Update the function signature and add gap logic. For single-linkage mode, the gap is applied per-element: an element only joins a cluster if its best similarity to that cluster exceeds its best similarity to any other cluster by at least `gapThreshold`. For average/complete linkage, the gap is applied at merge-decision time.

Replace the existing `buildClustersAdvanced` function:

```typescript
export function buildClustersAdvanced(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: LinkageMode,
  gapThreshold: number = 0,
): readonly (readonly number[])[] {
  if (gapThreshold <= 0) {
    return buildClustersAdvancedNoGap(normalizedEmbeddings, threshold, minClusterSize, linkage)
  }

  const n = normalizedEmbeddings.length
  if (n === 0) return []

  if (linkage === 'single') {
    return buildClustersSingleWithGap(normalizedEmbeddings, threshold, minClusterSize, gapThreshold)
  }

  // Agglomerative with gap: only merge if sim(A,B) - sim(A, nextBest) >= gapThreshold
  const clusterMap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) clusterMap.set(i, [i])

  const linkageFn = linkage === 'average' ? averageLinkageSimilarity : completeLinkageSimilarity

  let merged = true
  while (merged) {
    merged = false
    let bestSim = -1
    let bestA = -1
    let bestB = -1

    const entries = [...clusterMap.entries()]

    for (let ei = 0; ei < entries.length; ei++) {
      const [idA, membersA] = entries[ei]!
      for (let ej = ei + 1; ej < entries.length; ej++) {
        const [idB, membersB] = entries[ej]!
        const sim = linkageFn(normalizedEmbeddings, membersA, membersB)
        if (sim >= threshold && sim > bestSim) {
          bestSim = sim
          bestA = idA
          bestB = idB
        }
      }
    }

    if (bestA >= 0 && bestB >= 0 && bestSim >= threshold) {
      // Check gap: is bestSim sufficiently better than the next-best merge for either cluster?
      const membersA = clusterMap.get(bestA)!
      const membersB = clusterMap.get(bestB)!
      let nextBestSim = -1
      for (const [id, members] of clusterMap) {
        if (id === bestA || id === bestB) continue
        const simA = linkageFn(normalizedEmbeddings, membersA, members)
        const simB = linkageFn(normalizedEmbeddings, membersB, members)
        if (simA > nextBestSim) nextBestSim = simA
        if (simB > nextBestSim) nextBestSim = simB
      }
      if (bestSim - nextBestSim >= gapThreshold) {
        clusterMap.set(bestA, [...membersA, ...membersB])
        clusterMap.delete(bestB)
        merged = true
      } else {
        merged = false
      }
    }
  }

  return [...clusterMap.values()].filter((g) => g.length >= minClusterSize)
}
```

Also add `buildClustersAdvancedNoGap` (the old body) and `buildClustersSingleWithGap`:

```typescript
function buildClustersAdvancedNoGap(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: LinkageMode,
): readonly (readonly number[])[] {
  if (linkage === 'single') {
    return buildClustersNormalized(normalizedEmbeddings, threshold, minClusterSize)
  }

  const n = normalizedEmbeddings.length
  if (n === 0) return []

  const clusterMap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) clusterMap.set(i, [i])

  const linkageFn = linkage === 'average' ? averageLinkageSimilarity : completeLinkageSimilarity

  let merged = true
  while (merged) {
    merged = false
    let bestSim = -1
    let bestA = -1
    let bestB = -1

    const entries = [...clusterMap.entries()]

    for (let ei = 0; ei < entries.length; ei++) {
      const [idA, membersA] = entries[ei]!
      for (let ej = ei + 1; ej < entries.length; ej++) {
        const [idB, membersB] = entries[ej]!
        const sim = linkageFn(normalizedEmbeddings, membersA, membersB)
        if (sim >= threshold && sim > bestSim) {
          bestSim = sim
          bestA = idA
          bestB = idB
          merged = true
        }
      }
    }

    if (merged && bestA >= 0 && bestB >= 0) {
      const clusterA = clusterMap.get(bestA)!
      const clusterB = clusterMap.get(bestB)!
      clusterMap.set(bestA, [...clusterA, ...clusterB])
      clusterMap.delete(bestB)
    }
  }

  return [...clusterMap.values()].filter((g) => g.length >= minClusterSize)
}

function buildClustersSingleWithGap(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  gapThreshold: number,
): readonly (readonly number[])[] {
  const n = normalizedEmbeddings.length

  // Pre-compute all pairwise similarities
  const sims = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    const embI = normalizedEmbeddings[i]
    if (embI === undefined) continue
    for (let j = i + 1; j < n; j++) {
      const embJ = normalizedEmbeddings[j]
      if (embJ === undefined) continue
      const sim = dotProduct(embI, embJ)
      sims[i * n + j] = sim
      sims[j * n + i] = sim
    }
  }

  // For each element, find best and second-best similarity to any other element
  const clusterMap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) clusterMap.set(i, [i])

  // Sort candidate pairs by similarity (descending)
  const pairs: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = sims[i * n + j]!
      if (sim >= threshold) pairs.push([i, j, sim])
    }
  }
  pairs.sort((a, b) => b[2] - a[2])

  for (const [i, j, sim] of pairs) {
    // Find current clusters for i and j
    let rootI = -1
    let rootJ = -1
    for (const [root, members] of clusterMap) {
      if (members.includes(i)) rootI = root
      if (members.includes(j)) rootJ = root
    }
    if (rootI === rootJ) continue

    // Gap check: is sim(i,j) sufficiently better than i's or j's next-best neighbor?
    const membersI = clusterMap.get(rootI)!
    const membersJ = clusterMap.get(rootJ)!

    let nextBestI = -1
    let nextBestJ = -1
    for (let k = 0; k < n; k++) {
      if (membersI.includes(k) || membersJ.includes(k)) continue
      const simIk = sims[i * n + k]!
      const simJk = sims[j * n + k]!
      if (simIk > nextBestI) nextBestI = simIk
      if (simJk > nextBestJ) nextBestJ = simJk
    }

    const gapI = nextBestI < 0 ? sim : sim - nextBestI
    const gapJ = nextBestJ < 0 ? sim : sim - nextBestJ
    if (gapI >= gapThreshold && gapJ >= gapThreshold) {
      clusterMap.set(rootI, [...membersI, ...membersJ])
      clusterMap.delete(rootJ)
    }
  }

  return [...clusterMap.values()].filter((g) => g.length >= minClusterSize)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-helpers.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "feat(behavior-audit): add gap threshold to buildClustersAdvanced"
```

---

### Task 5: Add new config exports

**Files:**

- Modify: `scripts/behavior-audit/config.ts`

- [ ] **Step 1: Add new config variables and env var resolution**

Add after the existing `CONSOLIDATION_EMBED_BATCH_SIZE` declaration (line 84):

```typescript
export let CONSOLIDATION_LINKAGE: LinkageMode = 'single'
export let CONSOLIDATION_MAX_CLUSTER_SIZE = 0
export let CONSOLIDATION_GAP_THRESHOLD = 0
```

Add import at the top (after line 1):

```typescript
import type { LinkageMode } from './consolidate-keywords-helpers.js'
```

Add to `reloadBehaviorAuditConfig()` after the existing `CONSOLIDATION_EMBED_BATCH_SIZE` line:

```typescript
const linkageRaw = resolveStringOverride('BEHAVIOR_AUDIT_CONSOLIDATION_LINKAGE', 'single')
CONSOLIDATION_LINKAGE = linkageRaw === 'average' || linkageRaw === 'complete' ? linkageRaw : 'single'
CONSOLIDATION_MAX_CLUSTER_SIZE = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_MAX_CLUSTER_SIZE', 0)
CONSOLIDATION_GAP_THRESHOLD = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_GAP_THRESHOLD', 0)
```

- [ ] **Step 2: Verify config loads without errors**

Run: `bun -e "import './scripts/behavior-audit/config.js'; console.log('OK')"`
Expected: prints `OK`

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/config.ts
git commit -m "feat(behavior-audit): add linkage, maxClusterSize, gapThreshold config"
```

---

### Task 6: Wire new parameters into `tune-embedding.ts`

**Files:**

- Modify: `scripts/behavior-audit/tune-embedding.ts`

- [ ] **Step 1: Update `TuneParams` interface and `parseArgs`**

Update `TuneParams`:

```typescript
import {
  buildClustersAdvanced,
  buildConsolidatedVocabulary,
  buildMergeMap,
  subdivideOversizedClusters,
  toNormalizedFloat64Arrays,
} from './consolidate-keywords-helpers.js'
import type { LinkageMode } from './consolidate-keywords-helpers.js'

interface TuneParams {
  readonly threshold: number
  readonly minClusterSize: number
  readonly maxClusterSize: number
  readonly linkage: LinkageMode
  readonly gapThreshold: number
  readonly reembed: boolean
  readonly cacheDir: string
}
```

Update `parseArgs`:

```typescript
function parseArgs(args: readonly string[]): TuneParams {
  let threshold = 0.92
  let minClusterSize = 2
  let maxClusterSize = 0
  let linkage: LinkageMode = 'single'
  let gapThreshold = 0
  let reembed = false
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const value = args[i + 1]
    if (flag === '--threshold' && value !== undefined) {
      threshold = Number(value)
      i++
    }
    if (flag === '--min-cluster-size' && value !== undefined) {
      minClusterSize = Number(value)
      i++
    }
    if (flag === '--max-cluster-size' && value !== undefined) {
      maxClusterSize = Number(value)
      i++
    }
    if (flag === '--linkage' && value !== undefined) {
      linkage = value === 'average' || value === 'complete' ? value : 'single'
      i++
    }
    if (flag === '--gap-threshold' && value !== undefined) {
      gapThreshold = Number(value)
      i++
    }
    if (flag === '--re-embed') {
      reembed = true
    }
  }
  const cacheDir = join(tmpdir(), 'tune-embed-cache')
  return { threshold, minClusterSize, maxClusterSize, linkage, gapThreshold, reembed, cacheDir }
}
```

- [ ] **Step 2: Update `runTune` to use new clustering pipeline**

Replace the clustering section in `runTune` (lines 139-141):

```typescript
console.log(
  `[tune] Clustering at threshold=${params.threshold}, minClusterSize=${params.minClusterSize}, linkage=${params.linkage}, gap=${params.gapThreshold}, maxClusterSize=${params.maxClusterSize}...`,
)
let clusters = buildClustersAdvanced(
  normalized,
  params.threshold,
  params.minClusterSize,
  params.linkage,
  params.gapThreshold,
)

if (params.maxClusterSize > 0) {
  clusters = subdivideOversizedClusters(normalized, clusters, params.maxClusterSize, params.linkage, 0.01)
}

const mergeMap = buildMergeMap(vocabulary, clusters)
```

- [ ] **Step 3: Update `printSummary` to show new parameters**

Add to `printSummary`:

```typescript
console.log(`  linkage:        ${params.linkage}`)
console.log(`  maxClusterSize: ${params.maxClusterSize > 0 ? params.maxClusterSize : 'none'}`)
console.log(`  gapThreshold:   ${params.gapThreshold}`)
```

- [ ] **Step 4: Verify CLI parses new flags**

Run: `bun scripts/behavior-audit/tune-embedding.ts --help 2>&1 || true`
Then: `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.92 --linkage average --max-cluster-size 20 --gap-threshold 0.05 2>&1 | head -5`
Expected: Shows the new parameter values in the summary header

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/tune-embedding.ts
git commit -m "feat(behavior-audit): wire linkage, maxClusterSize, gapThreshold into tune-embedding CLI"
```

---

### Task 7: Wire new parameters into `consolidate-keywords.ts`

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords.ts`

- [ ] **Step 1: Update `computeMergeMap` to use new config values**

Update the import in `consolidate-keywords.ts` to include new config and new helpers:

```typescript
import {
  CONSOLIDATION_DRY_RUN,
  CONSOLIDATION_GAP_THRESHOLD,
  CONSOLIDATION_LINKAGE,
  CONSOLIDATION_MAX_CLUSTER_SIZE,
  CONSOLIDATION_MIN_CLUSTER_SIZE,
  CONSOLIDATION_THRESHOLD,
  EMBEDDING_CACHE_PATH,
  EMBEDDING_MODEL,
} from './config.js'
```

Update the helper import:

```typescript
import {
  buildClustersAdvanced,
  buildConsolidatedVocabulary,
  buildMergeMap,
  subdivideOversizedClusters,
  toNormalizedFloat64Arrays,
} from './consolidate-keywords-helpers.js'
```

Update `computeMergeMap`:

```typescript
async function computeMergeMap(
  vocabulary: readonly KeywordVocabularyEntry[],
  deps: Pick<Phase1bDeps, 'getOrEmbed' | 'embeddingCachePath' | 'embeddingModel' | 'log'>,
): Promise<ReadonlyMap<string, string>> {
  const embeddingData = await deps.getOrEmbed(deps.embeddingCachePath, deps.embeddingModel, vocabulary, {
    embedSlugBatch,
    log: deps.log,
  })
  const normalized = toNormalizedFloat64Arrays(embeddingData.normalized)
  deps.log.log(
    `[Phase 1b] Clustering at threshold ${CONSOLIDATION_THRESHOLD}, linkage=${CONSOLIDATION_LINKAGE}, maxClusterSize=${CONSOLIDATION_MAX_CLUSTER_SIZE}, gap=${CONSOLIDATION_GAP_THRESHOLD}...`,
  )
  let clusters = buildClustersAdvanced(
    normalized,
    CONSOLIDATION_THRESHOLD,
    CONSOLIDATION_MIN_CLUSTER_SIZE,
    CONSOLIDATION_LINKAGE,
    CONSOLIDATION_GAP_THRESHOLD,
  )
  if (CONSOLIDATION_MAX_CLUSTER_SIZE > 0) {
    clusters = subdivideOversizedClusters(
      normalized,
      clusters,
      CONSOLIDATION_MAX_CLUSTER_SIZE,
      CONSOLIDATION_LINKAGE,
      0.01,
    )
  }
  return buildMergeMap(vocabulary, clusters)
}
```

- [ ] **Step 2: Run existing tests to verify nothing breaks**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords.ts
git commit -m "feat(behavior-audit): wire new clustering params into consolidation pipeline"
```

---

### Task 8: Run full verification

- [ ] **Step 1: Run the helpers test suite**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
Expected: PASS

- [ ] **Step 2: Run full typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `bun lint`
Expected: PASS

- [ ] **Step 4: Run the full behavior-audit test suite**

Run: `bun test tests/scripts/behavior-audit/`
Expected: PASS

- [ ] **Step 5: Test the CLI with real data using default (single linkage, no max, no gap)**

Run: `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.9`
Expected: Same results as before (backward compatible)

- [ ] **Step 6: Test with average linkage + max-cluster-size**

Run: `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.9 --linkage average --max-cluster-size 20`
Expected: Fewer giant clusters, more final keywords than single-linkage at same threshold

- [ ] **Step 7: Test with all new parameters**

Run: `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.9 --linkage average --max-cluster-size 20 --gap-threshold 0.05`
Expected: Even more conservative merge map, inspect for quality
