# Embedding Clustering Followups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining embedding-clustering correctness and scalability findings: Phase 1b embedding identity invalidation, practical `average`/`complete` linkage runtime, and strict pairwise single-linkage gap semantics.

**Architecture:** Persist all Phase 1b inputs that affect clustering so completed runs are skipped only when the embedding identity and clustering controls match. Replace the naive agglomerative implementation with an exact nearest-neighbor-chain HAC implementation for `average` and `complete` linkage using a mutable condensed distance matrix and Lance-Williams updates. Tighten `single` + `gapThreshold` so every accepted edge checks alternatives against all other points, including points already inside either cluster.

**Tech Stack:** TypeScript, Bun test runner, Float64Array/Float32Array numeric arrays, existing behavior-audit test helpers

---

## Research Notes

- `average` and `complete` linkage are reducible agglomerative clustering criteria supported by nearest-neighbor-chain HAC. This is the same algorithm family used by fast hierarchical clustering implementations such as `fastcluster`.
- Use distance internally: `distance = 1 - cosineSimilarity`. Existing public APIs stay similarity-threshold based.
- For `average` distance update after merging `A` and `B` into `AB`: `d(AB,C) = (|A| * d(A,C) + |B| * d(B,C)) / (|A| + |B|)`.
- For `complete` distance update after merging `A` and `B` into `AB`: `d(AB,C) = max(d(A,C), d(B,C))`.
- For a candidate merge to satisfy `gapThreshold`, use distance gap: `candidateSimilarity - nextBestSimilarity >= gapThreshold`, equivalent to `nextBestDistance - candidateDistance >= gapThreshold`.
- Bun documentation says `mock.restore()` does not reset modules overridden by `mock.module()`. New tests should use DI or pure helper tests instead of partial module mocks.

## File Structure

| File                                                                 | Responsibility                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `scripts/behavior-audit/progress.ts`                                 | Add persisted Phase 1b embedding identity fields                                                 |
| `scripts/behavior-audit/progress-migrate.ts`                         | Backfill new Phase 1b fields for legacy v5 progress                                              |
| `scripts/behavior-audit/consolidate-keywords.ts`                     | Include embedding identity in Phase 1b skip key and saved checkpoints                            |
| `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts` | Replace naive non-single agglomeration with nearest-neighbor-chain HAC; fix single gap semantics |
| `scripts/behavior-audit/consolidate-keywords-clustering.ts`          | Keep low-level helpers; add exported condensed-index helpers only if tests need them             |
| `tests/scripts/behavior-audit-phase1b.test.ts`                       | Regression tests for embedding identity invalidation                                             |
| `tests/scripts/behavior-audit/progress.test.ts`                      | Updated `emptyPhase1b()` expectations                                                            |
| `tests/scripts/behavior-audit/progress-migrate.test.ts`              | Legacy v5 migration/backfill tests                                                               |
| `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`  | Clustering correctness, gap semantics, and performance smoke coverage                            |

---

### Task 1: Persist Phase 1b Embedding Identity

**Files:**

- Modify: `scripts/behavior-audit/progress.ts`
- Modify: `scripts/behavior-audit/consolidate-keywords.ts`
- Modify: `tests/scripts/behavior-audit/progress.test.ts`
- Modify: `tests/scripts/behavior-audit-phase1b.test.ts`

- [ ] **Step 1: Add failing Phase 1b invalidation tests**

Add these tests to `tests/scripts/behavior-audit-phase1b.test.ts` after the existing min-cluster-size invalidation test:

```typescript
test('runPhase1b re-runs when embedding model changed despite unchanged vocabulary size', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(`${tag}-embedding-model-changed`)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.threshold = 0.95
  progress.phase1b.minClusterSize = 2
  progress.phase1b.linkage = 'single'
  progress.phase1b.maxClusterSize = 0
  progress.phase1b.gapThreshold = 0
  progress.phase1b.embeddingModel = 'old-embedding-model'
  progress.phase1b.embeddingCachePath = null
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('alpha'), makeVocabEntry('beta')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: (_cachePath, model) => {
      embedCalled = true
      expect(model).toBe('test-embed-model')
      return Promise.resolve({
        raw: [
          [1, 0],
          [0, 1],
        ],
        normalized: [
          [1, 0],
          [0, 1],
        ],
      })
    },
    embeddingCachePath: null,
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(true)
})

test('runPhase1b re-runs when embedding cache path changed despite unchanged vocabulary size', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(`${tag}-embedding-cache-changed`)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.threshold = 0.95
  progress.phase1b.minClusterSize = 2
  progress.phase1b.linkage = 'single'
  progress.phase1b.maxClusterSize = 0
  progress.phase1b.gapThreshold = 0
  progress.phase1b.embeddingModel = 'test-embed-model'
  progress.phase1b.embeddingCachePath = '/old/cache.json'
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: () => Promise.resolve([makeVocabEntry('alpha'), makeVocabEntry('beta')]),
    saveKeywordVocabulary: () => Promise.resolve(),
    getOrEmbed: (cachePath) => {
      embedCalled = true
      expect(cachePath).toBe('/new/cache.json')
      return Promise.resolve({
        raw: [
          [1, 0],
          [0, 1],
        ],
        normalized: [
          [1, 0],
          [0, 1],
        ],
      })
    },
    embeddingCachePath: '/new/cache.json',
    embeddingModel: 'test-embed-model',
    loadManifest: () => Promise.resolve(null),
    remapKeywordsInExtractedFile: () => Promise.resolve({ updated: false, remappedCount: 0 }),
    saveProgress: () => Promise.resolve(),
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(true)
})
```

Also update the existing `runPhase1b skips when already done and vocabulary size unchanged` test to set:

```typescript
progress.phase1b.embeddingModel = 'test-embed-model'
progress.phase1b.embeddingCachePath = null
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit-phase1b.test.ts`

Expected: FAIL with TypeScript/runtime errors because `embeddingModel` and `embeddingCachePath` are not yet part of `Phase1bProgress`, or assertions show the skip still happens.

- [ ] **Step 3: Add embedding identity fields to progress**

In `scripts/behavior-audit/progress.ts`, update `Phase1bProgress`:

```typescript
export interface Phase1bProgress {
  status: PhaseStatus
  lastRunAt: string | null
  threshold: number
  minClusterSize: number
  linkage: LinkageMode
  maxClusterSize: number
  gapThreshold: number
  embeddingModel: string
  embeddingCachePath: string | null
  stats: {
    slugsBefore: number
    slugsAfter: number
    mergesApplied: number
    behaviorsUpdated: number
    keywordsRemapped: number
  }
}
```

Update `emptyPhase1b()`:

```typescript
export function emptyPhase1b(): Phase1bProgress {
  return {
    status: 'not-started',
    lastRunAt: null,
    threshold: 0,
    minClusterSize: 2,
    linkage: 'single',
    maxClusterSize: 0,
    gapThreshold: 0,
    embeddingModel: '',
    embeddingCachePath: null,
    stats: { slugsBefore: 0, slugsAfter: 0, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
  }
}
```

- [ ] **Step 4: Update Phase 1b save and skip logic**

In `scripts/behavior-audit/consolidate-keywords.ts`, update `markDoneAndSave()` signature to accept embedding identity:

```typescript
async function markDoneAndSave(
  progress: Progress,
  threshold: number,
  slugsBefore: number,
  now: string,
  deps: Pick<Phase1bDeps, 'saveProgress' | 'embeddingModel' | 'embeddingCachePath'>,
): Promise<void> {
  progress.phase1b = {
    status: 'done',
    lastRunAt: now,
    threshold,
    minClusterSize: CONSOLIDATION_MIN_CLUSTER_SIZE,
    linkage: CONSOLIDATION_LINKAGE,
    maxClusterSize: CONSOLIDATION_MAX_CLUSTER_SIZE,
    gapThreshold: CONSOLIDATION_GAP_THRESHOLD,
    embeddingModel: deps.embeddingModel,
    embeddingCachePath: deps.embeddingCachePath,
    stats: { slugsBefore, slugsAfter: slugsBefore, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
  }
  await deps.saveProgress(progress)
}
```

Update `shouldSkipCompletedPhase1b()`:

```typescript
function shouldSkipCompletedPhase1b(progress: Progress, slugsBefore: number, deps: Phase1bDeps): boolean {
  return (
    progress.phase1b.status === 'done' &&
    slugsBefore === progress.phase1b.stats.slugsBefore &&
    CONSOLIDATION_THRESHOLD === progress.phase1b.threshold &&
    CONSOLIDATION_MIN_CLUSTER_SIZE === progress.phase1b.minClusterSize &&
    CONSOLIDATION_LINKAGE === progress.phase1b.linkage &&
    CONSOLIDATION_MAX_CLUSTER_SIZE === progress.phase1b.maxClusterSize &&
    CONSOLIDATION_GAP_THRESHOLD === progress.phase1b.gapThreshold &&
    deps.embeddingModel === progress.phase1b.embeddingModel &&
    deps.embeddingCachePath === progress.phase1b.embeddingCachePath
  )
}
```

Update the call site:

```typescript
if (!CONSOLIDATION_DRY_RUN && shouldSkipCompletedPhase1b(progress, vocabulary.length, deps)) {
  deps.log.log('[Phase 1b] Already complete, skipping.\n')
  return
}
```

Update `applyMergesAndSave()` progress assignment to include:

```typescript
embeddingModel: deps.embeddingModel,
embeddingCachePath: deps.embeddingCachePath,
```

- [ ] **Step 5: Update progress expectations**

In `tests/scripts/behavior-audit/progress.test.ts`, update any `emptyPhase1b()` expectation to include:

```typescript
embeddingModel: '',
embeddingCachePath: null,
```

- [ ] **Step 6: Run targeted tests**

Run: `bun test tests/scripts/behavior-audit-phase1b.test.ts tests/scripts/behavior-audit/progress.test.ts`

Expected: PASS for Phase 1b/progress tests or migration schema failures that Task 2 will fix.

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/progress.ts scripts/behavior-audit/consolidate-keywords.ts tests/scripts/behavior-audit-phase1b.test.ts tests/scripts/behavior-audit/progress.test.ts
git commit -m "fix(behavior-audit): invalidate phase1b when embedding identity changes"
```

---

### Task 2: Backfill Embedding Identity in Progress Migration

**Files:**

- Modify: `scripts/behavior-audit/progress-migrate.ts`
- Modify: `tests/scripts/behavior-audit/progress-migrate.test.ts`
- Modify: fixture tests only if TypeScript requires complete `Progress` literals

- [ ] **Step 1: Add failing legacy v5 migration test**

In `tests/scripts/behavior-audit/progress-migrate.test.ts`, add a test shaped like the existing legacy v5 tests:

```typescript
test('validateOrMigrateProgress backfills embedding identity for legacy v5 phase1b', () => {
  const raw = {
    version: 5,
    startedAt: '2026-01-01T00:00:00.000Z',
    phase1: {
      status: 'done',
      completedTests: {},
      failedTests: {},
      completedFiles: ['tests/foo.test.ts'],
      stats: { filesTotal: 1, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
    },
    phase1b: {
      status: 'done',
      lastRunAt: '2026-01-02T00:00:00.000Z',
      threshold: 0.9,
      minClusterSize: 2,
      linkage: 'average',
      maxClusterSize: 20,
      gapThreshold: 0.05,
      stats: { slugsBefore: 10, slugsAfter: 8, mergesApplied: 2, behaviorsUpdated: 1, keywordsRemapped: 3 },
    },
    phase2a: emptyPhase2a(),
    phase2b: emptyPhase2b(),
    phase3: emptyPhase3(),
  }

  const migrated = validateOrMigrateProgress(raw)

  expect(migrated?.phase1.completedFiles).toEqual(['tests/foo.test.ts'])
  expect(migrated?.phase1b.embeddingModel).toBe('')
  expect(migrated?.phase1b.embeddingCachePath).toBeNull()
  expect(migrated?.phase1b.linkage).toBe('average')
})
```

- [ ] **Step 2: Run migration test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/progress-migrate.test.ts`

Expected: FAIL because strict `Phase1bCheckpointSchema` now requires embedding identity but legacy schema does not backfill it yet.

- [ ] **Step 3: Update migration schemas**

In `scripts/behavior-audit/progress-migrate.ts`, add fields to `Phase1bCheckpointSchema`:

```typescript
embeddingModel: z.string(),
embeddingCachePath: z.string().nullable(),
```

Replace the single `LegacyPhase1bCheckpointSchema` with a partial schema that accepts legacy v5 records missing any newer Phase 1b fields:

```typescript
const LegacyPhase1bCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  lastRunAt: z.string().nullable(),
  threshold: z.number(),
  minClusterSize: z.number().optional(),
  linkage: z.enum(['single', 'average', 'complete']).optional(),
  maxClusterSize: z.number().optional(),
  gapThreshold: z.number().optional(),
  embeddingModel: z.string().optional(),
  embeddingCachePath: z.string().nullable().optional(),
  stats: z.object({
    slugsBefore: z.number(),
    slugsAfter: z.number(),
    mergesApplied: z.number(),
    behaviorsUpdated: z.number(),
    keywordsRemapped: z.number(),
  }),
})
```

The existing `toVersion5Progress()` spread with `emptyPhase1b()` will backfill missing optional fields.

- [ ] **Step 4: Run migration/progress tests**

Run: `bun test tests/scripts/behavior-audit/progress-migrate.test.ts tests/scripts/behavior-audit/progress.test.ts`

Expected: PASS.

- [ ] **Step 5: Run typecheck for fixture fallout**

Run: `bun typecheck`

Expected: PASS. If it fails on inline `Progress` fixtures, add `embeddingModel: ''` and `embeddingCachePath: null` to those `phase1b` literals.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/progress-migrate.ts tests/scripts/behavior-audit/progress-migrate.test.ts tests/scripts/behavior-audit/progress.test.ts
git commit -m "fix(behavior-audit): backfill phase1b embedding identity during progress migration"
```

---

### Task 3: Add Condensed Distance Matrix Helpers

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Add focused tests for distance indexing and update math**

Add tests under a new `describe('nearest-neighbor-chain distance helpers', ...)` block in `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts` only if helpers are exported. If helpers stay private, skip direct helper tests and add the parity tests in Task 4 instead.

Preferred approach: keep these helpers private and validate them through Task 4 clustering parity tests. Do not export internals unless needed.

- [ ] **Step 2: Add private condensed distance helpers**

In `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`, add these private helpers near the top:

```typescript
type MutableDistanceMatrix = {
  readonly n: number
  readonly values: Float32Array
}

function condensedIndex(i: number, j: number, n: number): number {
  const a = Math.min(i, j)
  const b = Math.max(i, j)
  return (a * (2 * n - a - 1)) / 2 + (b - a - 1)
}

function getDistance(matrix: MutableDistanceMatrix, i: number, j: number): number {
  if (i === j) return 0
  return matrix.values[condensedIndex(i, j, matrix.n)] ?? Infinity
}

function setDistance(matrix: MutableDistanceMatrix, i: number, j: number, distance: number): void {
  if (i === j) return
  matrix.values[condensedIndex(i, j, matrix.n)] = distance
}

function buildCondensedDistanceMatrix(normalizedEmbeddings: readonly Float64Array[]): MutableDistanceMatrix {
  const n = normalizedEmbeddings.length
  const values = new Float32Array((n * (n - 1)) / 2)
  for (let i = 0; i < n; i++) {
    const embI = normalizedEmbeddings[i]
    if (embI === undefined) continue
    for (let j = i + 1; j < n; j++) {
      const embJ = normalizedEmbeddings[j]
      const similarity = embJ === undefined ? 0 : dotProduct(embI, embJ)
      values[condensedIndex(i, j, n)] = 1 - similarity
    }
  }
  return { n, values }
}
```

Mutation inside `MutableDistanceMatrix` is intentional for numeric performance; keep it contained to this module.

- [ ] **Step 3: Add active-cluster helpers**

Add these helpers:

```typescript
type ActiveState = {
  readonly active: Uint8Array
  readonly sizes: Uint32Array
}

function createActiveState(n: number): ActiveState {
  return {
    active: Uint8Array.from({ length: n }, () => 1),
    sizes: Uint32Array.from({ length: n }, () => 1),
  }
}

function activeIndices(state: ActiveState): readonly number[] {
  return Array.from(state.active.entries()).flatMap(([index, isActive]) => (isActive === 1 ? [index] : []))
}

function isActive(state: ActiveState, index: number): boolean {
  return state.active[index] === 1
}
```

- [ ] **Step 4: Verify no behavior changed**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

Expected: PASS. No public behavior should change yet.

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "refactor(behavior-audit): add condensed distance helpers for advanced clustering"
```

---

### Task 4: Replace Naive Average/Complete Linkage with Nearest-Neighbor-Chain HAC

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Add small-fixture parity tests before replacing implementation**

In `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`, add a local naive reference implementation inside the test file:

```typescript
function naiveAverageOrCompleteClusters(
  embeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: 'average' | 'complete',
): readonly (readonly number[])[] {
  const linkageFn = linkage === 'average' ? averageLinkageSimilarity : completeLinkageSimilarity
  let clusters: readonly (readonly number[])[] = embeddings.map((_, index) => [index])
  for (;;) {
    const candidates = clusters.flatMap((clusterA, i) =>
      clusters.slice(i + 1).flatMap((clusterB, offset) => {
        const j = i + offset + 1
        const similarity = linkageFn(embeddings, clusterA, clusterB)
        return similarity >= threshold ? [{ i, j, similarity }] : []
      }),
    )
    const best = candidates.toSorted((a, b) => b.similarity - a.similarity)[0]
    if (best === undefined) return clusters.filter((cluster) => cluster.length >= minClusterSize)
    const clusterA = clusters[best.i]!
    const clusterB = clusters[best.j]!
    clusters = clusters.flatMap((cluster, index) => {
      if (index === best.i) return [[...clusterA, ...clusterB]]
      return index === best.j ? [] : [cluster]
    })
  }
}
```

Add parity tests:

```typescript
test('average linkage matches naive reference on a deterministic small fixture', () => {
  const embs = makeNormalized([
    [1, 0, 0],
    [0.96, 0.28, 0],
    [0.88, 0.47, 0],
    [0, 1, 0],
    [0, 0.95, 0.31],
  ])
  const actual = buildClustersAdvanced(embs, 0.78, 2, 'average', 0)
  const expected = naiveAverageOrCompleteClusters(embs, 0.78, 2, 'average')
  expect(actual.map((c) => [...c].toSorted())).toEqual(expected.map((c) => [...c].toSorted()))
})

test('complete linkage matches naive reference on a deterministic small fixture', () => {
  const embs = makeNormalized([
    [1, 0, 0],
    [0.96, 0.28, 0],
    [0.88, 0.47, 0],
    [0, 1, 0],
    [0, 0.95, 0.31],
  ])
  const actual = buildClustersAdvanced(embs, 0.78, 2, 'complete', 0)
  const expected = naiveAverageOrCompleteClusters(embs, 0.78, 2, 'complete')
  expect(actual.map((c) => [...c].toSorted())).toEqual(expected.map((c) => [...c].toSorted()))
})
```

- [ ] **Step 2: Run tests before implementation**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

Expected: PASS before replacing the implementation, proving the parity test matches current behavior on small inputs.

- [ ] **Step 3: Implement nearest-neighbor-chain helpers**

In `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`, add:

```typescript
function findNearestActiveCluster(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  cluster: number,
  blockedPairs: ReadonlySet<string>,
): number | undefined {
  const nearest = activeIndices(state)
    .filter((candidate) => candidate !== cluster)
    .filter((candidate) => !blockedPairs.has(pairKey(cluster, candidate)))
    .map((candidate) => ({ candidate, distance: getDistance(matrix, cluster, candidate) }))
    .toSorted((a, b) => a.distance - b.distance || a.candidate - b.candidate)[0]
  return nearest?.candidate
}

function pairKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`
}

function isMutualNearest(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  a: number,
  b: number,
  blockedPairs: ReadonlySet<string>,
): boolean {
  return findNearestActiveCluster(matrix, state, b, blockedPairs) === a
}

function updateMergedDistances(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  survivor: number,
  removed: number,
  linkage: Exclude<LinkageMode, 'single'>,
): void {
  const survivorSize = state.sizes[survivor] ?? 0
  const removedSize = state.sizes[removed] ?? 0
  for (const other of activeIndices(state)) {
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
}
```

- [ ] **Step 4: Replace `buildClustersNonSingle`**

Replace the existing `buildClustersNonSingle()` body with nearest-neighbor-chain logic:

```typescript
function buildClustersNonSingle(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: Exclude<LinkageMode, 'single'>,
  gapThreshold: number,
): readonly Cluster[] {
  const n = normalizedEmbeddings.length
  if (n === 0) return []
  const maxDistance = 1 - threshold
  const matrix = buildCondensedDistanceMatrix(normalizedEmbeddings)
  const state = createActiveState(n)
  const members = new Map<number, readonly number[]>(normalizedEmbeddings.map((_, index) => [index, [index]]))
  let blockedPairs = new Set<string>()

  for (;;) {
    const active = activeIndices(state)
    if (active.length <= 1) break

    const chain: number[] = []
    let mergedThisRound = false

    for (;;) {
      const current = chain.at(-1) ?? active[0]!
      if (chain.length === 0) chain.push(current)
      const nearest = findNearestActiveCluster(matrix, state, current, blockedPairs)
      if (nearest === undefined) break
      const distance = getDistance(matrix, current, nearest)
      if (distance > maxDistance) break

      if (chain.length > 1 && nearest === chain[chain.length - 2]) {
        const a = Math.min(current, nearest)
        const b = Math.max(current, nearest)
        if (!mergePassesGap(matrix, state, a, b, gapThreshold)) {
          blockedPairs = new Set([...blockedPairs, pairKey(a, b)])
          break
        }
        const mergedMembers = [...(members.get(a) ?? []), ...(members.get(b) ?? [])]
        members.set(a, mergedMembers)
        members.delete(b)
        updateMergedDistances(matrix, state, a, b, linkage)
        blockedPairs = new Set<string>()
        mergedThisRound = true
        break
      }
      chain.push(nearest)
    }

    if (!mergedThisRound) {
      const hasCandidate = active.some((a) =>
        active.some((b) => a < b && getDistance(matrix, a, b) <= maxDistance && !blockedPairs.has(pairKey(a, b))),
      )
      if (!hasCandidate) break
    }
  }

  return filterClusters(
    [...members.entries()].filter(([id]) => isActive(state, id)).map(([, cluster]) => cluster),
    minClusterSize,
  )
}
```

Also add `mergePassesGap()`:

```typescript
function mergePassesGap(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  a: number,
  b: number,
  gapThreshold: number,
): boolean {
  if (gapThreshold <= 0) return true
  const candidateDistance = getDistance(matrix, a, b)
  const alternativeDistance = activeIndices(state).reduce((best, candidate) => {
    if (candidate === a || candidate === b) return best
    return Math.min(best, getDistance(matrix, a, candidate), getDistance(matrix, b, candidate))
  }, Infinity)
  if (alternativeDistance === Infinity) return true
  return alternativeDistance - candidateDistance >= gapThreshold
}
```

- [ ] **Step 5: Run parity tests**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

Expected: PASS.

- [ ] **Step 6: Add a non-brittle performance smoke test**

Add this test in `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`:

```typescript
test('average linkage handles hundreds of vectors without timing out', () => {
  const vectors = Array.from({ length: 600 }, (_, i) => {
    const group = Math.floor(i / 20)
    const angle = group * 0.1 + (i % 20) * 0.001
    return [Math.cos(angle), Math.sin(angle), (i % 7) / 100]
  })
  const embs = makeNormalized(vectors)
  const start = performance.now()
  const clusters = buildClustersAdvanced(embs, 0.99, 2, 'average', 0)
  const elapsed = performance.now() - start
  expect(clusters.length).toBeGreaterThan(0)
  expect(elapsed).toBeLessThan(5000)
})
```

The threshold is intentionally generous. This catches catastrophic cubic behavior without making the suite depend on sub-second timing.

- [ ] **Step 7: Run targeted performance test**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts -t "average linkage handles hundreds"`

Expected: PASS under 5 seconds on the local machine.

- [ ] **Step 8: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "perf(behavior-audit): replace non-single linkage clustering with nearest-neighbor chain"
```

---

### Task 5: Tighten Single-Linkage Gap Semantics

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

- [ ] **Step 1: Add failing regression tests for pairwise-entry gate**

Add tests under `buildClustersAdvanced gap threshold`:

```typescript
test('single linkage gap considers alternatives already inside current clusters', () => {
  const embs = makeNormalized([
    [1, 0, 0], // 0
    [0.96, 0.28, 0], // 1 close to 0
    [0.95, 0.31, 0], // 2 ambiguous alternative for 1, can enter cluster first
    [0, 1, 0], // 3 unrelated
  ])
  const withoutGap = buildClustersAdvanced(embs, 0.9, 2, 'single', 0)
  expect(withoutGap.some((cluster) => cluster.length >= 3)).toBe(true)

  const withGap = buildClustersAdvanced(embs, 0.9, 2, 'single', 0.05)
  for (const cluster of withGap) {
    expect(cluster.length).toBeLessThan(3)
  }
})

test('single linkage gap rejection does not stop later unambiguous pairs', () => {
  const embs = makeNormalized([
    [1, 0, 0],
    [0.96, 0.28, 0],
    [0.95, 0.31, 0],
    [0, 1, 0],
    [0, 0.99, 0.1],
  ])
  const clusters = buildClustersAdvanced(embs, 0.9, 2, 'single', 0.05)
  expect(clusters.some((cluster) => cluster.includes(3) && cluster.includes(4))).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts -t "single linkage gap"`

Expected: At least the first new test fails with current cluster-exclusion behavior.

- [ ] **Step 3: Replace cluster-contextual next-best helper with pairwise helper**

In `scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts`, replace `findNextBestSimilarity()` with:

```typescript
function findNextBestPairwiseSimilarity(
  normalizedEmbeddings: readonly Float64Array[],
  item: number,
  pairedItem: number,
): number {
  return normalizedEmbeddings.reduce((bestSimilarity, embedding, otherIndex) => {
    if (otherIndex === item || otherIndex === pairedItem) return bestSimilarity
    const itemEmbedding = normalizedEmbeddings[item]
    if (itemEmbedding === undefined) return bestSimilarity
    return Math.max(bestSimilarity, dotProduct(itemEmbedding, embedding))
  }, Number.NEGATIVE_INFINITY)
}
```

Update `buildClustersSingleWithGap()`:

```typescript
const gapI = similarity - findNextBestPairwiseSimilarity(normalizedEmbeddings, itemI, itemJ)
const gapJ = similarity - findNextBestPairwiseSimilarity(normalizedEmbeddings, itemJ, itemI)
```

Remove the unused `clusterI`/`clusterJ` parameters from that next-best helper. Keep `clusterI` and `clusterJ` only for merge execution and undefined checks.

- [ ] **Step 4: Run targeted tests**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts -t "single linkage gap"`

Expected: PASS.

- [ ] **Step 5: Run full helper tests**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "fix(behavior-audit): enforce pairwise gap checks for single linkage"
```

---

### Task 6: Verify Real-Data Runtime and CLI Behavior

**Files:**

- Modify only if verification reveals a bug

- [ ] **Step 1: Run focused tests**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts tests/scripts/behavior-audit/tune-embedding.test.ts tests/scripts/behavior-audit-phase1b.test.ts tests/scripts/behavior-audit/progress.test.ts tests/scripts/behavior-audit/progress-migrate.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck and lint**

Run: `bun typecheck`

Expected: PASS.

Run: `bun lint`

Expected: PASS.

- [ ] **Step 3: Run full behavior-audit tests**

Run: `bun test tests/scripts/behavior-audit/`

Expected: PASS.

- [ ] **Step 4: Verify default tune behavior**

Run: `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.9`

Expected: Completes with default `linkage: single`, `maxClusterSize: none`, `gapThreshold: 0`. Counts should remain comparable to the previous default baseline: `initial slugs: 7697`, `final slugs: 5261`, `merges applied: 2436`, `reduction: 31.6%` unless extracted data changed.

- [ ] **Step 5: Verify average linkage real-data runtime**

Run: `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.9 --linkage average --max-cluster-size 20`

Expected: Completes. It should no longer time out at the clustering stage. Record `final slugs`, `merges applied`, and `reduction`.

- [ ] **Step 6: Verify average linkage with gap real-data runtime**

Run: `bun scripts/behavior-audit/tune-embedding.ts --threshold 0.9 --linkage average --max-cluster-size 20 --gap-threshold 0.05`

Expected: Completes. It should be more conservative than the no-gap average run or at least not produce more merges. Record `final slugs`, `merges applied`, and `reduction`.

- [ ] **Step 7: Scan forbidden patterns**

Run: `grep -R "eslint-disable\|oxlint-disable\|@ts-ignore\|@ts-nocheck" scripts/behavior-audit tests/scripts/behavior-audit --include="*.ts"`

Expected: no matches in modified files. If unrelated historical matches appear, report them but do not change unrelated files.

- [ ] **Step 8: Commit verification fixes if needed**

If verification required code changes:

```bash
git add <changed-files>
git commit -m "fix(behavior-audit): address clustering followup verification failures"
```

If no code changes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Finding 1 covered by Tasks 1-2: embedding identity persisted, invalidation key updated, migration backfilled, tests added.
- Finding 2 covered by Tasks 3-4 and Task 6: Path C exact nearest-neighbor-chain HAC replaces naive average/complete linkage and real-data runtime is verified.
- Finding 3 covered by Task 5: Option A pairwise-entry gate for every accepted single-linkage edge.
- No new dependencies are planned.
- Tests avoid `mock.module()` for these changes to prevent Bun module-mock pollution.
