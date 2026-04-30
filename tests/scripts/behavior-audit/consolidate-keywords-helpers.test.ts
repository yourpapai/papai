import { describe, expect, test } from 'bun:test'

import {
  activeIndices,
  buildCondensedDistanceMatrix,
  condensedIndex,
  createActiveState,
  getDistance,
  isActive,
  setDistance,
} from '../../../scripts/behavior-audit/consolidate-keywords-advanced-clustering.js'
import {
  averageLinkageSimilarity,
  buildClustersAdvanced,
  buildClusters,
  buildClustersNormalized,
  buildConsolidatedVocabulary,
  buildMergeMap,
  buildUnionFind,
  completeLinkageSimilarity,
  cosineSimilarity,
  electCanonical,
  find,
  remapKeywords,
  subdivideOversizedClusters,
  toNormalizedFloat64Arrays,
  union,
} from '../../../scripts/behavior-audit/consolidate-keywords-helpers.js'
import type { LinkageMode } from '../../../scripts/behavior-audit/consolidate-keywords-helpers.js'
import type { KeywordVocabularyEntry } from '../../../scripts/behavior-audit/keyword-vocabulary.js'
import { parseArgs } from '../../../scripts/behavior-audit/tune-embedding.js'

function makeNormalized(vectors: readonly (readonly number[])[]): readonly Float64Array[] {
  return vectors.map((vector) => {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    return new Float64Array(vector.map((value) => (magnitude === 0 ? value : value / magnitude)))
  })
}

function normalizeClusters(clusters: readonly (readonly number[])[]): readonly (readonly number[])[] {
  return clusters.map((cluster) => cluster.toSorted((a, b) => a - b)).toSorted((a, b) => a[0]! - b[0]!)
}

function naiveAverageOrCompleteCandidates(
  embeddings: readonly Float64Array[],
  clusters: readonly (readonly number[])[],
  threshold: number,
  linkageFn: typeof averageLinkageSimilarity,
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
  const linkageFn = linkage === 'average' ? averageLinkageSimilarity : completeLinkageSimilarity
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

// ── cosineSimilarity ──────────────────────────────────────────────────────────

test('cosineSimilarity of identical vectors is 1', () => {
  expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
})

test('cosineSimilarity of orthogonal vectors is 0', () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
})

test('cosineSimilarity of known angle', () => {
  const s = 1 / Math.sqrt(2)
  expect(cosineSimilarity([1, 0], [s, s])).toBeCloseTo(s)
})

test('cosineSimilarity with zero vector returns 0', () => {
  expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
})

// ── union-find ────────────────────────────────────────────────────────────────

test('buildUnionFind initialises each element as its own root', () => {
  const uf = buildUnionFind(3)
  expect(find(uf, 0)).toBe(0)
  expect(find(uf, 1)).toBe(1)
  expect(find(uf, 2)).toBe(2)
})

test('union merges two elements into the same component', () => {
  const uf = buildUnionFind(3)
  union(uf, 0, 1)
  expect(find(uf, 0)).toBe(find(uf, 1))
})

test('union is transitive via union-find', () => {
  const uf = buildUnionFind(3)
  union(uf, 0, 1)
  union(uf, 1, 2)
  expect(find(uf, 0)).toBe(find(uf, 2))
})

// ── buildClusters ─────────────────────────────────────────────────────────────

test('buildClusters returns no clusters when all pairs are below threshold', () => {
  const embeddings = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const clusters = buildClusters(embeddings, 0.99, 2)
  expect(clusters).toHaveLength(0)
})

test('buildClusters returns a cluster when similarity meets threshold', () => {
  // a=[1,0], b=[0.9,0.1] — cosine similarity ≈ 0.994
  const a = [1, 0]
  const mag = Math.sqrt(0.9 * 0.9 + 0.1 * 0.1)
  const b = [0.9 / mag, 0.1 / mag]
  const clusters = buildClusters([a, b], 0.99, 2)
  expect(clusters).toHaveLength(1)
  expect(clusters[0]).toHaveLength(2)
})

test('buildClusters handles transitivity: a~b and b~c should merge all three', () => {
  const s = 1 / Math.sqrt(2)
  const a = [1, 0, 0]
  const b = [s, s, 0]
  const c = [0, 1, 0]
  // cos(a,b) ≈ 0.707, cos(b,c) ≈ 0.707, cos(a,c) = 0
  const clusters = buildClusters([a, b, c], 0.5, 2)
  expect(clusters).toHaveLength(1)
  expect(clusters[0]).toHaveLength(3)
})

test('buildClusters respects minClusterSize', () => {
  // a=[1,0], b=[0.9,0.1] would form a cluster but minClusterSize=3
  const a = [1, 0]
  const mag = Math.sqrt(0.9 * 0.9 + 0.1 * 0.1)
  const b = [0.9 / mag, 0.1 / mag]
  const clusters = buildClusters([a, b], 0.99, 3)
  expect(clusters).toHaveLength(0)
})

describe('averageLinkageSimilarity', () => {
  test('returns 1 for identical singleton clusters', () => {
    const embs = [new Float64Array([1, 0, 0])]
    const result = averageLinkageSimilarity(embs, [0], [0])
    expect(result).toBeCloseTo(1)
  })

  test('returns correct average for known vectors', () => {
    const s = 1 / Math.sqrt(2)
    const embs = [new Float64Array([1, 0]), new Float64Array([s, s]), new Float64Array([0, 1])]
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
    const embs = [new Float64Array([1, 0]), new Float64Array([s, s]), new Float64Array([0, 1])]
    const result = completeLinkageSimilarity(embs, [0, 1], [2])
    expect(result).toBeCloseTo(0)
  })

  test('returns max when all pairs have same similarity', () => {
    const embs = [new Float64Array([1, 0]), new Float64Array([1, 0])]
    const result = completeLinkageSimilarity(embs, [0], [1])
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
    const original = buildClustersNormalized(embeddings, 0.5, 2)

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

describe('parseArgs', () => {
  test('rejects unsupported linkage values explicitly', () => {
    expect(() => parseArgs(['--linkage', 'ward'])).toThrow("Unsupported linkage 'ward'")
  })

  test.each([
    ['--threshold', 'NaN'],
    ['--threshold', 'Infinity'],
    ['--min-cluster-size', 'NaN'],
    ['--max-cluster-size', 'Infinity'],
    ['--gap-threshold', 'NaN'],
  ])('rejects non-finite numeric value for %s', (flag, value) => {
    expect(() => parseArgs([flag, value])).toThrow(`Invalid numeric value for ${flag}: ${value}`)
  })
})

// ── electCanonical ────────────────────────────────────────────────────────────

function makeEntry(slug: string, createdAt: string | null): KeywordVocabularyEntry {
  if (createdAt === null) {
    return { slug, description: 'desc', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  }
  return { slug, description: 'desc', createdAt, updatedAt: '2026-01-01T00:00:00.000Z' }
}

test('electCanonical selects the shorter slug', () => {
  const entries = [makeEntry('long-slug-name', null), makeEntry('short', null)]
  const canonical = electCanonical(entries)
  expect(canonical.slug).toBe('short')
})

test('electCanonical breaks slug length tie by earliest createdAt', () => {
  const entries = [makeEntry('aaa', '2026-02-01T00:00:00.000Z'), makeEntry('bbb', '2026-01-01T00:00:00.000Z')]
  const canonical = electCanonical(entries)
  expect(canonical.slug).toBe('bbb')
})

// ── buildMergeMap ─────────────────────────────────────────────────────────────

test('buildMergeMap maps non-canonical slugs to canonical slug', () => {
  const vocab = [makeEntry('short', null), makeEntry('longer-version', null), makeEntry('also-longer', null)]
  // cluster: indices [0, 1, 2] — 'short' is canonical
  const clusters = [[0, 1, 2]]
  const mergeMap = buildMergeMap(vocab, clusters)
  expect(mergeMap.get('longer-version')).toBe('short')
  expect(mergeMap.get('also-longer')).toBe('short')
  // canonical not in map
  expect(mergeMap.has('short')).toBe(false)
})

test('buildMergeMap does not include unclustered entries', () => {
  const vocab = [makeEntry('solo', null), makeEntry('a', null), makeEntry('b', null)]
  // indices 1 and 2 are clustered; 0 is solo
  const clusters = [[1, 2]]
  const mergeMap = buildMergeMap(vocab, clusters)
  expect(mergeMap.has('solo')).toBe(false)
  expect(mergeMap.size).toBe(1)
})

// ── remapKeywords ─────────────────────────────────────────────────────────────

test('remapKeywords replaces keywords that appear in mergeMap', () => {
  const mergeMap = new Map([['old-slug', 'new-slug']])
  const result = remapKeywords(['old-slug', 'other'], mergeMap)
  expect(result).toEqual(['new-slug', 'other'])
})

test('remapKeywords deduplicates after remapping', () => {
  const mergeMap = new Map([
    ['alias', 'canonical'],
    ['alias2', 'canonical'],
  ])
  const result = remapKeywords(['alias', 'alias2', 'unrelated'], mergeMap)
  expect(result).toEqual(['canonical', 'unrelated'])
})

test('remapKeywords preserves order (first occurrence wins after dedup)', () => {
  const mergeMap = new Map([['b', 'a']])
  const result = remapKeywords(['a', 'b', 'c'], mergeMap)
  // 'b'→'a' deduped since 'a' already present
  expect(result).toEqual(['a', 'c'])
})

test('remapKeywords leaves unaffected keywords unchanged', () => {
  const mergeMap = new Map<string, string>()
  const result = remapKeywords(['one', 'two', 'three'], mergeMap)
  expect(result).toEqual(['one', 'two', 'three'])
})

// ── buildConsolidatedVocabulary ───────────────────────────────────────────────

test('buildConsolidatedVocabulary removes merged slugs and keeps canonicals', () => {
  const vocab = [
    {
      slug: 'short',
      description: 'short desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      slug: 'long-variant',
      description: 'a longer description for the variant',
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    },
  ]
  const mergeMap = new Map([['long-variant', 'short']])
  const now = '2026-04-27T12:00:00.000Z'
  const result = buildConsolidatedVocabulary(vocab, mergeMap, now)

  expect(result).toHaveLength(1)
  const entry = result[0]!
  expect(entry.slug).toBe('short')
  // longest description wins
  expect(entry.description).toBe('a longer description for the variant')
  // earliest createdAt preserved
  expect(entry.createdAt).toBe('2026-01-01T00:00:00.000Z')
  // updatedAt = now (was merged)
  expect(entry.updatedAt).toBe(now)
})

test('buildConsolidatedVocabulary leaves unmerged entries unchanged', () => {
  const vocab = [
    {
      slug: 'standalone',
      description: 'desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]
  const mergeMap = new Map<string, string>()
  const now = '2026-04-27T12:00:00.000Z'
  const result = buildConsolidatedVocabulary(vocab, mergeMap, now)

  expect(result).toHaveLength(1)
  expect(result[0]).toEqual(vocab[0])
})

test('buildConsolidatedVocabulary returns entries sorted by slug', () => {
  const vocab = [
    { slug: 'zebra', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { slug: 'alpha', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]
  const result = buildConsolidatedVocabulary(vocab, new Map(), '2026-04-27T00:00:00.000Z')
  expect(result[0]!.slug).toBe('alpha')
  expect(result[1]!.slug).toBe('zebra')
})
