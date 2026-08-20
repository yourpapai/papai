// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Glob } from 'bun'

import {
  buildReverseGraph,
  defaultGraphDeps,
  GRAPH_ROOTS,
  reachableTests,
  resolveSpecifier,
  type GraphDeps,
} from '../../../scripts/test/import-graph.js'

/** In-memory `GraphDeps` over a `{ relPath: contents }` map — no filesystem involved. */
const memoryDeps = (files: Readonly<Record<string, string>>): GraphDeps => ({
  scan: (pattern): string[] => {
    const glob = new Glob(pattern)
    return Object.keys(files).filter((relPath) => glob.match(relPath))
  },
  read: (relPath): string | null => files[relPath] ?? null,
  exists: (relPath): boolean => Object.hasOwn(files, relPath),
})

const existsIn = (paths: readonly string[]): ((relPath: string) => boolean) => {
  const known = new Set(paths)
  return (relPath): boolean => known.has(relPath)
}

/** dep -> importers, expressed as plain arrays so assertions read cleanly. */
const graphOf = (edges: Readonly<Record<string, readonly string[]>>): Map<string, Set<string>> =>
  new Map(Object.entries(edges).map(([dep, importers]) => [dep, new Set(importers)]))

const asObject = (graph: Map<string, Set<string>>): Record<string, string[]> =>
  Object.fromEntries([...graph].map(([dep, importers]) => [dep, [...importers].toSorted()]))

describe('GRAPH_ROOTS', () => {
  test('covers every scanned source root', () => {
    expect([...GRAPH_ROOTS]).toEqual([
      'src/**/*.ts',
      'client/**/*.ts',
      'plugins/**/*.ts',
      'tests/**/*.ts',
      'scripts/**/*.ts',
    ])
  })
})

describe('resolveSpecifier', () => {
  test('rewrites a .js specifier to its sibling .ts file', () => {
    expect(resolveSpecifier('src/a/one.ts', './two.js', existsIn(['src/a/two.ts']))).toBe('src/a/two.ts')
  })

  test('rewrites a .js specifier to .tsx when no .ts sibling exists', () => {
    expect(resolveSpecifier('src/a/one.ts', './widget.js', existsIn(['src/a/widget.tsx']))).toBe('src/a/widget.tsx')
  })

  test('prefers the .ts rewrite over a literally present .js file', () => {
    const exists = existsIn(['src/a/two.js', 'src/a/two.ts'])

    expect(resolveSpecifier('src/a/one.ts', './two.js', exists)).toBe('src/a/two.ts')
  })

  test('resolves the literal path when the specifier already points at a real file', () => {
    expect(resolveSpecifier('src/a/one.ts', './fixture.json', existsIn(['src/a/fixture.json']))).toBe(
      'src/a/fixture.json',
    )
  })

  test('appends .ts to an extensionless specifier', () => {
    expect(resolveSpecifier('src/a/one.ts', './two', existsIn(['src/a/two.ts']))).toBe('src/a/two.ts')
  })

  test('falls back to <dir>/index.ts for a directory specifier', () => {
    expect(resolveSpecifier('src/a/one.ts', './nested', existsIn(['src/a/nested/index.ts']))).toBe(
      'src/a/nested/index.ts',
    )
  })

  test('resolves parent-relative specifiers', () => {
    expect(resolveSpecifier('src/a/deep/one.ts', '../../shared/util.js', existsIn(['src/shared/util.ts']))).toBe(
      'src/shared/util.ts',
    )
  })

  test('returns null for an unresolvable relative specifier', () => {
    expect(resolveSpecifier('src/a/one.ts', './missing.js', existsIn(['src/a/two.ts']))).toBeNull()
  })

  test('returns null for a bare package specifier', () => {
    const exists = existsIn(['zod.ts', 'node:fs.ts'])

    expect(resolveSpecifier('src/a/one.ts', 'zod', exists)).toBeNull()
    expect(resolveSpecifier('src/a/one.ts', 'node:fs', exists)).toBeNull()
  })
})

describe('buildReverseGraph', () => {
  test('records importers for static imports, type imports, re-exports, require and dynamic import', () => {
    const graph = buildReverseGraph(
      memoryDeps({
        'src/a.ts': [
          "import { b } from './b.js'",
          "import type { C } from './c.js'",
          "export { d } from './nested/index.js'",
        ].join('\n'),
        'scripts/legacy.ts': "const e = require('../src/e.js')",
        'tests/a.test.ts': ["await import('../src/b.js')", "import { a } from '../src/a.js'"].join('\n'),
        'src/b.ts': '',
        'src/c.ts': '',
        'src/e.ts': '',
        'src/nested/index.ts': '',
      }),
    )

    expect(asObject(graph)).toEqual({
      'src/b.ts': ['src/a.ts', 'tests/a.test.ts'],
      'src/c.ts': ['src/a.ts'],
      'src/nested/index.ts': ['src/a.ts'],
      'src/e.ts': ['scripts/legacy.ts'],
      'src/a.ts': ['tests/a.test.ts'],
    })
  })

  test('collapses repeated imports of the same dependency into one edge', () => {
    const graph = buildReverseGraph(
      memoryDeps({
        'src/a.ts': ["import { b } from './b.js'", "import type { B } from './b.js'"].join('\n'),
        'src/b.ts': '',
      }),
    )

    expect(asObject(graph)).toEqual({ 'src/b.ts': ['src/a.ts'] })
  })

  test('does not see a bare mock.module() target — a documented blind spot of the heuristic', () => {
    const graph = buildReverseGraph(
      memoryDeps({
        'tests/a.test.ts': "mock.module('../src/e.js', () => ({}))",
        'src/e.ts': '',
      }),
    )

    expect(graph.size).toBe(0)
  })

  test('ignores bare specifiers and unresolvable relative paths', () => {
    const graph = buildReverseGraph(
      memoryDeps({
        'src/a.ts': ["import fs from 'node:fs'", "import { z } from 'zod'", "import { g } from './gone.js'"].join('\n'),
      }),
    )

    expect(graph.size).toBe(0)
  })

  test('ignores files outside the scanned roots', () => {
    const graph = buildReverseGraph(
      memoryDeps({
        'docs/sample.ts': "import { b } from './b.js'",
        'docs/b.ts': '',
      }),
    )

    expect(graph.size).toBe(0)
  })

  test('skips files that cannot be read', () => {
    const files: Record<string, string> = { 'src/a.ts': "import { b } from './b.js'", 'src/b.ts': '' }
    const graph = buildReverseGraph({
      scan: (pattern) => {
        const glob = new Glob(pattern)
        return Object.keys(files).filter((relPath) => glob.match(relPath))
      },
      read: () => null,
      exists: (relPath) => Object.hasOwn(files, relPath),
    })

    expect(graph.size).toBe(0)
  })
})

describe('reachableTests', () => {
  // t.test.ts -> a.ts -> b.ts -> c.ts (arrows are imports), so importers run the other way.
  const chain = graphOf({
    'src/a.ts': ['tests/t.test.ts'],
    'src/b.ts': ['src/a.ts'],
    'src/c.ts': ['src/b.ts'],
  })

  test('finds nothing at depth 1 when the test is three hops away', () => {
    expect([...reachableTests(chain, ['src/c.ts'], 1)]).toEqual([])
  })

  test('finds nothing at depth 2 when the test is three hops away', () => {
    expect([...reachableTests(chain, ['src/c.ts'], 2)]).toEqual([])
  })

  test('finds the test at depth 3', () => {
    expect([...reachableTests(chain, ['src/c.ts'], 3)]).toEqual(['tests/t.test.ts'])
  })

  test('finds a directly importing test at depth 1', () => {
    expect([...reachableTests(chain, ['src/a.ts'], 1)]).toEqual(['tests/t.test.ts'])
  })

  test('expands several seeds at once', () => {
    const graph = graphOf({
      'src/a.ts': ['tests/a.test.ts'],
      'src/z.ts': ['tests/z.test.ts'],
    })

    expect([...reachableTests(graph, ['src/a.ts', 'src/z.ts'], 1)].toSorted()).toEqual([
      'tests/a.test.ts',
      'tests/z.test.ts',
    ])
  })

  test('collects test files but does not expand through them', () => {
    const graph = graphOf({
      'src/a.ts': ['tests/first.test.ts'],
      'tests/first.test.ts': ['tests/second.test.ts'],
    })

    expect([...reachableTests(graph, ['src/a.ts'], 5)]).toEqual(['tests/first.test.ts'])
  })

  test('recognises .spec and .tsx test files', () => {
    const graph = graphOf({
      'src/a.ts': ['tests/a.spec.ts', 'tests/client/a.test.tsx', 'tests/helpers.ts'],
    })

    expect([...reachableTests(graph, ['src/a.ts'], 1)].toSorted()).toEqual([
      'tests/a.spec.ts',
      'tests/client/a.test.tsx',
    ])
  })

  test('terminates on an import cycle', () => {
    const graph = graphOf({
      'src/a.ts': ['src/b.ts'],
      'src/b.ts': ['src/a.ts', 'tests/cycle.test.ts'],
    })

    expect([...reachableTests(graph, ['src/a.ts'], 10)]).toEqual(['tests/cycle.test.ts'])
  })

  test('returns an empty set for a file with no importers', () => {
    expect([...reachableTests(chain, ['src/orphan.ts'], 3)]).toEqual([])
  })

  test('returns an empty set at depth 0', () => {
    expect([...reachableTests(chain, ['src/a.ts'], 0)]).toEqual([])
  })

  test('does not report a seed that is itself a test file', () => {
    expect([...reachableTests(chain, ['tests/t.test.ts'], 3)]).toEqual([])
  })
})

describe('defaultGraphDeps', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  const makeRepo = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'import-graph-'))
    tempDirs.push(root)
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), "import { b } from './b.js'\n", 'utf8')
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 1\n', 'utf8')
    return root
  }

  test('scans, reads and probes real files under the given cwd', () => {
    const root = makeRepo()
    const deps = defaultGraphDeps(root)

    expect([...deps.scan('src/**/*.ts')].toSorted()).toEqual(['src/a.ts', 'src/b.ts'])
    expect(deps.read('src/b.ts')).toBe('export const b = 1\n')
    expect(deps.exists('src/b.ts')).toBe(true)
    expect(deps.exists('src/missing.ts')).toBe(false)
  })

  test('returns null when a file cannot be read', () => {
    const deps = defaultGraphDeps(makeRepo())

    expect(deps.read('src/missing.ts')).toBeNull()
  })

  test('builds a real reverse graph end to end', () => {
    const graph = buildReverseGraph(defaultGraphDeps(makeRepo()))

    expect(asObject(graph)).toEqual({ 'src/b.ts': ['src/a.ts'] })
  })
})
