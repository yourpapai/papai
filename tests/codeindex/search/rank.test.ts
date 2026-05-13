import { describe, expect, test } from 'bun:test'

import { rerankSearchResults, scoreSearchResult } from '../../../codeindex/src/search/rank.js'
import type { SearchResult } from '../../../codeindex/src/types.js'

const localResult: SearchResult = {
  symbolKey: 'a',
  qualifiedName: 'src/foo#helper',
  localName: 'helper',
  kind: 'function_declaration',
  scopeTier: 'local',
  filePath: 'src/foo.ts',
  startLine: 1,
  endLine: 1,
  exportNames: [],
  matchReason: 'exact local_name',
  confidence: 'resolved',
  snippet: 'function helper() {}',
}

const exportedResult: SearchResult = {
  symbolKey: 'b',
  qualifiedName: 'src/bar#helper',
  localName: 'helper',
  kind: 'function_declaration',
  scopeTier: 'exported',
  filePath: 'src/bar.ts',
  startLine: 1,
  endLine: 1,
  exportNames: ['helper'],
  matchReason: 'exact export_names',
  confidence: 'resolved',
  snippet: 'export function helper() {}',
}

describe('scoreSearchResult', () => {
  test('computes scope + match score for an exported exact match', () => {
    expect(scoreSearchResult(exportedResult)).toBe(400 + 500)
  })

  test('computes scope + match score for a local exact match', () => {
    expect(scoreSearchResult(localResult)).toBe(100 + 425)
  })

  test('returns scope-only score when matchReason is non-exact', () => {
    const ftsResult: SearchResult = { ...exportedResult, matchReason: 'fts identifier_terms' }
    expect(scoreSearchResult(ftsResult)).toBe(400)
  })
})

describe('rerankSearchResults', () => {
  test('attaches rankScore to each result', () => {
    const ranked = rerankSearchResults([localResult, exportedResult])
    expect(ranked[0]!.rankScore).toBe(900)
    expect(ranked[1]!.rankScore).toBe(525)
  })

  test('sorts by descending rankScore', () => {
    const ranked = rerankSearchResults([localResult, exportedResult])
    expect(ranked.map((r) => r.symbolKey)).toEqual(['b', 'a'])
  })
})
