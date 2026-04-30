import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { formatClusteringProfile } from './clustering-profile.js'
import { reloadBehaviorAuditConfig, EXTRACTED_DIR, EMBEDDING_BASE_URL, EMBEDDING_MODEL } from './config.js'
import type { ProfiledClusters } from './consolidate-keywords-advanced-clustering.js'
import { embedSlugBatch } from './consolidate-keywords-agent.js'
import {
  buildClustersAdvanced,
  buildConsolidatedVocabulary,
  buildMergeMap,
  subdivideOversizedClusters,
  toNormalizedFloat64Arrays,
} from './consolidate-keywords-helpers.js'
import { getOrEmbed } from './embedding-cache.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { normalizeKeywordSlug } from './keyword-vocabulary.js'
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'
import { parseArgs } from './tune-embedding-args.js'
import type { TuneParams } from './tune-embedding-args.js'

export { parseArgs } from './tune-embedding-args.js'

interface TuneEmbeddingDeps {
  readonly extractedDir: string
  readonly embeddingModel: string
  readonly embeddingBaseUrl: string
  readonly reloadBehaviorAuditConfig: () => void
  readonly embedSlugBatch: typeof embedSlugBatch
  readonly buildClustersAdvanced: typeof buildClustersAdvanced
  readonly buildConsolidatedVocabulary: typeof buildConsolidatedVocabulary
  readonly buildMergeMap: typeof buildMergeMap
  readonly subdivideOversizedClusters: typeof subdivideOversizedClusters
  readonly toNormalizedFloat64Arrays: typeof toNormalizedFloat64Arrays
  readonly getOrEmbed: typeof getOrEmbed
  readonly normalizeKeywordSlug: typeof normalizeKeywordSlug
}

const defaultTuneEmbeddingDeps: TuneEmbeddingDeps = {
  extractedDir: EXTRACTED_DIR,
  embeddingModel: EMBEDDING_MODEL,
  embeddingBaseUrl: EMBEDDING_BASE_URL,
  reloadBehaviorAuditConfig,
  embedSlugBatch,
  buildClustersAdvanced,
  buildConsolidatedVocabulary,
  buildMergeMap,
  subdivideOversizedClusters,
  toNormalizedFloat64Arrays,
  getOrEmbed,
  normalizeKeywordSlug,
}

interface TuneResult {
  readonly initialCount: number
  readonly finalCount: number
  readonly merges: number
  readonly initialKeywords: readonly string[]
  readonly finalKeywords: readonly string[]
  readonly mergePairs: ReadonlyArray<readonly [string, string]>
}

async function collectJsonFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(e.parentPath, e.name))
}

async function readAllRecords(files: readonly string[]): Promise<readonly ExtractedBehaviorRecord[]> {
  const parsed = await Promise.all(
    files.map(async (filePath) => {
      const raw: unknown = JSON.parse(await Bun.file(filePath).text())
      return Array.isArray(raw) ? (raw as readonly ExtractedBehaviorRecord[]) : []
    }),
  )
  return parsed.flat()
}

async function collectUniqueKeywords(deps: TuneEmbeddingDeps): Promise<readonly string[]> {
  let files: readonly string[]
  try {
    files = await collectJsonFiles(deps.extractedDir)
  } catch {
    return []
  }

  const records = await readAllRecords(files)
  const keywordSet = new Set<string>()
  for (const record of records) {
    if (!Array.isArray(record.keywords)) continue
    for (const kw of record.keywords) {
      if (typeof kw !== 'string') continue
      const slug = deps.normalizeKeywordSlug(kw)
      if (slug.length > 0) {
        keywordSet.add(slug)
      }
    }
  }
  return [...keywordSet].toSorted()
}

function toVocabulary(keywords: readonly string[], now: string): readonly KeywordVocabularyEntry[] {
  return keywords.map((slug) => ({ slug, description: slug, createdAt: now, updatedAt: now }))
}

function extractMergePairs(mergeMap: ReadonlyMap<string, string>): readonly (readonly [string, string])[] {
  return [...mergeMap.entries()]
}

async function writeTempKeywordList(prefix: string, keywords: readonly string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tune-embed-'))
  const path = join(dir, `${prefix}-keywords.txt`)
  await writeFile(path, keywords.join('\n') + '\n', 'utf-8')
  return path
}

function buildTuneClusters(
  normalized: readonly Float64Array[],
  params: TuneParams,
  deps: TuneEmbeddingDeps,
): readonly (readonly number[])[] {
  console.log(
    `[tune] Clustering at threshold=${params.threshold}, minClusterSize=${params.minClusterSize}, linkage=${params.linkage}, gap=${params.gapThreshold}, maxClusterSize=${params.maxClusterSize}...`,
  )

  if (!params.profileClustering) {
    return finalizeTuneClusters(normalized, buildTuneClusterResult(normalized, params, deps), params, deps)
  }

  const profilingInput = selectClusteringInput(normalized, params.profileSizes)
  const profilingResult = buildTuneClusterResult(profilingInput, params, deps)
  if (isProfiledClusters(profilingResult)) {
    console.log(formatClusteringProfile(profilingResult.profile))
  }
  const fullResult =
    params.profileSizes.length > 0 && profilingInput.length < normalized.length
      ? deps.buildClustersAdvanced(
          normalized,
          params.threshold,
          params.minClusterSize,
          params.linkage,
          params.gapThreshold,
        )
      : profilingResult

  return finalizeTuneClusters(normalized, fullResult, params, deps)
}

function finalizeTuneClusters(
  normalized: readonly Float64Array[],
  clusterResult: readonly (readonly number[])[] | ProfiledClusters,
  params: TuneParams,
  deps: TuneEmbeddingDeps,
): readonly (readonly number[])[] {
  const clusters = isProfiledClusters(clusterResult) ? clusterResult.clusters : clusterResult
  return params.maxClusterSize > 0
    ? deps.subdivideOversizedClusters(
        normalized,
        clusters,
        params.maxClusterSize,
        params.linkage,
        0.01,
        params.gapThreshold,
      )
    : clusters
}

function selectClusteringInput(
  normalized: readonly Float64Array[],
  profileSizes: readonly number[],
): readonly Float64Array[] {
  const requestedSize = profileSizes.at(-1)
  if (requestedSize === undefined || normalized.length <= requestedSize) {
    return normalized
  }
  return normalized.slice(0, requestedSize)
}

function isProfiledClusters(result: readonly (readonly number[])[] | ProfiledClusters): result is ProfiledClusters {
  return !Array.isArray(result)
}

function buildTuneClusterResult(
  normalized: readonly Float64Array[],
  params: TuneParams,
  deps: TuneEmbeddingDeps,
): readonly (readonly number[])[] | ProfiledClusters {
  return params.profileClustering
    ? deps.buildClustersAdvanced(
        normalized,
        params.threshold,
        params.minClusterSize,
        params.linkage,
        params.gapThreshold,
        { profile: true },
      )
    : deps.buildClustersAdvanced(
        normalized,
        params.threshold,
        params.minClusterSize,
        params.linkage,
        params.gapThreshold,
      )
}

async function runTune(params: TuneParams, deps: TuneEmbeddingDeps): Promise<TuneResult> {
  deps.reloadBehaviorAuditConfig()

  const initialKeywords = await collectUniqueKeywords(deps)
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

  const embeddingData = await deps.getOrEmbed(
    cachePath,
    deps.embeddingModel,
    vocabulary,
    { embedSlugBatch: deps.embedSlugBatch, providerIdentity: deps.embeddingBaseUrl, log: console },
    params.reembed,
  )

  const normalized = deps.toNormalizedFloat64Arrays(embeddingData.normalized)
  const clusters = buildTuneClusters(normalized, params, deps)
  const mergeMap = deps.buildMergeMap(vocabulary, clusters)

  const consolidated = deps.buildConsolidatedVocabulary(vocabulary, mergeMap, now)
  const finalKeywords = consolidated.map((e) => e.slug)
  const finalCount = finalKeywords.length
  const mergePairs = extractMergePairs(mergeMap)

  return { initialCount, finalCount, merges: mergeMap.size, initialKeywords, finalKeywords, mergePairs }
}

function printSummary(result: TuneResult, params: TuneParams): void {
  console.log('')
  console.log('=== Embedding Tuning Summary ===')
  console.log(`  threshold:       ${params.threshold}`)
  console.log(`  minClusterSize:  ${params.minClusterSize}`)
  console.log(`  linkage:         ${params.linkage}`)
  console.log(`  maxClusterSize:  ${params.maxClusterSize > 0 ? params.maxClusterSize : 'none'}`)
  console.log(`  gapThreshold:    ${params.gapThreshold}`)
  console.log(`  initial slugs:   ${result.initialCount}`)
  console.log(`  final slugs:     ${result.finalCount}`)
  console.log(`  merges applied:  ${result.merges}`)
  console.log(
    `  reduction:       ${result.initialCount > 0 ? ((1 - result.finalCount / result.initialCount) * 100).toFixed(1) : 0}%`,
  )
  console.log(`  re-embedded:     ${params.reembed}`)
  console.log(`  cache dir:       ${params.cacheDir}`)
  if (result.mergePairs.length > 0) {
    console.log('')
    console.log('  Merge map:')
    for (const [from, to] of result.mergePairs) {
      console.log(`    ${from.padEnd(30)} -> ${to}`)
    }
  }
}

async function writeTempFiles(result: TuneResult): Promise<void> {
  const initialPath = await writeTempKeywordList('initial', result.initialKeywords)
  const finalPath = await writeTempKeywordList('final', result.finalKeywords)
  console.log(`\n  initial keywords: ${initialPath}\n  final keywords:   ${finalPath}`)
}

export async function runTuneEmbedding(
  args: readonly string[],
  deps: Partial<TuneEmbeddingDeps> | null,
): Promise<void> {
  const params = parseArgs(args)
  const resolvedDeps = deps === null ? defaultTuneEmbeddingDeps : { ...defaultTuneEmbeddingDeps, ...deps }
  const result = await runTune(params, resolvedDeps)
  printSummary(result, params)
  if (result.initialCount > 0) {
    await writeTempFiles(result)
  }
  console.log('')
}

if (import.meta.main) {
  await runTuneEmbedding(process.argv.slice(2), null).catch((error: unknown) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
