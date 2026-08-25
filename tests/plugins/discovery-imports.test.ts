// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { collectImports } from '../../src/plugins/discovery-import-scan.js'
import { readPluginSourceGraph } from '../../src/plugins/discovery-imports.js'
import { createSourceParser, type SourceParser } from '../../src/ts-ast/source-parser.js'

let parser: SourceParser

beforeAll(() => {
  parser = createSourceParser()
})

afterAll(async () => {
  await parser.close()
})

describe('scan: static import specifiers', () => {
  test('collects import and export declaration module specifiers', async () => {
    const source = `
      import { foo } from './foo.js'
      import type { Bar } from '../types/Bar.js'
      export { baz } from './baz.js'
      export type * from './types.js'
      const sideEffect = import('./dynamic.js')
    `
    expect(collectImports(await parser.parse('plugin-source.ts', source)).staticSpecifiers.sort()).toEqual([
      '../types/Bar.js',
      './baz.js',
      './foo.js',
      './types.js',
    ])
  })

  test('ignores bare-module specifiers collection-wise but still records them', async () => {
    const source = `import zod from 'zod'`
    expect(collectImports(await parser.parse('plugin-source.ts', source)).staticSpecifiers).toEqual(['zod'])
  })
})

describe('scan: dynamic imports', () => {
  test('reads string-literal and template-literal dynamic imports', async () => {
    const source = `
      const a = import('./a.js')
      const b = import(\`./b.js\`)
    `
    expect(collectImports(await parser.parse('plugin-source.ts', source)).dynamicSpecifiers.sort()).toEqual([
      './a.js',
      './b.js',
    ])
  })

  test('throws when a dynamic import specifier is not a literal', async () => {
    const source = `
      const target = './c.js'
      import(target)
    `
    expect(collectImports(await parser.parse('plugin-source.ts', source)).hasNonDeterministicDynamicImport).toBe(true)
  })
})

describe('scan: import.meta.require', () => {
  test('reads import.meta.require of literal specifiers', async () => {
    const source = `
      const m = import.meta.require('./mod.js')
    `
    expect(collectImports(await parser.parse('plugin-source.ts', source)).importMetaRequireSpecifiers).toEqual([
      './mod.js',
    ])
  })

  test('reads aliased import.meta.require calls', async () => {
    const source = `
      const req = import.meta.require
      const n = req('./aliased.js')
    `
    expect(collectImports(await parser.parse('plugin-source.ts', source)).importMetaRequireSpecifiers).toEqual([
      './aliased.js',
    ])
  })

  test('throws when import.meta.require specifier is non-literal', async () => {
    const source = `
      const target = './non.js'
      const req = import.meta.require
      req(target)
    `
    expect(collectImports(await parser.parse('plugin-source.ts', source)).hasNonDeterministicImportMetaRequire).toBe(
      true,
    )
  })
})

describe('readPluginSourceGraph', () => {
  function buildDeps(files: Map<string, string>): {
    deps: {
      isRelativePluginImport: (specifier: string) => boolean
      resolveEntryImport: (fromFile: string, pluginDir: string, specifier: string) => string
    }
    readFileSync: (path: string, encoding: 'utf-8') => string
  } {
    return {
      deps: {
        isRelativePluginImport: (specifier) => specifier.startsWith('./') || specifier.startsWith('../'),
        resolveEntryImport: (fromFile, _pluginDir, specifier) => new URL(specifier, `file://${fromFile}`).pathname,
      },
      readFileSync: (path) => files.get(path) ?? '',
    }
  }

  test('walks static imports and dedupes visited files', async () => {
    const files = new Map<string, string>([
      ['/plugin/index.ts', `import { a } from './a.js'\nimport { b } from './b.js'\n`],
      ['/plugin/a.js', `export const a = 1\n`],
      ['/plugin/b.js', `import { shared } from './shared.js'\nexport const b = 2\n`],
      ['/plugin/shared.js', `export const shared = 0\n`],
    ])
    const { deps, readFileSync } = buildDeps(files)

    const ordered = await readPluginSourceGraph(parser, '/plugin/index.ts', '/plugin', deps, readFileSync)

    expect(ordered.sort()).toEqual(['/plugin/a.js', '/plugin/b.js', '/plugin/index.ts', '/plugin/shared.js'])
  })

  test('rejects bare-module specifiers in plugin entry graphs', async () => {
    const files = new Map<string, string>([['/plugin/index.ts', `import 'zod'`]])
    const { deps, readFileSync } = buildDeps(files)

    await expect(readPluginSourceGraph(parser, '/plugin/index.ts', '/plugin', deps, readFileSync)).rejects.toThrow(
      /Bare-module imports are not allowed/u,
    )
  })
})
