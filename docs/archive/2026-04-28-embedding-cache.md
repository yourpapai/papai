# Embedding Cache + Clustering Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist keyword slug embeddings to disk and optimize clustering performance so both the tune-embedding script and the production Phase 1b workflow are fast on repeated runs.

**Architecture:** Two concerns addressed together:

1. **Embedding cache** — A new `embedding-cache.ts` module persists raw + pre-normalized embeddings. The cache stores the model name, slug fingerprint, and vectors. Both `tune-embedding.ts` (temp dir) and `consolidate-keywords.ts` (reports dir) call through the same module. On cache hit the embedding API call is skipped entirely.

2. **Clustering optimization** — `cosineSimilarity` in `consolidate-keywords-helpers.ts` uses three `.reduce()` calls per comparison (dot + 2 magnitudes). With 7,697 slugs that's ~29.6M pairs x ~3,072 reduce callbacks = ~91 billion JS callback invocations. Fix: pre-normalize all embeddings to unit vectors once, then cosine similarity reduces to a single typed-array dot product. Store normalized vectors in the cache so re-clustering with different thresholds (the primary tune workflow) skips normalization too.

**Tech Stack:** Bun, TypeScript, Zod, `Float64Array`, existing `embedSlugBatch`, existing `hashText`.

---

## File Structure

| Action | File                                                     | Responsibility                                                        |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Create | `scripts/behavior-audit/embedding-cache.ts`              | Schema, load, save, fingerprint, cache-or-embed, pre-normalization    |
| Modify | `scripts/behavior-audit/config.ts`                       | Add `EMBEDDING_CACHE_PATH` config export                              |
| Modify | `scripts/behavior-audit/consolidate-keywords-helpers.ts` | Optimize `cosineSimilarity`, add pre-normalization to `buildClusters` |
| Modify | `scripts/behavior-audit/consolidate-keywords.ts`         | Use embedding cache in `computeMergeMap`, update deps                 |
| Modify | `scripts/behavior-audit/tune-embedding.ts`               | Use embedding cache with temp dir, `--re-embed` flag                  |

---

### Task 1: Create `embedding-cache.ts`

**Files:**

- Create: `scripts/behavior-audit/embedding-cache.ts`
- Reference: `scripts/behavior-audit/fingerprints.ts` (reuse `hashText`)
- Reference: `scripts/behavior-audit/consolidate-keywords-agent.ts` (reuse `embedSlugBatch`)

- [ ] **Step 1: Create the embedding cache module**

```typescript
import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import { embedSlugBatch } from './consolidate-keywords-agent.js'
import { hashText } from './fingerprints.js'
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'

const EmbeddingEntrySchema = z.object({
  slug: z.string(),
  raw: z.array(z.number()),
  normalized: z.array(z.number()),
})

const EmbeddingCacheSchema = z.object({
  model: z.string(),
  slugFingerprint: z.string(),
  entries: z.array(EmbeddingEntrySchema),
})

type EmbeddingCache = z.infer<typeof EmbeddingCacheSchema>

function buildSlugFingerprint(vocabulary: readonly KeywordVocabularyEntry[]): string {
  const slugs = vocabulary.map((e) => e.slug).join('\n')
  return hashText(slugs)
}

function normalizeVector(vec: readonly number[]): readonly number[] {
  const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (mag === 0) return vec
  return vec.map((v) => v / mag)
}

async function loadEmbeddingCache(
  cachePath: string,
  model: string,
  vocabulary: readonly KeywordVocabularyEntry[],
): Promise<{
  readonly raw: readonly (readonly number[])[]
  readonly normalized: readonly (readonly number[])[]
} | null> {
  const file = Bun.file(cachePath)
  if (!(await file.exists())) return null

  const raw: unknown = JSON.parse(await file.text())
  const parsed = EmbeddingCacheSchema.safeParse(raw)
  if (!parsed.success) return null

  const cache = parsed.data
  if (cache.model !== model) return null
  if (cache.slugFingerprint !== buildSlugFingerprint(vocabulary)) return null

  const rawMap = new Map<string, readonly number[]>()
  const normMap = new Map<string, readonly number[]>()
  for (const entry of cache.entries) {
    rawMap.set(entry.slug, entry.raw)
    normMap.set(entry.slug, entry.normalized)
  }

  if (rawMap.size !== vocabulary.length) return null

  return {
    raw: vocabulary.map((e) => rawMap.get(e.slug) ?? []),
    normalized: vocabulary.map((e) => normMap.get(e.slug) ?? []),
  }
}

async function saveEmbeddingCache(
  cachePath: string,
  model: string,
  vocabulary: readonly KeywordVocabularyEntry[],
  embeddings: readonly (readonly number[])[],
): Promise<void> {
  const entries = vocabulary.map((entry, i) => ({
    slug: entry.slug,
    raw: [...(embeddings[i] ?? [])],
    normalized: [...normalizeVector(embeddings[i] ?? [])],
  }))

  const cache: EmbeddingCache = {
    model,
    slugFingerprint: buildSlugFingerprint(vocabulary),
    entries,
  }

  const dir = dirname(cachePath)
  const tempPath = join(dir, `.${basename(cachePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await mkdir(dir, { recursive: true })
  await Bun.write(tempPath, JSON.stringify(cache))
  await rename(tempPath, cachePath)
}

export interface EmbeddingData {
  readonly raw: readonly (readonly number[])[]
  readonly normalized: readonly (readonly number[])[]
}

export interface GetOrEmbedDeps {
  readonly embedSlugBatch: typeof embedSlugBatch
  readonly log: Pick<typeof console, 'log'>
}

export async function getOrEmbed(
  cachePath: string | null,
  model: string,
  vocabulary: readonly KeywordVocabularyEntry[],
  deps: GetOrEmbedDeps,
  forceReembed: boolean = false,
): Promise<EmbeddingData> {
  if (cachePath !== null && !forceReembed) {
    const cached = await loadEmbeddingCache(cachePath, model, vocabulary)
    if (cached !== null) {
      deps.log.log(`[embedding-cache] Reusing cached embeddings (${vocabulary.length} slugs)`)
      return cached
    }
  }

  deps.log.log(`[embedding-cache] Embedding ${vocabulary.length} slugs...`)
  const slugInputs = vocabulary.map((e) => `${e.slug}: ${e.description}`)
  const embeddings = await deps.embedSlugBatch(slugInputs)

  if (cachePath !== null) {
    deps.log.log(`[embedding-cache] Saving embeddings to ${cachePath}`)
    await saveEmbeddingCache(cachePath, model, vocabulary, embeddings)
  }

  return {
    raw: embeddings,
    normalized: embeddings.map((e) => normalizeVector(e)),
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bunx tsc --noEmit 2>&1 | grep embedding-cache`
Expected: no output (clean)

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/embedding-cache.ts
git commit -m "feat(behavior-audit): add embedding cache module"
```

---

### Task 2: Optimize `cosineSimilarity` and `buildClusters`

**Problem:** `cosineSimilarity` uses three `.reduce()` calls per pair (dot product + 2 magnitudes). With 7,697 slugs, `buildClusters` does ~29.6M comparisons, each invoking ~3,072 reduce callbacks (at dim=1024). That's ~91 billion JS callback invocations total.

**Fix:** Pre-normalize embeddings to unit vectors once, then each comparison is a single typed-array dot product (one division eliminated, magnitudes are all 1.0). `buildClusters` accepts pre-normalized `Float64Array[]` and uses a fast dot-product-only path.

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-helpers.ts`

- [ ] **Step 1: Add `toNormalizedFloat64Arrays` helper**

Add after the existing `cosineSimilarity` function:

```typescript
export function toNormalizedFloat64Arrays(embeddings: readonly (readonly number[])[]): readonly Float64Array[] {
  return embeddings.map((emb) => {
    const arr = new Float64Array(emb.length)
    let mag = 0
    for (let k = 0; k < emb.length; k++) {
      const v = emb[k] ?? 0
      arr[k] = v
      mag += v * v
    }
    mag = Math.sqrt(mag)
    if (mag > 0) {
      for (let k = 0; k < arr.length; k++) {
        arr[k] = arr[k]! / mag
      }
    }
    return arr
  })
}

export function dotProduct(a: Float64Array, b: Float64Array): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let k = 0; k < len; k++) {
    sum += a[k]! * b[k]!
  }
  return sum
}
```

- [ ] **Step 2: Add `buildClustersNormalized` function**

This is the fast path that accepts pre-normalized `Float64Array[]` and uses only `dotProduct`:

```typescript
export function buildClustersNormalized(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
): readonly (readonly number[])[] {
  const n = normalizedEmbeddings.length
  const uf = buildUnionFind(n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const embI = normalizedEmbeddings[i]
      const embJ = normalizedEmbeddings[j]
      if (embI !== undefined && embJ !== undefined && dotProduct(embI, embJ) >= threshold) {
        union(uf, i, j)
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(uf, i)
    const group = groups.get(root)
    if (group === undefined) {
      groups.set(root, [i])
    } else {
      group.push(i)
    }
  }

  return [...groups.values()].filter((g) => g.length >= minClusterSize).map((g) => [...g])
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bunx tsc --noEmit 2>&1 | grep 'consolidate-keywords-helpers'`
Expected: no output (clean)

- [ ] **Step 4: Verify existing tests still pass**

Run: `bun test`
Expected: all pass (existing `buildClusters` + `cosineSimilarity` are unchanged)

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-helpers.ts
git commit -m "perf(behavior-audit): add pre-normalized clustering with Float64Array dot product"
```

---

### Task 3: Add `EMBEDDING_CACHE_PATH` to config

**Files:**

- Modify: `scripts/behavior-audit/config.ts:65` (add new path near `KEYWORD_VOCABULARY_PATH`)
- Modify: `scripts/behavior-audit/config.ts:113-116` (add to `reloadBehaviorAuditConfig`)

- [ ] **Step 1: Add `EMBEDDING_CACHE_PATH` declaration after `KEYWORD_VOCABULARY_PATH`**

In `config.ts`, after line 65 (`KEYWORD_VOCABULARY_PATH = ...`), add:

```typescript
export let EMBEDDING_CACHE_PATH = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'embedding-cache.json')
```

- [ ] **Step 2: Add config reload for `EMBEDDING_CACHE_PATH`**

In `reloadBehaviorAuditConfig()`, after the `KEYWORD_VOCABULARY_PATH` reload block (after line 116), add:

```typescript
EMBEDDING_CACHE_PATH = resolveStringOverride(
  'BEHAVIOR_AUDIT_EMBEDDING_CACHE_PATH',
  resolve(AUDIT_BEHAVIOR_DIR, 'embedding-cache.json'),
)
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bunx tsc --noEmit 2>&1 | grep config`
Expected: no output (clean)

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/config.ts
git commit -m "feat(behavior-audit): add EMBEDDING_CACHE_PATH config"
```

---

### Task 4: Update `consolidate-keywords.ts` to use embedding cache and fast clustering

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords.ts`

- [ ] **Step 1: Add imports**

Add to the import block at the top of `consolidate-keywords.ts`:

```typescript
import { EMBEDDING_CACHE_PATH, EMBEDDING_MODEL } from './config.js'
import { getOrEmbed } from './embedding-cache.js'
import { buildClustersNormalized, buildMergeMap, toNormalizedFloat64Arrays } from './consolidate-keywords-helpers.js'
```

Remove the direct `embedSlugBatch` import (it is now used through `getOrEmbed`):

```typescript
// remove: import { embedSlugBatch } from './consolidate-keywords-agent.js'
```

Keep the type import: `import type { embedSlugBatch as EmbedSlugBatch } from './consolidate-keywords-agent.js'`

- [ ] **Step 2: Update `Phase1bDeps`**

Replace `embedSlugBatch` in the deps interface with the new deps from `getOrEmbed`:

```typescript
export interface Phase1bDeps {
  readonly loadKeywordVocabulary: typeof loadKeywordVocabulary
  readonly saveKeywordVocabulary: typeof saveKeywordVocabulary
  readonly getOrEmbed: typeof getOrEmbed
  readonly embeddingCachePath: string | null
  readonly embeddingModel: string
  readonly loadManifest: () => Promise<IncrementalManifest | null>
  readonly remapKeywordsInExtractedFile: typeof RemapFn
  readonly saveProgress: typeof saveProgress
  readonly log: Pick<typeof console, 'log'>
}
```

- [ ] **Step 3: Update `defaultPhase1bDeps`**

```typescript
const defaultPhase1bDeps: Phase1bDeps = {
  loadKeywordVocabulary,
  saveKeywordVocabulary,
  getOrEmbed,
  embeddingCachePath: EMBEDDING_CACHE_PATH,
  embeddingModel: EMBEDDING_MODEL,
  loadManifest,
  remapKeywordsInExtractedFile,
  saveProgress,
  log: console,
}
```

- [ ] **Step 4: Update `computeMergeMap` to use cache**

Replace the existing `computeMergeMap` function with:

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
  deps.log.log(`[Phase 1b] Clustering at threshold ${CONSOLIDATION_THRESHOLD}...`)
  const clusters = buildClustersNormalized(normalized, CONSOLIDATION_THRESHOLD, CONSOLIDATION_MIN_CLUSTER_SIZE)
  return buildMergeMap(vocabulary, clusters)
}
```

Add back the `embedSlugBatch` value import (needed by `computeMergeMap` to pass to `getOrEmbed`):

```typescript
import { embedSlugBatch } from './consolidate-keywords-agent.js'
```

- [ ] **Step 5: Verify typecheck passes**

Run: `bunx tsc --noEmit 2>&1 | grep 'consolidate-keywords'`
Expected: no output (clean)

- [ ] **Step 6: Verify lint passes**

Run: `bunx oxlint scripts/behavior-audit/consolidate-keywords.ts`
Expected: 0 warnings, 0 errors

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords.ts
git commit -m "feat(behavior-audit): use embedding cache in Phase 1b"
```

---

### Task 5: Update `tune-embedding.ts` to use embedding cache and fast clustering

**Files:**

- Modify: `scripts/behavior-audit/tune-embedding.ts`

- [ ] **Step 1: Add imports and update argument parsing**

Add imports:

```typescript
import { getOrEmbed } from './embedding-cache.js'
import { EMBEDDING_MODEL } from './config.js'
import { embedSlugBatch } from './consolidate-keywords-agent.js'
import {
  buildClustersNormalized,
  buildConsolidatedVocabulary,
  buildMergeMap,
  toNormalizedFloat64Arrays,
} from './consolidate-keywords-helpers.js'
```

Remove the old imports that are replaced: `buildClusters`, `embedSlugBatch` from `consolidate-keywords-agent.ts` if already imported (check for duplicates).

Update `TuneParams`:

```typescript
interface TuneParams {
  readonly threshold: number
  readonly minClusterSize: number
  readonly reembed: boolean
  readonly cacheDir: string
}
```

Update `parseArgs`:

```typescript
function parseArgs(args: readonly string[]): TuneParams {
  let threshold = 0.92
  let minClusterSize = 2
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
    if (flag === '--re-embed') {
      reembed = true
    }
  }
  const cacheDir = join(tmpdir(), 'tune-embed-cache')
  return { threshold, minClusterSize, reembed, cacheDir }
}
```

- [ ] **Step 2: Update `runTune` to use cache**

Replace the embedding + clustering section in `runTune`:

```typescript
async function runTune(params: TuneParams): Promise<TuneResult> {
  reloadBehaviorAuditConfig()

  const initialKeywords = await collectUniqueKeywords()
  const initialCount = initialKeywords.length
  if (initialCount === 0) {
    return {
      initialCount: 0,
      finalCount: 0,
      merges: 0,
      initialKeywords: [],
      finalKeywords: [],
      mergePairs: [],
    }
  }

  const now = new Date().toISOString()
  const vocabulary = toVocabulary(initialKeywords, now)
  const cachePath = join(params.cacheDir, 'embedding-cache.json')

  const embeddingData = await getOrEmbed(
    cachePath,
    EMBEDDING_MODEL,
    vocabulary,
    { embedSlugBatch, log: console },
    params.reembed,
  )

  const normalized = toNormalizedFloat64Arrays(embeddingData.normalized)
  console.log(`[tune] Clustering at threshold=${params.threshold}, minClusterSize=${params.minClusterSize}...`)
  const clusters = buildClustersNormalized(normalized, params.threshold, params.minClusterSize)
  const mergeMap = buildMergeMap(vocabulary, clusters)

  const consolidated = buildConsolidatedVocabulary(vocabulary, mergeMap, now)
  const finalKeywords = consolidated.map((e) => e.slug)
  const finalCount = finalKeywords.length
  const mergePairs = extractMergePairs(mergeMap)

  return { initialCount, finalCount, merges: mergeMap.size, initialKeywords, finalKeywords, mergePairs }
}
```

- [ ] **Step 3: Update `printSummary` to show cache info**

In `printSummary`, add after the `reduction` line:

```typescript
console.log(`  re-embedded:     ${params.reembed}`)
console.log(`  cache dir:       ${params.cacheDir}`)
```

- [ ] **Step 4: Verify typecheck passes**

Run: `bunx tsc --noEmit 2>&1 | grep 'tune-embedding'`
Expected: no output (clean)

- [ ] **Step 5: Verify lint passes**

Run: `bunx oxlint scripts/behavior-audit/tune-embedding.ts`
Expected: 0 warnings, 0 errors

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/tune-embedding.ts
git commit -m "feat(behavior-audit): use embedding cache in tune-embedding script"
```

---

### Task 6: Update existing tests for `consolidate-keywords.ts` deps change

**Files:**

- Modify: any test files that construct `Phase1bDeps` directly

- [ ] **Step 1: Find affected test files**

Run: `grep -rn 'Phase1bDeps\|embedSlugBatch' tests/ --include='*.ts' -l`
Review each hit to identify tests that provide inline `Phase1bDeps` or mock `embedSlugBatch`.

- [ ] **Step 2: Update test deps to match new `Phase1bDeps` shape**

For each affected test, replace the old `embedSlugBatch` dep with the new fields:

```typescript
// old
embedSlugBatch: mockEmbedSlugBatch,

// new
getOrEmbed: mockGetOrEmbed,
embeddingCachePath: null,
embeddingModel: 'test-model',
```

Create the mock:

```typescript
import type { EmbeddingData } from './embedding-cache.js'

const mockGetOrEmbed = async (
  _cachePath: string | null,
  _model: string,
  vocabulary: readonly KeywordVocabularyEntry[],
  _deps: unknown,
  _force?: boolean,
): Promise<EmbeddingData> => {
  const raw = vocabulary.map(() => [0.1, 0.2, 0.3])
  return { raw, normalized: raw }
}
```

- [ ] **Step 3: Run affected tests**

Run: `bun test <affected-test-files>`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test(behavior-audit): update tests for embedding cache deps"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run full typecheck**

Run: `bunx tsc --noEmit`
Expected: clean

- [ ] **Step 2: Run lint on all changed files**

Run: `bunx oxlint scripts/behavior-audit/embedding-cache.ts scripts/behavior-audit/config.ts scripts/behavior-audit/consolidate-keywords-helpers.ts scripts/behavior-audit/consolidate-keywords.ts scripts/behavior-audit/tune-embedding.ts`
Expected: 0 warnings, 0 errors

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: all pass

- [ ] **Step 4: Manual smoke test of tune-embedding**

Run first time (cold cache):

```bash
bun scripts/behavior-audit/tune-embedding.ts --threshold 0.92
```

Expected: `[embedding-cache] Embedding N slugs...` followed by `[embedding-cache] Saving embeddings...`

Run second time (warm cache):

```bash
bun scripts/behavior-audit/tune-embedding.ts --threshold 0.88
```

Expected: `[embedding-cache] Reusing cached embeddings (N slugs)` — no API call

Run with force re-embed:

```bash
bun scripts/behavior-audit/tune-embedding.ts --threshold 0.88 --re-embed
```

Expected: `[embedding-cache] Embedding N slugs...` — fresh API call
