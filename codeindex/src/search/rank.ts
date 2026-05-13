import type { RankedSearchResult, SearchResult } from '../types.js'

const scopeScore = (scopeTier: SearchResult['scopeTier']): number => {
  switch (scopeTier) {
    case 'exported':
      return 400
    case 'module':
      return 300
    case 'member':
      return 200
    case 'local':
      return 100
    default:
      throw new Error(`Unsupported scope tier: ${String(scopeTier)}`)
  }
}

const matchScore = (matchReason: string): number => {
  if (matchReason.includes('exact export_names')) {
    return 500
  }
  if (matchReason.includes('exact qualified_name')) {
    return 450
  }
  if (matchReason.includes('exact local_name')) {
    return 425
  }
  return 0
}

export const scoreSearchResult = (result: Readonly<SearchResult>): number =>
  scopeScore(result.scopeTier) + matchScore(result.matchReason)

export const rerankSearchResults = (results: readonly SearchResult[]): readonly RankedSearchResult[] =>
  [...results]
    .map((result) => ({ ...result, rankScore: scoreSearchResult(result) }))
    .sort((left, right) => right.rankScore - left.rankScore)
