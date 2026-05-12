import { describe, expect, test } from 'bun:test'

import {
  activeIndices,
  buildClustersAdvanced,
  buildCondensedDistanceMatrix,
  condensedIndex,
  createActiveState,
  getDistance,
  isActive,
  setDistance,
  subdivideOversizedClusters,
} from '../../../scripts/behavior-audit/consolidate-keywords-advanced-clustering.js'
import type { LinkageMode } from '../../../scripts/behavior-audit/consolidate-keywords-clustering.js'

function makeNormalized(vectors: readonly (readonly number[])[]): readonly Float64Array[] {
  return vectors.map((vector) => {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    return new Float64Array(vector.map((value) => (magnitude === 0 ? value : value / magnitude)))
  })
}

function normalizeClusters(clusters: readonly (readonly number[])[]): readonly (readonly number[])[] {
  return clusters.map((cluster) => cluster.toSorted((a, b) => a - b)).toSorted((a, b) => a[0]! - b[0]!)
}

function referenceCosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0)
  const magnitudeA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0))
  return magnitudeA === 0 || magnitudeB === 0 ? 0 : dot / (magnitudeA * magnitudeB)
}

type ReferenceUnionFind = {
  parent: Int32Array
  rank: Uint8Array
}

function createReferenceUnionFind(size: number): ReferenceUnionFind {
  return {
    parent: Int32Array.from({ length: size }, (_, index) => index),
    rank: new Uint8Array(size),
  }
}

function referenceFind(unionFind: ReferenceUnionFind, index: number): number {
  const parent = unionFind.parent[index]
  if (parent === undefined || parent === index) return index
  unionFind.parent[index] = referenceFind(unionFind, parent)
  return unionFind.parent[index] ?? index
}

function referenceUnion(unionFind: ReferenceUnionFind, left: number, right: number): void {
  const leftRoot = referenceFind(unionFind, left)
  const rightRoot = referenceFind(unionFind, right)
  if (leftRoot === rightRoot) return

  const leftRank = unionFind.rank[leftRoot] ?? 0
  const rightRank = unionFind.rank[rightRoot] ?? 0
  if (leftRank < rightRank) {
    unionFind.parent[leftRoot] = rightRoot
    return
  }
  if (leftRank > rightRank) {
    unionFind.parent[rightRoot] = leftRoot
    return
  }

  unionFind.parent[rightRoot] = leftRoot
  unionFind.rank[leftRoot] = leftRank + 1
}

function referenceBuildClustersNormalized(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
): readonly (readonly number[])[] {
  const unionFind = createReferenceUnionFind(normalizedEmbeddings.length)
  for (let i = 0; i < normalizedEmbeddings.length; i++) {
    for (let j = i + 1; j < normalizedEmbeddings.length; j++) {
      const left = normalizedEmbeddings[i]
      const right = normalizedEmbeddings[j]
      if (left === undefined || right === undefined) continue
      const similarity = referenceCosineSimilarity(Array.from(left), Array.from(right))
      if (similarity >= threshold) {
        referenceUnion(unionFind, i, j)
      }
    }
  }

  const groups = normalizedEmbeddings.reduce<Map<number, number[]>>((result, _, index) => {
    const root = referenceFind(unionFind, index)
    const existing = result.get(root)
    if (existing === undefined) {
      result.set(root, [index])
      return result
    }
    existing.push(index)
    return result
  }, new Map<number, number[]>())

  return [...groups.values()].filter((group) => group.length >= minClusterSize).map((group) => [...group])
}

function referenceAverageLinkageSimilarity(
  embeddings: readonly Float64Array[],
  clusterA: readonly number[],
  clusterB: readonly number[],
): number {
  if (clusterA.length === 0 || clusterB.length === 0) return 0

  const similarities = clusterA.flatMap((leftIndex) => {
    const left = embeddings[leftIndex]
    if (left === undefined) return []
    return clusterB.flatMap((rightIndex) => {
      const right = embeddings[rightIndex]
      return right === undefined ? [] : [referenceCosineSimilarity(Array.from(left), Array.from(right))]
    })
  })

  if (similarities.length === 0) return 0
  return similarities.reduce((sum, similarity) => sum + similarity, 0) / similarities.length
}

function referenceCompleteLinkageSimilarity(
  embeddings: readonly Float64Array[],
  clusterA: readonly number[],
  clusterB: readonly number[],
): number {
  if (clusterA.length === 0 || clusterB.length === 0) return 0

  const similarities = clusterA.flatMap((leftIndex) => {
    const left = embeddings[leftIndex]
    if (left === undefined) return []
    return clusterB.flatMap((rightIndex) => {
      const right = embeddings[rightIndex]
      return right === undefined ? [] : [referenceCosineSimilarity(Array.from(left), Array.from(right))]
    })
  })

  return similarities.length === 0 ? 0 : Math.min(...similarities)
}

function naiveAverageOrCompleteCandidates(
  embeddings: readonly Float64Array[],
  clusters: readonly (readonly number[])[],
  threshold: number,
  linkageFn: (embeddings: readonly Float64Array[], clusterA: readonly number[], clusterB: readonly number[]) => number,
): readonly { readonly i: number; readonly j: number; readonly similarity: number }[] {
  return clusters.flatMap((clusterA, i) =>
    clusters.slice(i + 1).flatMap((clusterB, offset) => {
      const j = i + offset + 1
      const similarity = linkageFn(embeddings, clusterA, clusterB)
      return similarity >= threshold ? [{ i, j, similarity }] : []
    }),
  )
}

function naiveAverageOrCompleteClusters(
  embeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: 'average' | 'complete',
): readonly (readonly number[])[] {
  const linkageFn = linkage === 'average' ? referenceAverageLinkageSimilarity : referenceCompleteLinkageSimilarity
  let clusters: readonly (readonly number[])[] = embeddings.map((_, index) => [index])
  for (;;) {
    const candidates = naiveAverageOrCompleteCandidates(embeddings, clusters, threshold, linkageFn)
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

describe('reference linkage helpers', () => {
  test('average linkage reference returns 1 for identical singleton clusters', () => {
    const embeddings = [new Float64Array([1, 0, 0])]
    const result = referenceAverageLinkageSimilarity(embeddings, [0], [0])
    expect(result).toBeCloseTo(1)
  })

  test('average linkage reference returns correct average for known vectors', () => {
    const s = 1 / Math.sqrt(2)
    const embeddings = [new Float64Array([1, 0]), new Float64Array([s, s]), new Float64Array([0, 1])]
    const result = referenceAverageLinkageSimilarity(embeddings, [0, 1], [2])
    expect(result).toBeCloseTo(s / 2)
  })

  test('average linkage reference returns 0 for orthogonal clusters', () => {
    const embeddings = [new Float64Array([1, 0, 0]), new Float64Array([0, 1, 0])]
    const result = referenceAverageLinkageSimilarity(embeddings, [0], [1])
    expect(result).toBeCloseTo(0)
  })

  test('complete linkage reference returns 1 for identical singleton clusters', () => {
    const embeddings = [new Float64Array([1, 0, 0])]
    const result = referenceCompleteLinkageSimilarity(embeddings, [0], [0])
    expect(result).toBeCloseTo(1)
  })

  test('complete linkage reference returns minimum pairwise similarity', () => {
    const s = 1 / Math.sqrt(2)
    const embeddings = [new Float64Array([1, 0]), new Float64Array([s, s]), new Float64Array([0, 1])]
    const result = referenceCompleteLinkageSimilarity(embeddings, [0, 1], [2])
    expect(result).toBeCloseTo(0)
  })

  test('complete linkage reference returns max when all pairs have same similarity', () => {
    const embeddings = [new Float64Array([1, 0]), new Float64Array([1, 0])]
    const result = referenceCompleteLinkageSimilarity(embeddings, [0], [1])
    expect(result).toBeCloseTo(1)
  })
})

describe('buildClustersAdvanced', () => {
  test('average linkage matches naive reference on a deterministic small fixture', () => {
    const embeddings = makeNormalized([
      [1, 0, 0],
      [0.96, 0.28, 0],
      [0.88, 0.47, 0],
      [0, 1, 0],
      [0, 0.95, 0.31],
    ])

    const actual = buildClustersAdvanced(embeddings, 0.78, 2, 'average', 0)
    const expected = naiveAverageOrCompleteClusters(embeddings, 0.78, 2, 'average')

    expect(normalizeClusters(actual)).toEqual(normalizeClusters(expected))
  })

  test('complete linkage matches naive reference on a deterministic small fixture', () => {
    const embeddings = makeNormalized([
      [1, 0, 0],
      [0.96, 0.28, 0],
      [0.88, 0.47, 0],
      [0, 1, 0],
      [0, 0.95, 0.31],
    ])

    const actual = buildClustersAdvanced(embeddings, 0.78, 2, 'complete', 0)
    const expected = naiveAverageOrCompleteClusters(embeddings, 0.78, 2, 'complete')

    expect(normalizeClusters(actual)).toEqual(normalizeClusters(expected))
  })

  test.each<LinkageMode>(['average', 'complete'])('%s linkage prevents transitive chaining', (linkage) => {
    const s = 1 / Math.sqrt(2)
    const embeddings = makeNormalized([
      [1, 0, 0],
      [s, s, 0],
      [0, 1, 0],
    ])

    const clusters = buildClustersAdvanced(embeddings, 0.5, 2, linkage, 0)

    expect(normalizeClusters(clusters)).toEqual([[0, 1]])
  })

  test('single linkage matches buildClustersNormalized behavior', () => {
    const s = 1 / Math.sqrt(2)
    const embeddings = makeNormalized([
      [1, 0, 0],
      [s, s, 0],
      [0, 1, 0],
    ])

    const clusters = buildClustersAdvanced(embeddings, 0.5, 2, 'single', 0)
    const original = referenceBuildClustersNormalized(embeddings, 0.5, 2)

    expect(normalizeClusters(clusters)).toEqual(normalizeClusters(original))
  })

  test('complete linkage is most conservative across linkage modes', () => {
    const embeddings = makeNormalized([
      [1, 0, 0],
      [0.8, 0.6, 0],
      [0.8, -1 / 15, Math.sqrt(80) / 15],
    ])

    const singleClusters = buildClustersAdvanced(embeddings, 0.7, 2, 'single', 0)
    const averageClusters = buildClustersAdvanced(embeddings, 0.7, 2, 'average', 0)
    const completeClusters = buildClustersAdvanced(embeddings, 0.7, 2, 'complete', 0)

    expect(normalizeClusters(singleClusters)).toEqual([[0, 1, 2]])
    expect(normalizeClusters(averageClusters)).toEqual([[0, 1, 2]])
    expect(normalizeClusters(completeClusters)).toEqual([[0, 1]])
  })

  test('returns empty for threshold above all similarities', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [0, 1],
    ])

    const clusters = buildClustersAdvanced(embeddings, 0.99, 2, 'average', 0)

    expect(clusters).toHaveLength(0)
  })

  test('respects minClusterSize', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [1, 0],
    ])

    const clusters = buildClustersAdvanced(embeddings, 0.5, 3, 'average', 0)

    expect(clusters).toHaveLength(0)
  })

  test('single linkage with all identical vectors returns one cluster', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [1, 0],
      [1, 0],
    ])

    const clusters = buildClustersAdvanced(embeddings, 0.99, 2, 'single', 0)

    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(3)
  })

  test('average linkage handles hundreds of vectors without timing out', () => {
    const vectors = Array.from({ length: 600 }, (_, i) => {
      const group = Math.floor(i / 20)
      const angle = group * 0.1 + (i % 20) * 0.001
      return [Math.cos(angle), Math.sin(angle), (i % 7) / 100]
    })
    const embeddings = makeNormalized(vectors)
    const start = performance.now()

    const clusters = buildClustersAdvanced(embeddings, 0.99, 2, 'average', 0)
    const elapsed = performance.now() - start

    expect(clusters.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(5000)
  })

  test('buildClustersAdvanced returns identical clusters when profiling is enabled', () => {
    const normalized = makeNormalized([
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
})

describe('buildClustersAdvanced gap threshold', () => {
  test('single linkage gap threshold blocks ambiguous merges', () => {
    const embeddings = makeNormalized([
      [1, 0, 0],
      [0.85, 0.53, 0],
      [0.85, -0.53, 0],
    ])

    const withoutGap = buildClustersAdvanced(embeddings, 0.8, 2, 'single', 0)
    const withGap = buildClustersAdvanced(embeddings, 0.8, 2, 'single', 0.2)

    expect(normalizeClusters(withoutGap)).toEqual([[0, 1, 2]])
    expect(withGap).toEqual([])
  })

  test('single linkage gap considers alternatives already inside current clusters', () => {
    const embeddings = [
      [1, 0, 0],
      [0.99, 0.14106735979665894, 0],
      [0.92, 0.13610519136160038, 0.3675260220507143],
      [0, 1, 0],
    ].map((vector) => new Float64Array(vector))

    const withoutGap = buildClustersAdvanced(embeddings, 0.9, 2, 'single', 0)
    const withGap = buildClustersAdvanced(embeddings, 0.9, 2, 'single', 0.05)

    expect(normalizeClusters(withoutGap)).toEqual([[0, 1, 2]])
    expect(normalizeClusters(withGap)).toEqual([[0, 1]])
  })

  test('single linkage gap rejection does not stop later unambiguous pairs', () => {
    const embeddings = makeNormalized([
      [1, 0, 0],
      [0.96, 0.28, 0],
      [0.95, 0.31, 0],
      [0, 1, 0],
      [0, 0.99, 0.1],
    ])

    const clusters = buildClustersAdvanced(embeddings, 0.9, 2, 'single', 0.05)

    expect(normalizeClusters(clusters)).toEqual([[3, 4]])
  })

  test.each<LinkageMode>(['average', 'complete'])(
    '%s linkage gap threshold blocks ambiguous first merge',
    (linkage) => {
      const embeddings = makeNormalized([
        [1, 0, 0],
        [0.85, 0.53, 0],
        [0.85, -0.53, 0],
      ])

      const withoutGap = buildClustersAdvanced(embeddings, 0.8, 2, linkage, 0)
      const withGap = buildClustersAdvanced(embeddings, 0.8, 2, linkage, 0.2)

      expect(withoutGap).toHaveLength(1)
      expect(withoutGap[0]).toHaveLength(2)
      expect(withGap).toEqual([])
    },
  )

  test.each<LinkageMode>(['average', 'complete'])(
    '%s linkage continues searching after rejecting an ambiguous best merge',
    (linkage) => {
      const embeddings = makeNormalized([
        [1, 0, 0, 0, 0],
        [0.95, Math.sqrt(1 - 0.95 ** 2), 0, 0, 0],
        [0.9, (0.72 - 0.95 * 0.9) / Math.sqrt(1 - 0.95 ** 2), 0.055677643628300216, 0, 0],
        [0, 0, 0, 1, 0],
        [0, 0, 0, 0.85, Math.sqrt(1 - 0.85 ** 2)],
      ])

      const withoutGap = buildClustersAdvanced(embeddings, 0.8, 2, linkage, 0)
      const withGap = buildClustersAdvanced(embeddings, 0.8, 2, linkage, 0.06)

      expect(normalizeClusters(withoutGap)).toContainEqual([3, 4])
      expect(normalizeClusters(withGap)).toEqual([[3, 4]])
    },
  )
})

describe('nearest-neighbor-chain distance helpers', () => {
  test('condensedIndex maps unordered pairs into condensed matrix slots', () => {
    expect(condensedIndex(0, 1, 4)).toBe(0)
    expect(condensedIndex(0, 3, 4)).toBe(2)
    expect(condensedIndex(1, 3, 4)).toBe(4)
    expect(condensedIndex(3, 1, 4)).toBe(4)
  })

  test('buildCondensedDistanceMatrix stores cosine distances symmetrically', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [0, 1],
      [1, 1],
    ])

    const matrix = buildCondensedDistanceMatrix(embeddings)

    expect(matrix.n).toBe(3)
    expect(matrix.values).toHaveLength(3)
    expect(getDistance(matrix, 0, 0)).toBe(0)
    expect(getDistance(matrix, 0, 1)).toBeCloseTo(1)
    expect(getDistance(matrix, 1, 0)).toBeCloseTo(1)
    expect(getDistance(matrix, 0, 2)).toBeCloseTo(1 - 1 / Math.sqrt(2))

    setDistance(matrix, 2, 0, 0.25)
    expect(getDistance(matrix, 0, 2)).toBeCloseTo(0.25)
  })

  test('active state tracks active indexes and cluster sizes', () => {
    const state = createActiveState(3)

    expect(activeIndices(state)).toEqual([0, 1, 2])
    expect(isActive(state, 1)).toBe(true)

    state.active[1] = 0
    state.sizes[0] = 2
    state.sizes[1] = 0

    expect(activeIndices(state)).toEqual([0, 2])
    expect(isActive(state, 1)).toBe(false)
    expect(Array.from(state.sizes)).toEqual([2, 0, 1])
  })
})

describe('subdivideOversizedClusters', () => {
  test('returns clusters unchanged when all are within maxClusterSize', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [0.99, 0.14],
      [0, 1],
    ])
    const clusters = [[0, 1]]

    const result = subdivideOversizedClusters(embeddings, clusters, 5, 'single', 0.01, 0)

    expect(result).toEqual(clusters)
  })

  test('splits an oversized cluster by re-clustering above its weakest internal similarity', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [0.99, 0.14],
      [0.98, 0.2],
      [0.5, 0.87],
      [0, 1],
    ])
    const clusters = [[0, 1, 2, 3, 4]]

    const result = subdivideOversizedClusters(embeddings, clusters, 2, 'single', 0.01, 0)

    expect(result.length).toBeGreaterThan(1)
    for (const cluster of result) {
      expect(cluster.length).toBeLessThanOrEqual(2)
    }
    expect(result.flat().toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  test('returns an oversized cluster unchanged when no further split is possible', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [1, 0],
      [1, 0],
    ])
    const clusters = [[0, 1, 2]]

    const result = subdivideOversizedClusters(embeddings, clusters, 2, 'single', 0.05, 0)

    expect(result).toEqual(clusters)
  })

  test('uses the 1.0 ceiling attempt when weakest similarity plus step would overshoot it', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [1, 0],
      [0.999, 0.0447],
    ])
    const clusters = [[0, 1, 2]]

    const result = subdivideOversizedClusters(embeddings, clusters, 2, 'average', 0.01, 0)

    expect(result).toEqual([[0, 1], [2]])
  })

  test('preserves gapThreshold while re-splitting oversized clusters', () => {
    const embeddings = makeNormalized([
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0],
    ])
    const clusters = [[0, 1, 2, 3]]

    const result = subdivideOversizedClusters(embeddings, clusters, 2, 'single', 0.05, 0.1)

    expect(result).toEqual([[0], [1], [2], [3]])
  })
})
