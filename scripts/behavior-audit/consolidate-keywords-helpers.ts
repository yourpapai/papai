import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'

// Clustering helpers are implemented in the extracted clustering module.
export {
  averageLinkageSimilarity,
  buildClusters,
  buildClustersNormalized,
  buildUnionFind,
  completeLinkageSimilarity,
  cosineSimilarity,
  dotProduct,
  find,
  findWeakestInternalSimilarity,
  mapToGlobalClusters,
  toIndexedSubEmbeddings,
  toNormalizedFloat64Arrays,
  union,
} from './consolidate-keywords-clustering.js'
export type { LinkageMode, UnionFind } from './consolidate-keywords-clustering.js'
export { buildClustersAdvanced, subdivideOversizedClusters } from './consolidate-keywords-advanced-clustering.js'

export function electCanonical(cluster: readonly KeywordVocabularyEntry[]): KeywordVocabularyEntry {
  const first = cluster[0]
  if (first === undefined) throw new Error('electCanonical called with empty cluster')
  return cluster.slice(1).reduce<KeywordVocabularyEntry>((best, entry) => {
    if (entry.slug.length < best.slug.length) return entry
    if (entry.slug.length === best.slug.length && entry.createdAt < best.createdAt) return entry
    return best
  }, first)
}

export function buildMergeMap(
  vocabulary: readonly KeywordVocabularyEntry[],
  clusters: readonly (readonly number[])[],
): ReadonlyMap<string, string> {
  const mergeMap = new Map<string, string>()
  for (const clusterIndices of clusters) {
    const clusterEntries = clusterIndices
      .map((i) => vocabulary[i])
      .filter((e): e is KeywordVocabularyEntry => e !== undefined)
    const canonical = electCanonical(clusterEntries)
    for (const entry of clusterEntries) {
      if (entry.slug !== canonical.slug) {
        mergeMap.set(entry.slug, canonical.slug)
      }
    }
  }
  return mergeMap
}

export function remapKeywords(keywords: readonly string[], mergeMap: ReadonlyMap<string, string>): readonly string[] {
  const seen = new Set<string>()
  return keywords
    .map((kw) => {
      const mapped = mergeMap.get(kw)
      if (mapped === undefined) return kw
      return mapped
    })
    .filter((kw) => {
      if (seen.has(kw)) return false
      seen.add(kw)
      return true
    })
}

export function buildConsolidatedVocabulary(
  vocabulary: readonly KeywordVocabularyEntry[],
  mergeMap: ReadonlyMap<string, string>,
  now: string,
): readonly KeywordVocabularyEntry[] {
  const groups = new Map<string, KeywordVocabularyEntry[]>()
  for (const entry of vocabulary) {
    const mappedSlug = mergeMap.get(entry.slug)
    let canonicalSlug = entry.slug
    if (mappedSlug !== undefined) {
      canonicalSlug = mappedSlug
    }
    const existing = groups.get(canonicalSlug)
    if (existing === undefined) {
      groups.set(canonicalSlug, [entry])
    } else {
      existing.push(entry)
    }
  }

  return [...groups.entries()]
    .map(([canonicalSlug, entries]) => {
      const firstEntry = entries[0]!
      if (entries.length === 1) return firstEntry
      const earliestCreatedAt = entries.reduce(
        (min, e) => (e.createdAt < min ? e.createdAt : min),
        firstEntry.createdAt,
      )
      const longestDescription = entries.reduce(
        (best, e) => (e.description.length > best.length ? e.description : best),
        firstEntry.description,
      )
      return {
        slug: canonicalSlug,
        description: longestDescription,
        createdAt: earliestCreatedAt,
        updatedAt: now,
      } satisfies KeywordVocabularyEntry
    })
    .toSorted((a, b) => a.slug.localeCompare(b.slug))
}
