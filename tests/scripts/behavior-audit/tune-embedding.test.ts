import { describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  ClusteringProfileOptions,
  ProfiledClusters,
} from '../../../scripts/behavior-audit/consolidate-keywords-advanced-clustering.js'
import type { LinkageMode } from '../../../scripts/behavior-audit/consolidate-keywords-helpers.js'
import { parseArgs, runTuneEmbedding } from '../../../scripts/behavior-audit/tune-embedding.js'

type RecordedSubdivideCall = {
  readonly maxClusterSize: number
  readonly linkage: string
  readonly thresholdStep: number
  readonly gapThreshold: number
}

type MockVocabularyEntry = {
  readonly slug: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
}

async function makeExtractedDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tune-embedding-test-'))
  await mkdir(path.join(dir, 'nested'), { recursive: true })
  await writeFile(path.join(dir, 'nested', 'records.json'), JSON.stringify([{ keywords: ['Alpha', 'Beta'] }]), 'utf-8')
  return dir
}

function buildClustersAdvancedStub(
  _normalized: readonly Float64Array[],
  _threshold: number,
  _minClusterSize: number,
  _linkage: LinkageMode,
  _gapThreshold: number,
): readonly (readonly number[])[]
function buildClustersAdvancedStub(
  _normalized: readonly Float64Array[],
  _threshold: number,
  _minClusterSize: number,
  _linkage: LinkageMode,
  _gapThreshold: number,
  _options: ClusteringProfileOptions & Readonly<{ profile: true }>,
): ProfiledClusters
function buildClustersAdvancedStub(
  _normalized: readonly Float64Array[],
  _threshold: number,
  _minClusterSize: number,
  _linkage: LinkageMode,
  _gapThreshold: number,
  ...rest: readonly [] | readonly [ClusteringProfileOptions | undefined]
): readonly (readonly number[])[] | ProfiledClusters {
  const options = rest[0]
  const clusters = [[0, 1]] as const
  if (options === undefined || options.profile !== true) return clusters
  return {
    clusters,
    profile: {
      enabled: true,
      linkage: 'complete',
      threshold: 0,
      size: 0,
      timings: {
        matrixBuildMs: 0,
        nearestNeighborMs: 0,
        mergeUpdateMs: 0,
        gapCheckMs: 0,
        candidateScanMs: 0,
        subdivisionMs: 0,
        totalMs: 0,
      },
      counters: {
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
        maxActiveClusters: 0,
        maxClusterSize: 1,
      },
    },
  }
}

function createProfiledClustersStub(
  onCall: (normalized: readonly Float64Array[], options: ClusteringProfileOptions | undefined) => void,
): typeof buildClustersAdvancedStub {
  function profiledStub(
    normalized: readonly Float64Array[],
    _threshold: number,
    _minClusterSize: number,
    _linkage: LinkageMode,
    _gapThreshold: number,
  ): readonly (readonly number[])[]
  function profiledStub(
    normalized: readonly Float64Array[],
    _threshold: number,
    _minClusterSize: number,
    _linkage: LinkageMode,
    _gapThreshold: number,
    options: ClusteringProfileOptions & Readonly<{ profile: true }>,
  ): ProfiledClusters
  function profiledStub(
    normalized: readonly Float64Array[],
    _threshold: number,
    _minClusterSize: number,
    _linkage: LinkageMode,
    _gapThreshold: number,
    ...rest: readonly [] | readonly [ClusteringProfileOptions | undefined]
  ): readonly (readonly number[])[] | ProfiledClusters {
    const options = rest[0]
    onCall(normalized, options)
    return {
      clusters: [[0, 1]],
      profile: {
        enabled: true,
        linkage: 'single',
        threshold: 0.92,
        size: normalized.length,
        timings: {
          matrixBuildMs: 0,
          nearestNeighborMs: 0,
          mergeUpdateMs: 0,
          gapCheckMs: 0,
          candidateScanMs: 0,
          subdivisionMs: 0,
          totalMs: 0,
        },
        counters: {
          activeListBuilds: 0,
          activeItemsVisited: 0,
          nearestNeighborCalls: 0,
          distanceReads: 0,
          distanceWrites: 0,
          gapChecks: 0,
          blockedPairs: 0,
          mergeCandidatesScanned: 0,
          merges: 1,
          subdivisions: 0,
          maxActiveClusters: normalized.length,
          maxClusterSize: normalized.length,
        },
      },
    }
  }

  return profiledStub
}

function isProfileOptionEnabled(options: ClusteringProfileOptions | undefined): boolean {
  return options !== undefined && options.profile === true
}

describe('tune-embedding wiring', () => {
  test('parseArgs enables clustering profile output', () => {
    expect(parseArgs(['--profile-clustering']).profileClustering).toBe(true)
  })

  test('parseArgs parses comma-separated profile sizes', () => {
    expect(parseArgs(['--profile-sizes', '500,1000,2000']).profileSizes).toEqual([500, 1000, 2000])
  })

  test('uses profiled clustering path and prints profile output', async () => {
    const extractedDir = await makeExtractedDir()
    let receivedProfileOption = false
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const buildProfiledClustersStub = createProfiledClustersStub((_normalized, options) => {
      receivedProfileOption = isProfileOptionEnabled(options)
    })

    await runTuneEmbedding(['--profile-clustering'], {
      extractedDir,
      embeddingModel: 'test-embedding-model',
      embeddingBaseUrl: 'http://embedding-provider/v1',
      reloadBehaviorAuditConfig: (): void => {},
      embedSlugBatch: (): Promise<readonly number[][]> => Promise.resolve([]),
      getOrEmbed: (): Promise<{
        readonly raw: readonly (readonly number[])[]
        readonly normalized: readonly (readonly number[])[]
      }> =>
        Promise.resolve({
          raw: [
            [1, 0],
            [0, 1],
          ],
          normalized: [
            [1, 0],
            [0, 1],
          ],
        }),
      normalizeKeywordSlug: (keyword: string): string => keyword.toLowerCase(),
      buildClustersAdvanced: buildProfiledClustersStub,
      buildMergeMap: (): ReadonlyMap<string, string> => new Map<string, string>(),
      buildConsolidatedVocabulary: (vocabulary: readonly MockVocabularyEntry[]): readonly MockVocabularyEntry[] =>
        vocabulary,
      toNormalizedFloat64Arrays: (vectors: readonly (readonly number[])[]): readonly Float64Array[] =>
        vectors.map((vector) => new Float64Array(vector)),
      subdivideOversizedClusters: (
        _normalized: readonly Float64Array[],
        clusters: readonly (readonly number[])[],
      ): readonly (readonly number[])[] => clusters,
    })

    const loggedOutput = logSpy.mock.calls.flat().join('\n')

    expect(receivedProfileOption).toBe(true)
    expect(loggedOutput).toContain('[profile] clustering linkage=single threshold=0.92 size=2')

    mock.restore()
  })

  test('profiles the requested sample size but keeps downstream clustering on the full input', async () => {
    const extractedDir = await makeExtractedDir()
    const clusteredLengths: number[] = []
    const receivedProfileFlags: boolean[] = []
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const buildSizedClustersStub = createProfiledClustersStub((normalized, options) => {
      clusteredLengths.push(normalized.length)
      receivedProfileFlags.push(isProfileOptionEnabled(options))
    })

    await runTuneEmbedding(['--profile-clustering', '--profile-sizes', '1,2,3'], {
      extractedDir,
      embeddingModel: 'test-embedding-model',
      embeddingBaseUrl: 'http://embedding-provider/v1',
      reloadBehaviorAuditConfig: (): void => {},
      embedSlugBatch: (): Promise<readonly number[][]> => Promise.resolve([]),
      getOrEmbed: (): Promise<{
        readonly raw: readonly (readonly number[])[]
        readonly normalized: readonly (readonly number[])[]
      }> =>
        Promise.resolve({
          raw: [
            [1, 0],
            [0, 1],
            [1, 1],
            [0, 0],
          ],
          normalized: [
            [1, 0],
            [0, 1],
            [1, 1],
            [0, 0],
          ],
        }),
      normalizeKeywordSlug: (keyword: string): string => keyword.toLowerCase(),
      buildClustersAdvanced: buildSizedClustersStub,
      buildMergeMap: (): ReadonlyMap<string, string> => new Map<string, string>(),
      buildConsolidatedVocabulary: (vocabulary: readonly MockVocabularyEntry[]): readonly MockVocabularyEntry[] =>
        vocabulary,
      toNormalizedFloat64Arrays: (vectors: readonly (readonly number[])[]): readonly Float64Array[] =>
        vectors.map((vector) => new Float64Array(vector)),
      subdivideOversizedClusters: (
        _normalized: readonly Float64Array[],
        clusters: readonly (readonly number[])[],
      ): readonly (readonly number[])[] => clusters,
    })

    const loggedOutput = logSpy.mock.calls.flat().join('\n')

    expect(receivedProfileFlags).toEqual([true, false])
    expect(clusteredLengths).toEqual([3, 4])
    expect(loggedOutput).toContain('[profile] clustering linkage=single threshold=0.92 size=3')

    mock.restore()
  })

  test('does not rerun full clustering when the profile sample already covers the full input', async () => {
    const extractedDir = await makeExtractedDir()
    const clusteredLengths: number[] = []
    const receivedProfileFlags: boolean[] = []
    const buildSizedClustersStub = createProfiledClustersStub((normalized, options) => {
      clusteredLengths.push(normalized.length)
      receivedProfileFlags.push(isProfileOptionEnabled(options))
    })

    await runTuneEmbedding(['--profile-clustering', '--profile-sizes', '1,2,4'], {
      extractedDir,
      embeddingModel: 'test-embedding-model',
      embeddingBaseUrl: 'http://embedding-provider/v1',
      reloadBehaviorAuditConfig: (): void => {},
      embedSlugBatch: (): Promise<readonly number[][]> => Promise.resolve([]),
      getOrEmbed: (): Promise<{
        readonly raw: readonly (readonly number[])[]
        readonly normalized: readonly (readonly number[])[]
      }> =>
        Promise.resolve({
          raw: [
            [1, 0],
            [0, 1],
            [1, 1],
            [0, 0],
          ],
          normalized: [
            [1, 0],
            [0, 1],
            [1, 1],
            [0, 0],
          ],
        }),
      normalizeKeywordSlug: (keyword: string): string => keyword.toLowerCase(),
      buildClustersAdvanced: buildSizedClustersStub,
      buildMergeMap: (): ReadonlyMap<string, string> => new Map<string, string>(),
      buildConsolidatedVocabulary: (vocabulary: readonly MockVocabularyEntry[]): readonly MockVocabularyEntry[] =>
        vocabulary,
      toNormalizedFloat64Arrays: (vectors: readonly (readonly number[])[]): readonly Float64Array[] =>
        vectors.map((vector) => new Float64Array(vector)),
      subdivideOversizedClusters: (
        _normalized: readonly Float64Array[],
        clusters: readonly (readonly number[])[],
      ): readonly (readonly number[])[] => clusters,
    })

    expect(receivedProfileFlags).toEqual([true])
    expect(clusteredLengths).toEqual([4])
  })

  test('forwards gapThreshold into subdivideOversizedClusters', async () => {
    const extractedDir = await makeExtractedDir()
    const recordedCalls: RecordedSubdivideCall[] = []

    await runTuneEmbedding(['--max-cluster-size', '2', '--gap-threshold', '0.17', '--linkage', 'complete'], {
      extractedDir,
      embeddingModel: 'test-embedding-model',
      embeddingBaseUrl: 'http://embedding-provider/v1',
      reloadBehaviorAuditConfig: (): void => {},
      embedSlugBatch: (): Promise<readonly number[][]> => Promise.resolve([]),
      getOrEmbed: (): Promise<{
        readonly raw: readonly (readonly number[])[]
        readonly normalized: readonly (readonly number[])[]
      }> =>
        Promise.resolve({
          raw: [
            [1, 0],
            [0, 1],
          ],
          normalized: [
            [1, 0],
            [0, 1],
          ],
        }),
      normalizeKeywordSlug: (keyword: string): string => keyword.toLowerCase(),
      buildClustersAdvanced: buildClustersAdvancedStub,
      buildMergeMap: (): ReadonlyMap<string, string> => new Map<string, string>(),
      buildConsolidatedVocabulary: (vocabulary: readonly MockVocabularyEntry[]): readonly MockVocabularyEntry[] =>
        vocabulary,
      toNormalizedFloat64Arrays: (vectors: readonly (readonly number[])[]): readonly Float64Array[] =>
        vectors.map((vector) => new Float64Array(vector)),
      subdivideOversizedClusters: (
        _normalized: readonly Float64Array[],
        clusters: readonly (readonly number[])[],
        maxClusterSize: number,
        linkage: string,
        thresholdStep: number,
        gapThreshold: number,
      ): readonly (readonly number[])[] => {
        recordedCalls.push({ maxClusterSize, linkage, thresholdStep, gapThreshold })
        return clusters
      },
    })

    expect(recordedCalls).toEqual([
      {
        maxClusterSize: 2,
        linkage: 'complete',
        thresholdStep: 0.01,
        gapThreshold: 0.17,
      },
    ])
  })
})
