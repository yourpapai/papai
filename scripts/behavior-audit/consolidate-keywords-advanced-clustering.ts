import { createClusteringProfile, recordClusteringTiming } from './clustering-profile.js'
import type { ClusteringProfile } from './clustering-profile.js'
import {
  activeIndices,
  buildAgglomerativeClusters,
  buildCondensedDistanceMatrix,
  condensedIndex,
  createActiveState,
  getDistance,
  isActive,
  setDistance,
} from './consolidate-keywords-agglomerative-clustering.js'
import {
  buildClustersNormalized,
  dotProduct,
  findWeakestInternalSimilarity,
  mapToGlobalClusters,
  toIndexedSubEmbeddings,
} from './consolidate-keywords-clustering.js'
import type { LinkageMode } from './consolidate-keywords-clustering.js'
export {
  activeIndices,
  buildCondensedDistanceMatrix,
  condensedIndex,
  createActiveState,
  getDistance,
  isActive,
  setDistance,
}
export type { ActiveState, MutableDistanceMatrix } from './consolidate-keywords-agglomerative-clustering.js'

type Cluster = readonly number[]

export type ClusteringProfileOptions = Readonly<{
  profile: boolean | undefined
}>

export type ProfiledClusters = Readonly<{
  clusters: readonly Cluster[]
  profile: ClusteringProfile
}>

function mergeClusters(clusters: readonly Cluster[], mergePair: readonly [number, number]): readonly Cluster[] {
  const [bestA, bestB] = mergePair
  const clusterA = clusters[bestA]
  const clusterB = clusters[bestB]
  if (clusterA === undefined || clusterB === undefined) return clusters
  return clusters.flatMap((cluster, index) => {
    if (index === bestA) {
      return [[...clusterA, ...clusterB]]
    }
    return index === bestB ? [] : [cluster]
  })
}

function filterClusters(clusters: readonly Cluster[], minClusterSize: number): readonly Cluster[] {
  return clusters.filter((cluster) => cluster.length >= minClusterSize)
}

function buildCandidatePairs(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
): readonly (readonly [number, number, number])[] {
  return normalizedEmbeddings
    .flatMap((embeddingI, i) =>
      normalizedEmbeddings.slice(i + 1).flatMap((embeddingJ, offset) => {
        const j = i + offset + 1
        const similarity = dotProduct(embeddingI, embeddingJ)
        return similarity >= threshold ? ([[i, j, similarity]] as const) : []
      }),
    )
    .toSorted((a, b) => b[2] - a[2])
}

function findClusterIndex(clusters: readonly Cluster[], item: number): number {
  return clusters.findIndex((cluster) => cluster.includes(item))
}

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

function buildClustersSingleWithGap(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  gapThreshold: number,
): readonly Cluster[] {
  let clusters: readonly Cluster[] = normalizedEmbeddings.map((_, index) => [index])

  for (const [itemI, itemJ, similarity] of buildCandidatePairs(normalizedEmbeddings, threshold)) {
    const clusterIndexI = findClusterIndex(clusters, itemI)
    const clusterIndexJ = findClusterIndex(clusters, itemJ)
    if (clusterIndexI < 0 || clusterIndexJ < 0 || clusterIndexI === clusterIndexJ) continue

    const clusterI = clusters[clusterIndexI]
    const clusterJ = clusters[clusterIndexJ]
    if (clusterI === undefined || clusterJ === undefined) continue

    const gapI = similarity - findNextBestPairwiseSimilarity(normalizedEmbeddings, itemI, itemJ)
    const gapJ = similarity - findNextBestPairwiseSimilarity(normalizedEmbeddings, itemJ, itemI)
    if (gapI < gapThreshold || gapJ < gapThreshold) continue

    clusters = mergeClusters(clusters, [clusterIndexI, clusterIndexJ])
  }

  return filterClusters(clusters, minClusterSize)
}

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
  ...rest: readonly [] | readonly [ClusteringProfileOptions | undefined]
): readonly Cluster[] | ProfiledClusters {
  const options = rest[0]
  const startedAt = performance.now()
  const shouldProfile = options === undefined ? false : options.profile === true
  const initialProfile = createClusteringProfile({
    enabled: shouldProfile,
    linkage,
    threshold,
    size: normalizedEmbeddings.length,
  })

  const complete = (
    clusters: readonly Cluster[],
    profile: ClusteringProfile,
  ): readonly Cluster[] | ProfiledClusters => {
    const completedProfile = recordClusteringTiming(profile, 'totalMs', performance.now() - startedAt)
    return shouldProfile ? { clusters, profile: completedProfile } : clusters
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

function splitGlobalClusters(
  normalizedEmbeddings: readonly Float64Array[],
  globalClusters: readonly Cluster[],
  maxClusterSize: number,
  linkage: LinkageMode,
  thresholdStep: number,
  gapThreshold: number,
): readonly Cluster[] {
  return globalClusters.flatMap((globalCluster) =>
    globalCluster.length > maxClusterSize
      ? reclusterOversizedCluster(
          normalizedEmbeddings,
          globalCluster,
          maxClusterSize,
          linkage,
          thresholdStep,
          gapThreshold,
        )
      : [globalCluster],
  )
}

function reclusterOversizedCluster(
  normalizedEmbeddings: readonly Float64Array[],
  cluster: readonly number[],
  maxClusterSize: number,
  linkage: LinkageMode,
  thresholdStep: number,
  gapThreshold: number,
): readonly Cluster[] {
  const weakestSimilarity = findWeakestInternalSimilarity(normalizedEmbeddings, cluster)
  let baseThreshold = 1
  if (weakestSimilarity !== undefined) {
    baseThreshold = weakestSimilarity
  }
  const startingThreshold = Math.min(Math.max(baseThreshold + thresholdStep, 0), 1)
  const indexedSubEmbeddings = toIndexedSubEmbeddings(normalizedEmbeddings, cluster)
  if (indexedSubEmbeddings.length <= 1) return [cluster]

  const subEmbeddings = indexedSubEmbeddings.map(({ embedding }) => embedding)
  for (let threshold = startingThreshold; threshold <= 1; threshold = Math.min(threshold + thresholdStep, 1)) {
    const localClusters = buildClustersAdvanced(subEmbeddings, threshold, 1, linkage, gapThreshold)
    if (localClusters.length <= 1 && threshold < 1) continue

    const globalClusters = mapToGlobalClusters(indexedSubEmbeddings, localClusters)
    if (globalClusters.length <= 1) return [cluster]
    return splitGlobalClusters(
      normalizedEmbeddings,
      globalClusters,
      maxClusterSize,
      linkage,
      thresholdStep,
      gapThreshold,
    )
  }
  return [cluster]
}

export function subdivideOversizedClusters(
  normalizedEmbeddings: readonly Float64Array[],
  clusters: readonly Cluster[],
  maxClusterSize: number,
  linkage: LinkageMode,
  thresholdStep: number,
  gapThreshold: number,
): readonly Cluster[] {
  if (maxClusterSize <= 0 || thresholdStep <= 0) {
    return clusters.map((cluster) => [...cluster])
  }
  return clusters.flatMap((cluster) =>
    cluster.length > maxClusterSize
      ? reclusterOversizedCluster(normalizedEmbeddings, cluster, maxClusterSize, linkage, thresholdStep, gapThreshold)
      : [[...cluster]],
  )
}
