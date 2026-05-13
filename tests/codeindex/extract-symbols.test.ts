import { describe, expect, test } from 'bun:test'

import { extractSymbolsFromSource } from '../../codeindex/src/extract-symbols.js'
import { createParserLoader } from '../../codeindex/src/indexer/parser.js'

describe('extractSymbolsFromSource', () => {
  test('extracts exported, member, and local symbols with normalized identifier terms', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      '/** Build database client */',
      'export function getDrizzleDb() {',
      '  function makeInnerHelper() {',
      '    const storage_context_id = 1',
      '    return storage_context_id',
      '  }',
      '  return makeInnerHelper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()
    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/db/drizzle.ts',
      moduleKey: 'src/db/drizzle',
      maxStoredBodyLines: 120,
      includeDocComments: true,
      indexLocals: true,
      indexVariables: true,
    })

    expect(symbols.map((symbol) => symbol.qualifiedName)).toEqual([
      'src/db/drizzle#getDrizzleDb',
      'src/db/drizzle#getDrizzleDb>makeInnerHelper',
      'src/db/drizzle#getDrizzleDb>makeInnerHelper>storage_context_id',
    ])
    expect(symbols[0]?.scopeTier).toBe('exported')
    expect(symbols[0]?.docText).toContain('Build database client')
    expect(symbols[0]?.identifierTerms).toContain('get drizzle db')
    expect(symbols[2]?.identifierTerms).toContain('storage context id')
  })

  test('indexLocals: false omits nested function and variable symbols', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      'export function getDrizzleDb() {',
      '  function makeInnerHelper() {',
      '    const storage_context_id = 1',
      '    return storage_context_id',
      '  }',
      '  return makeInnerHelper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/db/drizzle.ts',
      moduleKey: 'src/db/drizzle',
      maxStoredBodyLines: 120,
      includeDocComments: false,
      indexLocals: false,
      indexVariables: true,
    })

    expect(symbols.map((s) => s.qualifiedName)).toEqual(['src/db/drizzle#getDrizzleDb'])
  })

  test('indexVariables: false omits variable_declarator symbols', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      'export function getDrizzleDb() {',
      '  function makeInnerHelper() {',
      '    const storage_context_id = 1',
      '    return storage_context_id',
      '  }',
      '  return makeInnerHelper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/db/drizzle.ts',
      moduleKey: 'src/db/drizzle',
      maxStoredBodyLines: 120,
      includeDocComments: false,
      indexLocals: true,
      indexVariables: false,
    })

    expect(symbols.map((s) => s.qualifiedName)).toEqual([
      'src/db/drizzle#getDrizzleDb',
      'src/db/drizzle#getDrizzleDb>makeInnerHelper',
    ])
  })

  test('indexVariables: false preserves exported const symbols', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = 'export const MAX = 1'

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/constants.ts',
      moduleKey: 'src/constants',
      maxStoredBodyLines: 10,
      includeDocComments: false,
      indexLocals: false,
      indexVariables: false,
    })

    const max = symbols.find((s) => s.localName === 'MAX')
    expect(max).toBeDefined()
    expect(max?.scopeTier).toBe('exported')
    expect(max?.exportNames).toEqual(['MAX'])
  })
})
