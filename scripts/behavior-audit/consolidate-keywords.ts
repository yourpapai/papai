import {
  CONSOLIDATION_DRY_RUN,
  CONSOLIDATION_GAP_THRESHOLD,
  CONSOLIDATION_LINKAGE,
  CONSOLIDATION_MAX_CLUSTER_SIZE,
  CONSOLIDATION_MIN_CLUSTER_SIZE,
  CONSOLIDATION_THRESHOLD,
  EMBEDDING_CACHE_PATH,
  EMBEDDING_BASE_URL,
  EMBEDDING_MODEL,
} from './config.js'
import { embedSlugBatch } from './consolidate-keywords-agent.js'
import {
  buildClustersAdvanced,
  buildConsolidatedVocabulary,
  buildMergeMap,
  subdivideOversizedClusters,
  toNormalizedFloat64Arrays,
} from './consolidate-keywords-helpers.js'
import { getOrEmbed } from './embedding-cache.js'
import type { remapKeywordsInExtractedFile as RemapFn } from './extracted-store.js'
import { remapKeywordsInExtractedFile } from './extracted-store.js'
import type { IncrementalManifest } from './incremental.js'
import { loadManifest } from './incremental.js'
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'
import { loadKeywordVocabulary, saveKeywordVocabulary } from './keyword-vocabulary.js'
import { resetPhase2AndPhase3 } from './progress-resets.js'
import { emptyPhase1b, type Progress } from './progress.js'
import { saveProgress } from './progress.js'

export interface Phase1bDeps {
  readonly loadKeywordVocabulary: typeof loadKeywordVocabulary
  readonly saveKeywordVocabulary: typeof saveKeywordVocabulary
  readonly getOrEmbed: typeof getOrEmbed
  readonly embeddingCachePath: string | null
  readonly embeddingBaseUrl: string
  readonly embeddingModel: string
  readonly loadManifest: () => Promise<IncrementalManifest | null>
  readonly remapKeywordsInExtractedFile: typeof RemapFn
  readonly saveProgress: typeof saveProgress
  readonly log: Pick<typeof console, 'log'>
}

const defaultPhase1bDeps: Phase1bDeps = {
  loadKeywordVocabulary,
  saveKeywordVocabulary,
  getOrEmbed,
  embeddingCachePath: EMBEDDING_CACHE_PATH,
  embeddingBaseUrl: EMBEDDING_BASE_URL,
  embeddingModel: EMBEDDING_MODEL,
  loadManifest,
  remapKeywordsInExtractedFile,
  saveProgress,
  log: console,
}

async function markDoneAndSave(
  progress: Progress,
  threshold: number,
  slugsBefore: number,
  now: string,
  deps: Pick<Phase1bDeps, 'saveProgress' | 'embeddingModel' | 'embeddingBaseUrl' | 'embeddingCachePath'>,
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
    embeddingBaseUrl: deps.embeddingBaseUrl,
    embeddingCachePath: deps.embeddingCachePath,
    stats: { slugsBefore, slugsAfter: slugsBefore, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
  }
  await deps.saveProgress(progress)
}

async function computeMergeMap(
  vocabulary: readonly KeywordVocabularyEntry[],
  deps: Pick<Phase1bDeps, 'getOrEmbed' | 'embeddingCachePath' | 'embeddingModel' | 'embeddingBaseUrl' | 'log'>,
): Promise<ReadonlyMap<string, string>> {
  const embeddingData = await deps.getOrEmbed(deps.embeddingCachePath, deps.embeddingModel, vocabulary, {
    embedSlugBatch,
    providerIdentity: deps.embeddingBaseUrl,
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
      CONSOLIDATION_GAP_THRESHOLD,
    )
  }
  return buildMergeMap(vocabulary, clusters)
}

function logDryRunMerges(mergeMap: ReadonlyMap<string, string>, deps: Pick<Phase1bDeps, 'log'>): void {
  deps.log.log(`[Phase 1b DRY RUN] Proposed merges at threshold ${CONSOLIDATION_THRESHOLD}:`)
  mergeMap.forEach((canonicalSlug, oldSlug) => {
    deps.log.log(`  ${oldSlug.padEnd(30)} → ${canonicalSlug}`)
  })
  deps.log.log(`No files were modified.`)
}

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
    deps.embeddingBaseUrl === progress.phase1b.embeddingBaseUrl &&
    deps.embeddingCachePath === progress.phase1b.embeddingCachePath
  )
}

async function applyMergesAndSave(
  progress: Progress,
  vocabulary: readonly KeywordVocabularyEntry[],
  mergeMap: ReadonlyMap<string, string>,
  now: string,
  deps: Phase1bDeps,
): Promise<void> {
  const consolidatedVocabulary = buildConsolidatedVocabulary(vocabulary, mergeMap, now)
  await deps.saveKeywordVocabulary(consolidatedVocabulary)

  const manifest = await deps.loadManifest()
  const testFiles = manifest === null ? [] : [...new Set(Object.values(manifest.tests).map((e) => e.testFile))]

  const remapResults = await Promise.all(
    testFiles.map((testFile) => deps.remapKeywordsInExtractedFile(testFile, mergeMap)),
  )

  const behaviorsUpdated = remapResults.filter((r) => r.updated).length
  const keywordsRemapped = remapResults.reduce((sum, r) => sum + r.remappedCount, 0)

  resetPhase2AndPhase3(progress)

  const slugsAfter = consolidatedVocabulary.length
  deps.log.log(`[Phase 1b complete] ${vocabulary.length} → ${slugsAfter} slugs, ${mergeMap.size} merges applied\n`)

  progress.phase1b = {
    status: 'done',
    lastRunAt: now,
    threshold: CONSOLIDATION_THRESHOLD,
    minClusterSize: CONSOLIDATION_MIN_CLUSTER_SIZE,
    linkage: CONSOLIDATION_LINKAGE,
    maxClusterSize: CONSOLIDATION_MAX_CLUSTER_SIZE,
    gapThreshold: CONSOLIDATION_GAP_THRESHOLD,
    embeddingModel: deps.embeddingModel,
    embeddingBaseUrl: deps.embeddingBaseUrl,
    embeddingCachePath: deps.embeddingCachePath,
    stats: {
      slugsBefore: vocabulary.length,
      slugsAfter,
      mergesApplied: mergeMap.size,
      behaviorsUpdated,
      keywordsRemapped,
    },
  }
  await deps.saveProgress(progress)
}

export async function runPhase1b(progress: Progress, deps: Phase1bDeps = defaultPhase1bDeps): Promise<void> {
  if (progress.phase1.status !== 'done') {
    deps.log.log('[Phase 1b] Phase 1 not complete, skipping.\n')
    return
  }

  const now = new Date().toISOString()

  if (EMBEDDING_MODEL === '') {
    deps.log.log('[Phase 1b] Embedding model not configured, skipping.\n')
    await markDoneAndSave(progress, 0, 0, now, deps)
    return
  }

  const vocabulary = await deps.loadKeywordVocabulary()
  if (vocabulary === null) {
    deps.log.log('[Phase 1b] No vocabulary found, skipping.\n')
    await markDoneAndSave(progress, CONSOLIDATION_THRESHOLD, 0, now, deps)
    return
  }

  if (!CONSOLIDATION_DRY_RUN && shouldSkipCompletedPhase1b(progress, vocabulary.length, deps)) {
    deps.log.log('[Phase 1b] Already complete, skipping.\n')
    return
  }

  if (!CONSOLIDATION_DRY_RUN) {
    progress.phase1b.status = 'in-progress'
    await deps.saveProgress(progress)
  }

  const mergeMap = await computeMergeMap(vocabulary, deps)

  if (CONSOLIDATION_DRY_RUN) {
    logDryRunMerges(mergeMap, deps)
    return
  }

  if (mergeMap.size === 0) {
    deps.log.log('[Phase 1b] No merges needed.\n')
    await markDoneAndSave(progress, CONSOLIDATION_THRESHOLD, vocabulary.length, now, deps)
    return
  }

  await applyMergesAndSave(progress, vocabulary, mergeMap, now, deps)
}

export { emptyPhase1b }
