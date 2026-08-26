// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { readPluginSourceGraph } from '../../src/plugins/discovery-imports.js'
import { createSourceParser, type SourceParser } from '../../src/ts-ast/source-parser.js'
import { expectRejection } from '../utils/test-helpers.js'

let parser: SourceParser

beforeAll(() => {
  parser = createSourceParser()
})

afterAll(async () => {
  await parser.close()
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

    await expectRejection(
      readPluginSourceGraph(parser, '/plugin/index.ts', '/plugin', deps, readFileSync),
      /Bare-module imports are not allowed/u,
    )
  })
})
