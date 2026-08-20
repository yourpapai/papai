// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'

import { LAST_RUN_JUNIT } from '../../../scripts/test/paths.js'
import type { RunReport } from '../../../scripts/test/report.js'
import { formatDuration, formatSummary, runWrapper } from '../../../scripts/test/run.js'
import type { RunDeps } from '../../../scripts/test/run.js'

const FIXTURES = joinPath(import.meta.dir, 'fixtures')
const CWD = '/home/user/papai'

const readFixture = (name: string): string => readFileSync(joinPath(FIXTURES, name), 'utf8')

const GREEN_LOG = readFixture('console-green.log')
const GREEN_JUNIT = readFixture('junit-green.xml')
const NESTED_LOG = readFixture('console-nested.log')
const NESTED_JUNIT = readFixture('junit-nested.xml')
const UNHANDLED_LOG = readFixture('console-unhandled.log')

interface HarnessOptions {
  readonly log?: string
  readonly junit?: string | null
  readonly exitCode?: number
  readonly cores?: number
  readonly load1?: number
  readonly env?: Record<string, string | undefined>
  readonly wallMs?: number
}

interface WrittenArtifacts {
  log: string
  junitXml: string | null
  report: RunReport
}

interface Harness {
  deps: RunDeps
  /** Ordered names of the effectful deps, so "before/after" is assertable. */
  order: string[]
  spawns: string[][]
  printed: string[]
  written: WrittenArtifacts[]
}

const harness = (options: HarnessOptions = {}): Harness => {
  const order: string[] = []
  const spawns: string[][] = []
  const printed: string[] = []
  const written: WrittenArtifacts[] = []
  const junit = options.junit === undefined ? GREEN_JUNIT : options.junit

  const deps: RunDeps = {
    cwd: CWD,
    env: options.env ?? {},
    cores: options.cores ?? 4,
    load1: options.load1 ?? 0,
    ensureClientBuilt: (): void => {
      order.push('ensureClientBuilt')
    },
    clearArtifacts: (): void => {
      order.push('clearArtifacts')
    },
    spawn: (argv): { exitCode: number; output: string; wallMs: number } => {
      order.push('spawn')
      spawns.push([...argv])
      return {
        exitCode: options.exitCode ?? 0,
        output: options.log ?? GREEN_LOG,
        wallMs: options.wallMs ?? 168,
      }
    },
    fingerprint: (): string => 'abc123abc123abc1',
    gitSha: (): string | null => 'deadbeef',
    readJUnit: (): string | null => junit,
    writeArtifacts: (log, junitXml, report): void => {
      order.push('writeArtifacts')
      written.push({ log, junitXml, report })
    },
    print: (line): void => {
      printed.push(line)
    },
    now: (): string => '2026-08-09T10:30:00.000Z',
  }

  return { deps, order, spawns, printed, written }
}

const failingHarness = (): Harness => harness({ log: NESTED_LOG, junit: NESTED_JUNIT, exitCode: 1 })

const syntheticReport = (failureCount: number, runErrorCount: number): RunReport => ({
  schemaVersion: 1,
  startedAt: '2026-08-09T10:30:00.000Z',
  wallMs: 361_204,
  argv: [],
  scope: { kind: 'full' },
  mode: 'parallel',
  fingerprint: 'abc123abc123abc1',
  gitSha: null,
  totals: {
    files: 1294,
    tests: 12_868,
    pass: 12_847,
    fail: failureCount,
    skip: 2,
    expects: 76_195,
  },
  files: {},
  failures: Array.from({ length: failureCount }, (_unused, index) => ({
    id: index + 1,
    file: `tests/sample/file-${String(index)}.test.ts`,
    line: 100 + index,
    suite: ['sample suite'],
    name: `case ${String(index)}`,
    ms: 1,
    detail: null,
  })),
  runErrors: Array.from({ length: runErrorCount }, (_unused, index) => ({
    file: `tests/sample/broken-${String(index)}.test.ts`,
    message: `Cannot find module 'missing-${String(index)}'`,
  })),
  slowestFiles: [],
  joinWarnings: [],
})

const lastReport = (instance: Harness): RunReport => {
  const written = instance.written.at(-1)
  if (written === undefined) throw new Error('runWrapper wrote no artifacts')
  return written.report
}

describe('runWrapper child argv', () => {
  test('carries the reporter, outfile, timeout and every passthrough arg in order', () => {
    const instance = harness()

    runWrapper(['--serial', '-t', 'foo', 'tests/utils', '--bail'], instance.deps)

    expect(instance.spawns).toEqual([
      [
        'bun',
        'test',
        '--timeout',
        '15000',
        '--reporter=junit',
        `--reporter-outfile=${LAST_RUN_JUNIT}`,
        '-t',
        'foo',
        'tests/utils',
        '--bail',
      ],
    ])
  })

  test('prefixes --parallel when the resolved mode is parallel', () => {
    const instance = harness()

    runWrapper(['--parallel', 'tests/utils'], instance.deps)

    expect(instance.spawns[0]).toEqual([
      'bun',
      'test',
      '--parallel',
      '--timeout',
      '15000',
      '--reporter=junit',
      `--reporter-outfile=${LAST_RUN_JUNIT}`,
      'tests/utils',
    ])
  })

  test('resolves the mode from env and cores when no override is given', () => {
    const instance = harness({ cores: 16 })

    runWrapper([], instance.deps)

    expect(instance.spawns[0]).toContain('--parallel')
    expect(lastReport(instance).mode).toBe('parallel')
  })

  test('records the child flags, not the bun prefix, as the report argv', () => {
    const instance = harness()

    runWrapper(['--serial', 'tests/utils'], instance.deps)

    expect(lastReport(instance).argv[0]).toBe('--timeout')
  })
})

describe('runWrapper exit-code fidelity', () => {
  for (const code of [0, 1, 143]) {
    test(`returns the child's exit code ${String(code)} unchanged`, () => {
      const instance = harness({ exitCode: code })

      expect(runWrapper([], instance.deps)).toBe(code)
    })
  }
})

describe('runWrapper ordering', () => {
  test('calls ensureClientBuilt exactly once, before the spawn', () => {
    const instance = harness()

    runWrapper([], instance.deps)

    expect(instance.order.filter((name) => name === 'ensureClientBuilt')).toHaveLength(1)
    expect(instance.order.indexOf('ensureClientBuilt')).toBeLessThan(instance.order.indexOf('spawn'))
  })

  test('clears the stale artifacts before the spawn and writes after it', () => {
    const instance = harness()

    runWrapper([], instance.deps)

    expect(instance.order).toEqual(['ensureClientBuilt', 'clearArtifacts', 'spawn', 'writeArtifacts'])
  })
})

describe('runWrapper scope', () => {
  test('records positional paths as a paths scope', () => {
    const instance = harness()

    runWrapper(['tests/utils', 'tests/scripts'], instance.deps)

    expect(lastReport(instance).scope).toEqual({
      kind: 'paths',
      paths: ['tests/utils', 'tests/scripts'],
    })
  })

  test('records a bare run as a full scope', () => {
    const instance = harness()

    runWrapper(['--serial'], instance.deps)

    expect(lastReport(instance).scope).toEqual({ kind: 'full' })
  })

  test('does not mistake a value-taking flag argument for a path', () => {
    const instance = harness()

    runWrapper(['-t', 'tests/utils'], instance.deps)

    expect(lastReport(instance).scope).toEqual({ kind: 'full' })
  })
})

describe('runWrapper bypass', () => {
  test('--watch spawns without any reporter flag', () => {
    const instance = harness()

    runWrapper(['--watch'], instance.deps)

    expect(instance.spawns[0]).toEqual(['bun', 'test', '--timeout', '15000', '--watch'])
  })

  test('--watch never writes artifacts, clears nothing and prints no summary', () => {
    const instance = harness()

    runWrapper(['--watch'], instance.deps)

    expect(instance.written).toHaveLength(0)
    expect(instance.printed).toHaveLength(0)
    expect(instance.order).toEqual(['ensureClientBuilt', 'spawn'])
  })

  test('--watch still returns the child exit code', () => {
    const instance = harness({ exitCode: 130 })

    expect(runWrapper(['--watch'], instance.deps)).toBe(130)
  })

  for (const flag of ['-u', '--update-snapshots']) {
    test(`${flag} bypasses persistence too`, () => {
      const instance = harness()

      runWrapper([flag], instance.deps)

      expect(instance.written).toHaveLength(0)
      expect(instance.spawns[0]).not.toContain('--reporter=junit')
    })
  }
})

describe('runWrapper summary', () => {
  test('a green run prints only the counts line and the artifact line', () => {
    const instance = harness()

    runWrapper(['--serial'], instance.deps)

    expect(instance.printed).toEqual([
      '1 file · 2 tests · 2 pass · 0 fail · 0 skip · 0.2s (serial)',
      'reports/test/last-run.{log,junit.xml,json}',
    ])
  })

  test('a failing run lists every failure with id, location and title', () => {
    const instance = failingHarness()

    runWrapper(['--serial'], instance.deps)

    expect(instance.printed[1]).toBe('4 failures — bun run test:show <id>')
    expect(instance.printed[2]).toContain('#1')
    expect(instance.printed[2]).toContain('outer > inner > deep fails')
    expect(instance.printed[5]).toContain('B > x')
  })

  test('a failing run keeps the artifact line last and stays under 20 lines', () => {
    const instance = failingHarness()

    runWrapper(['--serial'], instance.deps)

    expect(instance.printed.at(-1)).toBe('reports/test/last-run.{log,junit.xml,json}')
    expect(instance.printed.length).toBeLessThanOrEqual(20)
  })

  test('a four-failure run needs no "more" pointer', () => {
    const instance = failingHarness()

    runWrapper(['--serial'], instance.deps)

    expect(instance.printed.filter((line) => line.includes('more —'))).toHaveLength(0)
  })
})

describe('formatSummary', () => {
  test('lists at most five failures then points at test:failures', () => {
    const lines = formatSummary(syntheticReport(19, 0))

    expect(lines.filter((line) => line.startsWith('  #'))).toHaveLength(5)
    expect(lines).toContain('  … 14 more — bun run test:failures')
  })

  test('aligns the location column across the listed failures', () => {
    const lines = formatSummary(syntheticReport(7, 0))
    const listed = lines.filter((line) => line.startsWith('  #'))
    const columns = listed.map((line) => line.indexOf('sample suite'))

    expect(new Set(columns).size).toBe(1)
  })

  test('stays within the 20-line budget on a catastrophic run', () => {
    expect(formatSummary(syntheticReport(30, 10)).length).toBeLessThanOrEqual(20)
  })

  test('renders a green report as exactly two lines', () => {
    expect(formatSummary(syntheticReport(0, 0))).toHaveLength(2)
  })
})

describe('runWrapper run errors', () => {
  test('builds a report when bun wrote no junit file at all', () => {
    const instance = harness({ log: UNHANDLED_LOG, junit: null, exitCode: 1 })

    runWrapper(['--serial'], instance.deps)

    const report = lastReport(instance)
    expect(report.totals.fail).toBe(1)
    expect(report.failures).toHaveLength(0)
    expect(report.runErrors).toHaveLength(1)
  })

  test('names the module error in the summary', () => {
    const instance = harness({ log: UNHANDLED_LOG, junit: null, exitCode: 1 })

    runWrapper(['--serial'], instance.deps)

    const summary = instance.printed.join('\n')
    expect(summary).toContain('1 module error')
    expect(summary).toContain('Cannot find module')
    expect(summary).toContain('reports/fixture-gen/unhandled.test.ts')
  })

  test('passes the null junit through to writeArtifacts unchanged', () => {
    const instance = harness({ log: UNHANDLED_LOG, junit: null, exitCode: 1 })

    runWrapper(['--serial'], instance.deps)

    expect(instance.written[0]).toMatchObject({
      log: UNHANDLED_LOG,
      junitXml: null,
    })
  })
})

describe('formatDuration', () => {
  const CASES: readonly (readonly [number, string])[] = [
    [168, '0.2s'],
    [27_600, '27.6s'],
    [59_949, '59.9s'],
    [60_000, '1m00s'],
    [361_204, '6m01s'],
  ]

  for (const [ms, expected] of CASES) {
    test(`${String(ms)}ms renders as ${expected}`, () => {
      expect(formatDuration(ms)).toBe(expected)
    })
  }
})
