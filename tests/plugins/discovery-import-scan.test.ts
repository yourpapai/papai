// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { collectImports } from '../../src/plugins/discovery-import-scan.js'
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

  test('flags when a dynamic import specifier is not a literal', async () => {
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

  test('flags when import.meta.require specifier is non-literal', async () => {
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
