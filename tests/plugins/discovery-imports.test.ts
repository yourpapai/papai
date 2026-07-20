// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  readLiteralDynamicImports,
  readLiteralImportMetaRequires,
  readPluginSourceGraph,
  readStaticImportSpecifiers,
} from '../../src/plugins/discovery-imports.js'

describe('readStaticImportSpecifiers', () => {
  test('collects import and export declaration module specifiers', () => {
    const source = `
      import { foo } from './foo.js'
      import type { Bar } from '../types/Bar.js'
      export { baz } from './baz.js'
      export type * from './types.js'
      const sideEffect = import('./dynamic.js')
    `
    expect(readStaticImportSpecifiers(source).sort()).toEqual(['../types/Bar.js', './baz.js', './foo.js', './types.js'])
  })

  test('ignores bare-module specifiers collection-wise but still records them', () => {
    const source = `import zod from 'zod'`
    expect(readStaticImportSpecifiers(source)).toEqual(['zod'])
  })
})

describe('readLiteralDynamicImports', () => {
  test('reads string-literal and template-literal dynamic imports', () => {
    const source = `
      const a = import('./a.js')
      const b = import(\`./b.js\`)
    `
    expect(readLiteralDynamicImports(source).sort()).toEqual(['./a.js', './b.js'])
  })

  test('throws when a dynamic import specifier is not a literal', () => {
    const source = `
      const target = './c.js'
      import(target)
    `
    expect(() => readLiteralDynamicImports(source)).toThrow(/Unresolvable plugin dynamic import/u)
  })
})

describe('readLiteralImportMetaRequires', () => {
  test('reads import.meta.require of literal specifiers', () => {
    const source = `
      const m = import.meta.require('./mod.js')
    `
    expect(readLiteralImportMetaRequires(source)).toEqual(['./mod.js'])
  })

  test('reads aliased import.meta.require calls', () => {
    const source = `
      const req = import.meta.require
      const n = req('./aliased.js')
    `
    expect(readLiteralImportMetaRequires(source)).toEqual(['./aliased.js'])
  })

  test('throws when import.meta.require specifier is non-literal', () => {
    const source = `
      const target = './non.js'
      const req = import.meta.require
      req(target)
    `
    expect(() => readLiteralImportMetaRequires(source)).toThrow(/Unresolvable plugin import.meta.require/u)
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

  test('walks static imports and dedupes visited files', () => {
    const files = new Map<string, string>([
      ['/plugin/index.ts', `import { a } from './a.js'\nimport { b } from './b.js'\n`],
      ['/plugin/a.js', `export const a = 1\n`],
      ['/plugin/b.js', `import { shared } from './shared.js'\nexport const b = 2\n`],
      ['/plugin/shared.js', `export const shared = 0\n`],
    ])
    const { deps, readFileSync } = buildDeps(files)

    const ordered = readPluginSourceGraph('/plugin/index.ts', '/plugin', deps, readFileSync)

    expect(ordered.sort()).toEqual(['/plugin/a.js', '/plugin/b.js', '/plugin/index.ts', '/plugin/shared.js'])
  })

  test('rejects bare-module specifiers in plugin entry graphs', () => {
    const files = new Map<string, string>([['/plugin/index.ts', `import 'zod'`]])
    const { deps, readFileSync } = buildDeps(files)

    expect(() => readPluginSourceGraph('/plugin/index.ts', '/plugin', deps, readFileSync)).toThrow(
      /Bare-module imports are not allowed/u,
    )
  })
})
