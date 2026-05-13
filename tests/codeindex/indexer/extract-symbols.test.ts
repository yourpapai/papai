import { describe, expect, test } from 'bun:test'

import { extractSymbolsFromSource } from '../../../codeindex/src/indexer/extract-symbols.js'
import { createParserLoader } from '../../../codeindex/src/indexer/parser.js'

describe('extractSymbolsFromSource', () => {
  test('named export function has exportNames matching the function name', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = 'export function helper() { return 1 }'

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/helper.ts',
      moduleKey: 'src/helper',
      maxStoredBodyLines: 10,
      includeDocComments: false,
      indexLocals: true,
      indexVariables: true,
    })

    const helper = symbols.find((s) => s.localName === 'helper')
    expect(helper).toBeDefined()
    expect(helper?.exportNames).toEqual(['helper'])
    expect(helper?.scopeTier).toBe('exported')
  })

  test('default export function has exportNames ["default"]', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = 'export default function helper() { return 1 }'

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/helper.ts',
      moduleKey: 'src/helper',
      maxStoredBodyLines: 10,
      includeDocComments: false,
      indexLocals: true,
      indexVariables: true,
    })

    const helper = symbols.find((s) => s.localName === 'helper')
    expect(helper).toBeDefined()
    expect(helper?.exportNames).toEqual(['default'])
    expect(helper?.scopeTier).toBe('exported')
  })

  test('exported abstract class produces a symbol with correct name and scopeTier', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = 'export abstract class Base { abstract run(): void }'

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/base.ts',
      moduleKey: 'src/base',
      maxStoredBodyLines: 10,
      includeDocComments: false,
      indexLocals: true,
      indexVariables: true,
    })

    const base = symbols.find((s) => s.localName === 'Base')
    expect(base).toBeDefined()
    expect(base?.exportNames).toEqual(['Base'])
    expect(base?.scopeTier).toBe('exported')
  })

  test('exported enum produces a symbol with correct name and scopeTier', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = 'export enum Direction { Up, Down }'

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/direction.ts',
      moduleKey: 'src/direction',
      maxStoredBodyLines: 10,
      includeDocComments: false,
      indexLocals: true,
      indexVariables: true,
    })

    const direction = symbols.find((s) => s.localName === 'Direction')
    expect(direction).toBeDefined()
    expect(direction?.exportNames).toEqual(['Direction'])
    expect(direction?.scopeTier).toBe('exported')
  })

  test('anonymous default export function produces a symbol with localName "default"', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = 'export default function() { return 1 }'

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const symbols = extractSymbolsFromSource({
      source,
      tree: tree!,
      relativeFilePath: 'src/handler.ts',
      moduleKey: 'src/handler',
      maxStoredBodyLines: 10,
      includeDocComments: false,
      indexLocals: true,
      indexVariables: true,
    })

    const defaultSymbol = symbols.find((s) => s.localName === 'default')
    expect(defaultSymbol).toBeDefined()
    expect(defaultSymbol?.exportNames).toEqual(['default'])
    expect(defaultSymbol?.qualifiedName).toBe('src/handler#default')
    expect(defaultSymbol?.scopeTier).toBe('exported')
  })
})
