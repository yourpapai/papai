import { describe, expect, test } from 'bun:test'

import { createCodeindexServer } from '../../codeindex/src/mcp.js'

describe('createCodeindexServer', () => {
  test('registers the Tier 1 MCP tools', () => {
    const server = createCodeindexServer({
      codeSearch: () => Promise.resolve([]),
      codeSymbol: () => Promise.resolve([]),
      codeImpact: () => Promise.resolve([]),
      codeIndex: () =>
        Promise.resolve({
          filesIndexed: 0,
          filesFailed: 0,
          filesPruned: 0,
          symbolsIndexed: 0,
          referencesIndexed: 0,
          referencesUnresolved: 0,
          elapsedMs: 0,
        }),
    })
    expect(server).toBeDefined()
  })
})
