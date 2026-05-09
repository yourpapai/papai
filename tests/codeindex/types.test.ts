import { describe, expect, test } from 'bun:test'

import type { RankedSearchResult, SearchResult } from '../../codeindex/src/types.js'

describe('RankedSearchResult', () => {
  test('extends SearchResult with rankScore', () => {
    const base: SearchResult = {
      symbolKey: 'a',
      qualifiedName: 'src/foo#helper',
      localName: 'helper',
      kind: 'function_declaration',
      scopeTier: 'exported',
      filePath: 'src/foo.ts',
      startLine: 1,
      endLine: 1,
      exportNames: ['helper'],
      matchReason: 'exact export_names',
      confidence: 'resolved',
      snippet: 'export function helper() {}',
    }
    const ranked: RankedSearchResult = { ...base, rankScore: 900 }
    expect(ranked.rankScore).toBe(900)
    expect(ranked.symbolKey).toBe('a')
  })
})
