// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  BLAST_RADIUS_INPUTS,
  BLAST_RADIUS_PREFIXES,
  buildChangedFiles,
  DEFAULT_DEPTH,
  formatBanner,
  parseAffectedArgs,
  parseStatusPorcelain,
  planCommands,
  selectAffected,
  wrapperSupportsSelectedBy,
  type PathSelection,
  type Selection,
} from '../../../scripts/test/affected.js'

/** dep -> importers, expressed as plain arrays so the fixtures read as edges. */
const graphOf = (edges: Readonly<Record<string, readonly string[]>>): Map<string, Set<string>> =>
  new Map(Object.entries(edges).map(([dep, importers]) => [dep, new Set(importers)]))

/**
 * The Task 11 shape: a chain `three -> two -> one`, with a test hanging off each
 * intermediate link, so depth is observable.
 */
const chainGraph = (): Map<string, Set<string>> =>
  graphOf({
    'src/a/three.ts': ['src/a/two.ts'],
    'src/a/two.ts': ['src/a/one.ts', 'tests/a/two.test.ts'],
    'src/a/one.ts': ['tests/a/one.test.ts'],
  })

const noCandidates = (): readonly string[] => []

/** Candidate tests for one specific source file (kept out of the test body — `no-conditional-in-test`). */
const candidatesForThree = (src: string): readonly string[] =>
  src === 'src/a/three.ts' ? ['tests/a/index.test.ts'] : []

/** Narrow without an `if` inside a test body (`vitest/no-conditional-in-test`). */
const asPaths = (selection: Selection): PathSelection => {
  if (selection.kind !== 'paths') throw new Error(`expected a paths selection, got ${selection.kind}`)
  return selection
}

const asFull = (selection: Selection): Extract<Selection, { kind: 'full' }> => {
  if (selection.kind !== 'full') throw new Error(`expected a full selection, got ${selection.kind}`)
  return selection
}

const select = (input: {
  changed: readonly string[]
  graph?: Map<string, Set<string>>
  candidates?: (srcFile: string) => readonly string[]
  depth?: number
}): Selection =>
  selectAffected({
    changed: input.changed,
    graph: input.graph ?? new Map<string, Set<string>>(),
    candidates: input.candidates ?? noCandidates,
    depth: input.depth ?? DEFAULT_DEPTH,
  })

describe('selectAffected — graph reachability', () => {
  test('selects the tests two importer hops away and not the third', () => {
    const selection = asPaths(select({ changed: ['src/a/three.ts'], graph: chainGraph() }))

    expect(selection.server).toEqual(['tests/a/two.test.ts'])
    expect(selection.depth).toBe(2)
    expect(selection.changed).toEqual(['src/a/three.ts'])
  })

  test('reaches the far test at depth 3, which is exactly what depth 2 withholds', () => {
    const selection = asPaths(select({ changed: ['src/a/three.ts'], graph: chainGraph(), depth: 3 }))

    expect(selection.server).toEqual(['tests/a/one.test.ts', 'tests/a/two.test.ts'])
  })

  test('unions the candidate tests of a changed source file with the graph hits', () => {
    const selection = asPaths(
      select({
        changed: ['src/a/three.ts'],
        graph: chainGraph(),
        candidates: candidatesForThree,
      }),
    )

    expect(selection.server).toEqual(['tests/a/index.test.ts', 'tests/a/two.test.ts'])
  })

  test('does not ask for candidate tests of a non-code file', () => {
    const asked: string[] = []
    const selection = select({
      changed: ['docs/architecture/overview.md', 'src/a/three.ts'],
      graph: chainGraph(),
      candidates: (src) => {
        asked.push(src)
        return []
      },
    })

    expect(asked).toEqual(['src/a/three.ts'])
    expect(asPaths(selection).server).toEqual(['tests/a/two.test.ts'])
  })

  test('selects a changed test file itself even with no graph edges at all', () => {
    const selection = asPaths(select({ changed: ['tests/tools/create-task.test.ts'] }))

    expect(selection.server).toEqual(['tests/tools/create-task.test.ts'])
  })

  test('deduplicates a test reached by both the graph and the candidate scan', () => {
    // `tests/a/two.test.ts` imports the changed file directly *and* is returned by the
    // candidate scan, so the union has to collapse it. `tests/a/one.test.ts` is here too
    // and legitimately so: it is the second hop, which is what depth 2 buys.
    const selection = asPaths(
      select({ changed: ['src/a/two.ts'], graph: chainGraph(), candidates: () => ['tests/a/two.test.ts'] }),
    )

    expect(selection.server).toEqual(['tests/a/one.test.ts', 'tests/a/two.test.ts'])
    expect(selection.server).toEqual([...new Set(selection.server)])
  })
})

describe('selectAffected — blast-radius inputs', () => {
  const blastRadiusFiles: readonly string[] = [
    ...BLAST_RADIUS_INPUTS,
    'tests/utils/test-helpers.ts',
    'tests/utils/fake-clock.ts',
  ]

  test('covers seven inputs — the five named files plus two under the prefixes', () => {
    expect(blastRadiusFiles).toHaveLength(7)
    expect([...BLAST_RADIUS_INPUTS]).toEqual([
      'bunfig.toml',
      'package.json',
      'bun.lock',
      'tests/setup.ts',
      'tests/mock-reset.ts',
    ])
    expect([...BLAST_RADIUS_PREFIXES]).toEqual(['tests/utils/'])
  })

  for (const file of blastRadiusFiles) {
    test(`${file} alone forces a full run, with a reason naming it`, () => {
      const selection = asFull(
        select({ changed: [file], graph: chainGraph(), candidates: () => ['tests/a/x.test.ts'] }),
      )

      expect(selection.reason).toContain(file)
    })
  }

  test('a blast-radius file mixed into an ordinary change set still forces a full run', () => {
    const selection = asFull(select({ changed: ['src/a/three.ts', 'bunfig.toml'], graph: chainGraph() }))

    expect(selection.reason).toContain('bunfig.toml')
  })

  test('a file merely NEXT TO the prefix is not blast radius', () => {
    const selection = select({ changed: ['tests/utils-of-mine/helper.test.ts'] })

    expect(selection.kind).toBe('paths')
  })
})

describe('selectAffected — degenerate change sets', () => {
  test('an empty change set returns a full run', () => {
    const selection = asFull(select({ changed: [] }))

    expect(selection.reason).toContain('no changed files')
  })

  test('a change set that reaches no test at all returns a full run rather than a silent no-op', () => {
    const selection = asFull(select({ changed: ['README.md'] }))

    expect(selection.reason).toContain('no test file')
  })
})

describe('selectAffected — lane split', () => {
  const laneSelection = (): PathSelection =>
    asPaths(
      select({
        changed: ['src/a/three.ts'],
        graph: graphOf({
          'src/a/three.ts': [
            'tests/tools/server.test.ts',
            'tests/client/admin/panel.test.ts',
            'tests/e2e/e2e.test.ts',
            'tests/stories/render.test.ts',
          ],
        }),
      }),
    )

  test('a tests/client hit lands in the client lane, not the server lane', () => {
    const selection = laneSelection()

    expect(selection.client).toEqual(['tests/client/admin/panel.test.ts'])
    expect(selection.server).toEqual(['tests/tools/server.test.ts'])
  })

  test('e2e and stories land in skippedExternal and in neither run list', () => {
    const selection = laneSelection()

    expect(selection.skippedExternal).toEqual(['tests/e2e/e2e.test.ts', 'tests/stories/render.test.ts'])
    expect([...selection.server, ...selection.client]).not.toContain('tests/e2e/e2e.test.ts')
    expect([...selection.server, ...selection.client]).not.toContain('tests/stories/render.test.ts')
  })

  test('the external lane is never handed to a runner', () => {
    const commands = planCommands(laneSelection(), { selectedBySupported: true })

    expect(commands.flatMap((command) => [...command.argv])).not.toContain('tests/e2e/e2e.test.ts')
  })
})

describe('formatBanner', () => {
  const banner = (overrides: Partial<PathSelection> = {}): readonly string[] =>
    formatBanner({
      selection: {
        kind: 'paths',
        server: ['tests/a/two.test.ts'],
        client: [],
        skippedExternal: [],
        depth: 2,
        changed: ['src/a/three.ts', 'src/a/two.ts', 'src/a/one.ts'],
        ...overrides,
      },
      serverTotal: 1391,
    })

  test('leads with the fraction of the server suite that will actually run', () => {
    expect(banner()[0]).toBe('test:affected — 1 of 1391 server test files (depth 2, 3 changed files)')
  })

  test('names the skipped lanes', () => {
    expect(banner()).toContain('  skipped lanes: e2e, stories')
  })

  test('says what the heuristic cannot see, so a green subset run is never mistaken for a green suite', () => {
    const text = banner().join('\n')

    expect(text).toContain('static-import heuristic')
    expect(text).toContain('mock.module()')
    expect(text).toContain('dynamic imports')
    expect(text).toContain('DI seams')
    expect(text).toContain('Green here is not green')
  })

  test('reports the client lane when one is selected', () => {
    expect(banner({ client: ['tests/client/admin/panel.test.ts'] }).join('\n')).toContain('1 client test file')
  })

  test('says how many selected tests the skipped lanes swallowed', () => {
    expect(banner({ skippedExternal: ['tests/e2e/e2e.test.ts'] })).toContain(
      '  skipped lanes: e2e, stories (1 selected test file not run)',
    )
  })

  test('singularizes a one-file change set', () => {
    expect(banner({ changed: ['src/a/three.ts'] })[0]).toContain('(depth 2, 1 changed file)')
  })
})

describe('parseAffectedArgs', () => {
  test('defaults to depth 2 against origin/master', () => {
    expect(parseAffectedArgs([])).toEqual({ kind: 'ok', depth: 2, baseRef: 'origin/master' })
  })

  test('honours --depth and --base', () => {
    expect(parseAffectedArgs(['--depth=3', '--base=HEAD~1'])).toEqual({ kind: 'ok', depth: 3, baseRef: 'HEAD~1' })
  })

  test('rejects a non-numeric depth rather than silently falling back', () => {
    expect(parseAffectedArgs(['--depth=deep'])).toEqual({
      kind: 'usageError',
      reason: 'depth must be a positive integer',
    })
  })

  test('rejects depth 0 — a zero-hop selection is only the changed tests', () => {
    expect(parseAffectedArgs(['--depth=0']).kind).toBe('usageError')
  })

  test('rejects an unknown flag', () => {
    expect(parseAffectedArgs(['--wat']).kind).toBe('usageError')
  })
})

describe('parseStatusPorcelain', () => {
  test('reads modified, staged, and untracked paths', () => {
    expect(parseStatusPorcelain(' M src/a.ts\nA  src/b.ts\n?? src/c.ts\n')).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ])
  })

  test('takes the destination of a rename', () => {
    expect(parseStatusPorcelain('R  src/old.ts -> src/new.ts')).toEqual(['src/new.ts'])
  })

  test('drops deletions — a deleted file has no tests to select', () => {
    expect(parseStatusPorcelain(' D src/gone.ts\nD  src/also-gone.ts')).toEqual([])
  })

  test('unquotes a path git had to quote', () => {
    expect(parseStatusPorcelain(' M "src/a b.ts"')).toEqual(['src/a b.ts'])
  })
})

describe('buildChangedFiles', () => {
  test('unions the committed diff with uncommitted work, deduplicated and sorted', () => {
    const files = buildChangedFiles('src/b.ts\nsrc/a.ts\n', ' M src/a.ts\n?? src/c.ts\n')

    expect(files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })
})

describe('planCommands', () => {
  const selection: PathSelection = {
    kind: 'paths',
    server: ['tests/a/two.test.ts'],
    client: ['tests/client/admin/panel.test.ts'],
    skippedExternal: [],
    depth: 2,
    changed: ['src/a/three.ts'],
  }

  test('runs the server lane through the wrapper, tagged with the selector', () => {
    const [server] = planCommands(selection, { selectedBySupported: true })

    expect(server).toEqual({
      lane: 'server',
      argv: ['bun', 'scripts/test/run.ts', '--selected-by', 'affected@2', 'tests/a/two.test.ts'],
    })
  })

  test('omits the selector flag when the wrapper cannot yet consume it', () => {
    const [server] = planCommands(selection, { selectedBySupported: false })

    expect(server?.argv).toEqual(['bun', 'scripts/test/run.ts', 'tests/a/two.test.ts'])
  })

  test('runs the client lane through the test:client preset', () => {
    const commands = planCommands(selection, { selectedBySupported: true })

    expect(commands[1]).toEqual({
      lane: 'client',
      argv: [
        'bun',
        '--conditions=browser',
        'test',
        '--preload',
        './tests/client-setup.ts',
        '--path-ignore-patterns',
        '',
        'tests/client/admin/panel.test.ts',
      ],
    })
  })

  test('never spawns a lane with no paths — an empty path list would run the whole suite', () => {
    const commands = planCommands({ ...selection, server: [] }, { selectedBySupported: true })

    expect(commands.map((command) => command.lane)).toEqual(['client'])
  })

  test('a full selection is one unfiltered wrapper run', () => {
    const commands = planCommands({ kind: 'full', reason: 'bunfig.toml changed' }, { selectedBySupported: true })

    expect(commands).toEqual([{ lane: 'full', argv: ['bun', 'scripts/test/run.ts'] }])
  })
})

describe('wrapperSupportsSelectedBy', () => {
  test('is false while the wrapper passes the flag through to bun test', () => {
    const passthroughParse = (argv: readonly string[]): { passthrough: string[]; paths: string[] } => ({
      passthrough: [...argv],
      paths: argv.filter((arg) => !arg.startsWith('-')),
    })

    expect(wrapperSupportsSelectedBy(passthroughParse)).toBe(false)
  })

  test('is true once the wrapper consumes both the flag and its value', () => {
    const consumingParse = (): { passthrough: string[]; paths: string[] } => ({ passthrough: [], paths: [] })

    expect(wrapperSupportsSelectedBy(consumingParse)).toBe(true)
  })

  test('is false when the flag is consumed but its value leaks in as a path filter', () => {
    const halfParse = (argv: readonly string[]): { passthrough: string[]; paths: string[] } => ({
      passthrough: argv.filter((arg) => !arg.startsWith('-')),
      paths: argv.filter((arg) => !arg.startsWith('-')),
    })

    expect(wrapperSupportsSelectedBy(halfParse)).toBe(false)
  })
})
