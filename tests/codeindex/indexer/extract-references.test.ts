import { describe, expect, test } from 'bun:test'

import { extractReferenceCandidates } from '../../../codeindex/src/indexer/extract-references.js'
import { createParserLoader } from '../../../codeindex/src/indexer/parser.js'

describe('extractReferenceCandidates', () => {
  test('captures imports, reexports, and call references', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      "import { helper } from './helper.js'",
      "export { helper as publicHelper } from './helper.js'",
      'export function runTask() {',
      '  return helper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const result = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/run-task.ts',
      moduleKey: 'src/run-task',
    })

    expect(result.moduleExports).toEqual([
      {
        exportName: 'publicHelper',
        exportKind: 'reexport',
        localName: 'helper',
        targetModuleSpecifier: './helper.js',
      },
      {
        exportName: 'runTask',
        exportKind: 'named',
        localName: 'runTask',
        targetModuleSpecifier: null,
      },
    ])

    const importHelper = result.references.filter((ref) => ref.edgeType === 'imports').at(0)
    expect(importHelper).toBeDefined()
    expect(importHelper!.targetName).toBe('helper')
    expect(importHelper!.targetModuleSpecifier).toBe('./helper.js')

    const callHelper = result.references.filter((ref) => ref.edgeType === 'calls').at(0)
    expect(callHelper).toBeDefined()
    expect(callHelper!.targetName).toBe('helper')
  })

  test('aliased named import uses alias as targetName and original as targetExportName', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      "import { helper as localHelper } from './helper.js'",
      'export function runTask() {',
      '  return localHelper()',
      '}',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const result = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/run-task.ts',
      moduleKey: 'src/run-task',
    })

    const importRef = result.references.filter((ref) => ref.edgeType === 'imports').at(0)
    expect(importRef).toBeDefined()
    expect(importRef!.targetName).toBe('localHelper')
    expect(importRef!.targetExportName).toBe('helper')
    expect(importRef!.targetModuleSpecifier).toBe('./helper.js')

    const callRef = result.references.filter((ref) => ref.edgeType === 'calls').at(0)
    expect(callRef).toBeDefined()
    expect(callRef!.targetName).toBe('localHelper')
  })

  test('export default function records exportName "default" and exportKind "default"', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = 'export default function helper() { return 1 }'

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { moduleExports } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/helper.ts',
      moduleKey: 'src/helper',
    })

    expect(moduleExports).toEqual([
      {
        exportName: 'default',
        exportKind: 'default',
        localName: 'helper',
        targetModuleSpecifier: null,
      },
    ])
  })

  test('anonymous default export function records exportName "default" with localName null', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = 'export default function() { return 1 }'

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { moduleExports } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/handler.ts',
      moduleKey: 'src/handler',
    })

    expect(moduleExports).toEqual([
      {
        exportName: 'default',
        exportKind: 'default',
        localName: null,
        targetModuleSpecifier: null,
      },
    ])
  })

  test('default import records an import edge with targetExportName "default"', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = ["import helper from './helper.js'", 'export function runTask() {', '  return helper()', '}'].join(
      '\n',
    )

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { references } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/run-task.ts',
      moduleKey: 'src/run-task',
    })

    const importRef = references.filter((ref) => ref.edgeType === 'imports').at(0)
    expect(importRef).toBeDefined()
    expect(importRef!.targetName).toBe('helper')
    expect(importRef!.targetExportName).toBe('default')
    expect(importRef!.targetModuleSpecifier).toBe('./helper.js')
  })

  test('export class, abstract class, const, interface, type, and enum emit module export candidates', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      'export class Greeter {}',
      'export abstract class Base {}',
      'export const MAX = 100',
      'export interface Config { timeout: number }',
      'export type ID = string',
      'export enum Direction { Up, Down }',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { moduleExports } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/types.ts',
      moduleKey: 'src/types',
    })

    expect(moduleExports).toEqual([
      { exportName: 'Greeter', exportKind: 'named', localName: 'Greeter', targetModuleSpecifier: null },
      { exportName: 'Base', exportKind: 'named', localName: 'Base', targetModuleSpecifier: null },
      { exportName: 'MAX', exportKind: 'named', localName: 'MAX', targetModuleSpecifier: null },
      { exportName: 'Config', exportKind: 'named', localName: 'Config', targetModuleSpecifier: null },
      { exportName: 'ID', exportKind: 'named', localName: 'ID', targetModuleSpecifier: null },
      { exportName: 'Direction', exportKind: 'named', localName: 'Direction', targetModuleSpecifier: null },
    ])
  })

  test('export default class records exportName "default"', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')

    const tree = parsed.parser.parse('export default class Handler {}')
    expect(tree).not.toBeNull()

    const { moduleExports } = extractReferenceCandidates({
      source: 'export default class Handler {}',
      tree: tree!,
      relativeFilePath: 'src/handler.ts',
      moduleKey: 'src/handler',
    })

    expect(moduleExports).toEqual([
      { exportName: 'default', exportKind: 'default', localName: 'Handler', targetModuleSpecifier: null },
    ])
  })

  test('export default anonymous class records exportName "default" with localName null', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')

    const tree = parsed.parser.parse('export default class {}')
    expect(tree).not.toBeNull()

    const { moduleExports } = extractReferenceCandidates({
      source: 'export default class {}',
      tree: tree!,
      relativeFilePath: 'src/handler.ts',
      moduleKey: 'src/handler',
    })

    expect(moduleExports).toEqual([
      { exportName: 'default', exportKind: 'default', localName: null, targetModuleSpecifier: null },
    ])
  })

  test('calls inside class methods are attributed to the member qualified name', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      'export class Service {',
      '  run() {',
      '    return helper()',
      '  }',
      '}',
      'function helper() { return 1 }',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { references } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/service.ts',
      moduleKey: 'src/service',
    })

    const callRef = references.filter((ref) => ref.edgeType === 'calls').at(0)
    expect(callRef).toBeDefined()
    expect(callRef!.targetName).toBe('helper')
    expect(callRef!.sourceQualifiedName).toBe('src/service#Service>run')
  })

  test('calls inside abstract class methods are attributed to the member qualified name', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      'export abstract class Base {',
      '  process() {',
      '    return helper()',
      '  }',
      '}',
      'function helper() { return 1 }',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { references } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/base.ts',
      moduleKey: 'src/base',
    })

    const callRef = references.filter((ref) => ref.edgeType === 'calls').at(0)
    expect(callRef).toBeDefined()
    expect(callRef!.targetName).toBe('helper')
    expect(callRef!.sourceQualifiedName).toBe('src/base#Base>process')
  })

  test('calls inside anonymous default-exported class methods are attributed to the member qualified name', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      'export default class {',
      '  run() {',
      '    return helper()',
      '  }',
      '}',
      'function helper() { return 1 }',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { references } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/test.ts',
      moduleKey: 'src/test',
    })

    const callRef = references.filter((ref) => ref.edgeType === 'calls').at(0)
    expect(callRef).toBeDefined()
    expect(callRef!.targetName).toBe('helper')
    expect(callRef!.sourceQualifiedName).toBe('src/test#default>run')
  })

  test('calls inside arrow-function const are attributed to the owning symbol', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = ['export const run = () => {', '  return helper()', '}', 'function helper() { return 1 }'].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { references } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/run.ts',
      moduleKey: 'src/run',
    })

    const callRef = references.filter((ref) => ref.edgeType === 'calls').at(0)
    expect(callRef).toBeDefined()
    expect(callRef!.targetName).toBe('helper')
    expect(callRef!.sourceQualifiedName).toBe('src/run#run')
  })

  test('calls inside function-expression const are attributed to the owning symbol', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = ['export const run = function() {', '  return helper()', '}', 'function helper() { return 1 }'].join(
      '\n',
    )

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { references } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/run.ts',
      moduleKey: 'src/run',
    })

    const callRef = references.filter((ref) => ref.edgeType === 'calls').at(0)
    expect(callRef).toBeDefined()
    expect(callRef!.targetName).toBe('helper')
    expect(callRef!.sourceQualifiedName).toBe('src/run#run')
  })

  test('calls inside named function-expression const are attributed to the owning symbol', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = [
      'export const run = function inner() {',
      '  return helper()',
      '}',
      'function helper() { return 1 }',
    ].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const { references } = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/run.ts',
      moduleKey: 'src/run',
    })

    const callRef = references.filter((ref) => ref.edgeType === 'calls').at(0)
    expect(callRef).toBeDefined()
    expect(callRef!.targetName).toBe('helper')
    expect(callRef!.sourceQualifiedName).toBe('src/run#run')
  })

  test('re-export without a matching import records a reference to the source module', async () => {
    const loader = await createParserLoader()
    const parsed = await loader.createParserForExtension('.ts')
    const source = ["export { foo } from './foo.js'", "export { bar as baz } from './bar.js'"].join('\n')

    const tree = parsed.parser.parse(source)
    expect(tree).not.toBeNull()

    const result = extractReferenceCandidates({
      source,
      tree: tree!,
      relativeFilePath: 'src/index.ts',
      moduleKey: 'src/index',
    })

    const reexports = result.references.filter((ref) => ref.edgeType === 'reexports')
    expect(reexports).toHaveLength(2)
    expect(reexports[0]!.targetName).toBe('foo')
    expect(reexports[0]!.targetModuleSpecifier).toBe('./foo.js')
    expect(reexports[1]!.targetName).toBe('bar')
    expect(reexports[1]!.targetModuleSpecifier).toBe('./bar.js')
  })
})
