// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'

import { LAST_RUN_JSON, LAST_RUN_LOG } from '../../../scripts/test/paths.js'
import { runQuery } from '../../../scripts/test/query-cli.js'
import type { QueryDeps } from '../../../scripts/test/query-cli.js'
import {
  renderFailures,
  renderLog,
  renderShow,
  renderSlowest,
  renderStatus,
  stalenessBanner,
} from '../../../scripts/test/query.js'
import type { QueryContext } from '../../../scripts/test/query.js'
import { buildReport } from '../../../scripts/test/report.js'
import type { RunReport } from '../../../scripts/test/report.js'

const FIXTURES = joinPath(import.meta.dir, 'fixtures')
const QUERY_SOURCES = ['query.ts', 'query-cli.ts'].map((name) =>
  joinPath(import.meta.dir, '../../../scripts/test', name),
)
const CWD = '/home/user/papai'
const NESTED = 'reports/fixture-gen/nested.test.ts'
const FRESH = 'abc123abc123abc1'
const MOVED = 'ffff0000ffff0000'

const readFixture = (name: string): string => readFileSync(joinPath(FIXTURES, name), 'utf8')

const META = {
  cwd: CWD,
  startedAt: '2026-08-09T10:30:00.000Z',
  wallMs: 168,
  argv: ['--parallel'],
  scope: { kind: 'full' } as const,
  mode: 'parallel' as const,
  loadDemoted: false,
  fingerprint: FRESH,
  gitSha: 'deadbeef',
}

const reportFrom = (junit: string | null, log: string): RunReport =>
  buildReport({ ...META, junitXml: junit, logText: log })

const nestedLog = (): string => readFixture('console-nested.log')

const nestedReport = (): RunReport => reportFrom(readFixture('junit-nested.xml'), nestedLog())

const greenReport = (): RunReport => reportFrom(readFixture('junit-green.xml'), readFixture('console-green.log'))

const mixedReport = (): RunReport => reportFrom(readFixture('junit-mixed.xml'), readFixture('console-mixed.log'))

const contextFor = (report: RunReport | null, log: string | null, currentFingerprint = FRESH): QueryContext => ({
  report,
  log,
  currentFingerprint,
})

const nested = (currentFingerprint = FRESH): QueryContext => contextFor(nestedReport(), nestedLog(), currentFingerprint)

const empty = (): QueryContext => contextFor(null, null, FRESH)

/** The nested run with failure `#1`'s diagnostic range dropped, as a failed join leaves it. */
const unpairedFirstFailure = (): QueryContext => {
  const report = nestedReport()
  const failures = report.failures.map((failure) => ({ ...failure, detail: failure.id === 1 ? null : failure.detail }))
  return contextFor({ ...report, failures }, nestedLog())
}

const withWarnings = (warnings: string[]): QueryContext =>
  contextFor({ ...nestedReport(), joinWarnings: warnings }, nestedLog(), FRESH)

/** Every renderer, applied with its most ordinary arguments. */
const renderAll = (ctx: QueryContext): string[] => [
  renderStatus(ctx),
  renderFailures(ctx, { filesOnly: false }),
  renderFailures(ctx, { filesOnly: true }),
  renderShow(ctx, '#1'),
  renderLog(ctx, 'error', { context: 3, max: 200 }),
  renderSlowest(ctx, 10),
]

const bannerCount = (rendered: string): number => rendered.split('\n').filter((line) => line.startsWith('⚠')).length

/** Log lines the `log` renderer emitted, identified by their grep-style prefix. */
const emittedLogLines = (rendered: string): string[] => rendered.split('\n').filter((line) => /^\s*\d+[:-]/u.test(line))

const repeatedLog = (lines: number): string =>
  Array.from({ length: lines }, (_, index) => `line ${String(index)} boom`).join('\n')

const cliDeps = (files: Readonly<Record<string, string>>, fingerprint = FRESH): QueryDeps & { output: string[] } => {
  const output: string[] = []
  return {
    output,
    readFile: (path: string): string | null => files[path] ?? null,
    fingerprint: (): string => fingerprint,
    write: (text: string): void => {
      output.push(text)
    },
  }
}

const cliFiles = (report: RunReport = nestedReport()): Record<string, string> => ({
  [LAST_RUN_JSON]: JSON.stringify(report),
  [LAST_RUN_LOG]: nestedLog(),
})

/** A report whose slowest-file list is long enough for `slowest n` to have to truncate it. */
const twelveSlowFiles = (): RunReport => ({
  ...nestedReport(),
  slowestFiles: Array.from({ length: 12 }, (_, index) => ({
    file: `tests/f${String(index)}.test.ts`,
    ms: 1000 - index,
    tests: 3,
  })),
})

describe('query module', () => {
  test('never references a process-spawning API', () => {
    const sources = QUERY_SOURCES.map((file) => readFileSync(file, 'utf8'))

    expect(sources.some((source) => source.includes('Bun.spawn'))).toBe(false)
    expect(sources.some((source) => source.includes('spawnSync'))).toBe(false)
    expect(sources.some((source) => source.includes('child_process'))).toBe(false)
    expect(sources.some((source) => source.includes('execSync'))).toBe(false)
  })
})

describe('stalenessBanner', () => {
  test('is silent while the working tree still matches the run', () => {
    expect(stalenessBanner(nested())).toBeNull()
  })

  test('names both fingerprints and the command that fixes it', () => {
    expect(stalenessBanner(nested(MOVED))).toBe(
      `⚠ source files changed since this run (fingerprint ${FRESH} → ${MOVED}) — re-run bun run test`,
    )
  })

  test('is silent when there is no report to compare against', () => {
    expect(stalenessBanner(empty())).toBeNull()
  })
})

describe('renderStatus', () => {
  test('renders run identity, scope, totals, verdict and freshness', () => {
    expect(renderStatus(nested())).toBe(
      [
        'last run   2026-08-09T10:30:00.000Z (168ms wall, parallel, git deadbeef)',
        'scope      full suite',
        'totals     5 tests across 1 file — 1 pass, 4 fail, 0 skip, 4 expect() calls',
        'result     FAIL — 4 failing tests in 1 file',
        `freshness  current (fingerprint ${FRESH})`,
        'next       bun run test:failures',
      ].join('\n'),
    )
  })

  test('reports a clean run as passing', () => {
    const rendered = renderStatus(contextFor(greenReport(), readFixture('console-green.log')))

    expect(rendered).toContain('result     PASS — all 2 tests passed')
    expect(rendered).not.toContain('next       bun run test:failures')
  })

  test('surfaces files that never produced a testcase', () => {
    const rendered = renderStatus(contextFor(mixedReport(), readFixture('console-mixed.log')))

    expect(rendered).toContain('run errors (1):')
    expect(rendered).toContain('definitely-not-a-real-module')
  })

  test('surfaces join warnings rather than hiding them', () => {
    const rendered = renderStatus(withWarnings(['a.test.ts: console marker mismatch', 'b.test.ts: 2 blocks, 1 case']))

    expect(rendered).toContain('join warnings (2):')
    expect(rendered).toContain('  - a.test.ts: console marker mismatch')
    expect(rendered).toContain('  - b.test.ts: 2 blocks, 1 case')
  })

  test('marks the run stale without withholding the answer', () => {
    const rendered = renderStatus(nested(MOVED))

    expect(bannerCount(rendered)).toBe(1)
    expect(rendered).toContain('freshness  STALE')
    expect(rendered).toContain('5 tests across 1 file')
  })
})

describe('renderFailures', () => {
  test('groups failures by file with id, location, full name and duration', () => {
    expect(renderFailures(nested(), { filesOnly: false })).toBe(
      [
        '4 failing tests in 1 file',
        '',
        `${NESTED} (4)`,
        `  #1  ${NESTED}:5  outer > inner > deep fails  (2.45ms)`,
        `  #2  ${NESTED}:12  A > x  (0.26ms)`,
        `  #3  ${NESTED}:15  A > y  (0.30ms)`,
        `  #4  ${NESTED}:21  B > x  (0.13ms)`,
        '',
        "next  bun run test:show '#1'",
      ].join('\n'),
    )
  })

  test('filesOnly emits bare paths, one per line', () => {
    expect(renderFailures(nested(), { filesOnly: true })).toBe(NESTED)
  })

  test('says so when nothing failed', () => {
    const rendered = renderFailures(contextFor(greenReport(), readFixture('console-green.log')), { filesOnly: false })

    expect(rendered).toContain('no failing tests')
  })

  test('prefixes the staleness banner exactly once', () => {
    expect(bannerCount(renderFailures(nested(MOVED), { filesOnly: false }))).toBe(1)
    expect(bannerCount(renderFailures(nested(MOVED), { filesOnly: true }))).toBe(1)
  })
})

describe('renderShow', () => {
  test('resolves a #id selector and slices the diagnostic out of the log', () => {
    const rendered = renderShow(nested(), '#3')

    expect(rendered).toContain(`#3  ${NESTED}:15  A > y  (0.30ms)`)
    expect(rendered).toContain('expect(received).toBeGreaterThan(expected)')
    expect(rendered).toContain('(fail) A > y [0.30ms]')
    expect(rendered).not.toContain('B x exploded')
  })

  test('resolves a bare integer as an id, because bash eats an unquoted #', () => {
    // `bun run test:show #3` unquoted arrives with no selector at all — `#` opens a
    // comment. Anything printing an id has to be pasteable without quoting.
    expect(renderShow(nested(), '3')).toBe(renderShow(nested(), '#3'))
  })

  test('resolves a file:line selector', () => {
    const rendered = renderShow(nested(), `${NESTED}:12`)

    expect(rendered).toContain(`#2  ${NESTED}:12  A > x`)
    expect(rendered).toContain('Expected: "right"')
    expect(rendered).not.toContain('#3')
  })

  test('resolves a bare file selector to every failure in it', () => {
    const rendered = renderShow(nested(), NESTED)

    expect(rendered).toContain('4 failures match')
    expect(rendered).toContain('#1  ')
    expect(rendered).toContain('#4  ')
  })

  test('resolves a case-insensitive name substring and renders every match', () => {
    const rendered = renderShow(nested(), 'DEEP fails')

    expect(rendered).toContain('#1  ')
    expect(rendered).not.toContain('#2  ')
  })

  test('renders all matches rather than asking which one was meant', () => {
    const rendered = renderShow(nested(), '> x')

    expect(rendered).toContain('2 failures match "> x"')
    expect(rendered).toContain('#2  ')
    expect(rendered).toContain('#4  ')
  })

  test('says clearly when nothing matches', () => {
    const rendered = renderShow(nested(), 'no such test')

    expect(rendered).toContain('no failure matches "no such test"')
    expect(rendered).toContain('4 failures recorded')
  })

  test('keeps identity when no diagnostic could be paired', () => {
    const rendered = renderShow(unpairedFirstFailure(), '#1')

    expect(rendered).toContain(`#1  ${NESTED}:5  outer > inner > deep fails`)
    expect(rendered).toContain('no diagnostic could be paired')
  })

  test('says when the run captured no log at all', () => {
    expect(renderShow(contextFor(nestedReport(), null), '#1')).toContain('no captured log')
  })

  test('prefixes the staleness banner exactly once', () => {
    expect(bannerCount(renderShow(nested(MOVED), '#1'))).toBe(1)
  })
})

describe('renderLog', () => {
  test('prints matching lines with grep-style context', () => {
    const rendered = renderLog(nested(), 'B x exploded', { context: 2, max: 200 })

    expect(rendered).toContain('pattern /B x exploded/')
    expect(rendered).toContain("throw new Error('B x exploded')")
    expect(rendered).toContain('(fail) B > x')
  })

  test('never returns unbounded output', () => {
    const rendered = renderLog(contextFor(nestedReport(), repeatedLog(5000)), 'boom', { context: 3, max: 25 })

    expect(emittedLogLines(rendered).length).toBeLessThanOrEqual(25)
    expect(rendered).toContain('truncated at 25 lines')
  })

  test('honours a wider max without exceeding it', () => {
    const rendered = renderLog(contextFor(nestedReport(), repeatedLog(500)), 'boom', { context: 0, max: 120 })

    expect(emittedLogLines(rendered).length).toBe(120)
  })

  test('reports an empty result instead of pretending to match', () => {
    expect(renderLog(nested(), 'zzzz-never-printed', { context: 3, max: 200 })).toContain('no lines match')
  })

  test('reports an unusable pattern instead of throwing', () => {
    expect(renderLog(nested(), '([unclosed', { context: 3, max: 200 })).toContain('not a usable regular expression')
  })

  test('says when the run captured no log', () => {
    expect(renderLog(contextFor(nestedReport(), null), 'error', { context: 3, max: 200 })).toContain('no captured log')
  })

  test('prefixes the staleness banner exactly once', () => {
    expect(bannerCount(renderLog(nested(MOVED), 'error', { context: 1, max: 200 }))).toBe(1)
  })
})

describe('renderSlowest', () => {
  test('ranks files by in-test time', () => {
    const rendered = renderSlowest(nested(), 10)

    expect(rendered).toContain('slowest 1 file of 1 recorded')
    expect(rendered).toContain(`3.16ms  ${NESTED}  (5 tests)`)
  })

  test('limits the list to n entries', () => {
    const rendered = renderSlowest(contextFor(twelveSlowFiles(), nestedLog()), 3)

    expect(rendered).toContain('slowest 3 files of 12 recorded')
    expect(rendered).toContain('tests/f0.test.ts')
    expect(rendered).not.toContain('tests/f3.test.ts')
  })

  test('prefixes the staleness banner exactly once', () => {
    expect(bannerCount(renderSlowest(nested(MOVED), 5))).toBe(1)
  })
})

describe('without a usable report', () => {
  test('every renderer tells the agent to run the suite first', () => {
    const rendered = renderAll(empty())

    expect(rendered.every((text) => text.includes('no usable report'))).toBe(true)
    expect(rendered.every((text) => text.includes('bun run test'))).toBe(true)
  })
})

describe('runQuery', () => {
  test('exits 3 when there is no usable report', () => {
    const deps = cliDeps({})

    expect(runQuery(['status'], deps)).toBe(3)
    expect(deps.output.join('\n')).toContain('no usable report')
  })

  test('exits 0 for a run whose tests failed', () => {
    const deps = cliDeps(cliFiles())

    expect(runQuery(['status'], deps)).toBe(0)
    expect(deps.output.join('\n')).toContain('result     FAIL')
  })

  test('dispatches failures --files', () => {
    const deps = cliDeps(cliFiles())

    expect(runQuery(['failures', '--files'], deps)).toBe(0)
    expect(deps.output.join('\n')).toBe(NESTED)
  })

  test('dispatches show with its selector', () => {
    const deps = cliDeps(cliFiles())

    expect(runQuery(['show', '#2'], deps)).toBe(0)
    expect(deps.output.join('\n')).toContain(`#2  ${NESTED}:12`)
  })

  test('dispatches log with -C and --max', () => {
    const deps = cliDeps(cliFiles())

    expect(runQuery(['log', 'exploded', '-C', '1', '--max', '4'], deps)).toBe(0)
    expect(deps.output.join('\n')).toContain('context 1')
    expect(emittedLogLines(deps.output.join('\n')).length).toBeLessThanOrEqual(4)
  })

  test('dispatches slowest with its count', () => {
    const deps = cliDeps(cliFiles(twelveSlowFiles()))

    expect(runQuery(['slowest', '3'], deps)).toBe(0)
    expect(deps.output.join('\n')).toContain('slowest 3 files of 12 recorded')
  })

  test('falls back to ten slowest files when no count is given', () => {
    const deps = cliDeps(cliFiles(twelveSlowFiles()))

    expect(runQuery(['slowest'], deps)).toBe(0)
    expect(deps.output.join('\n')).toContain('slowest 10 files of 12 recorded')
  })

  test('reports the staleness of the on-disk report through the CLI', () => {
    const deps = cliDeps(cliFiles(), MOVED)

    expect(runQuery(['status'], deps)).toBe(0)
    expect(bannerCount(deps.output.join('\n'))).toBe(1)
  })

  test('rejects a command it does not know with usage', () => {
    const deps = cliDeps(cliFiles())

    expect(runQuery(['explode'], deps)).toBe(2)
    expect(deps.output.join('\n')).toContain('usage:')
  })

  test('rejects show without a selector', () => {
    const deps = cliDeps(cliFiles())

    expect(runQuery(['show'], deps)).toBe(2)
    expect(deps.output.join('\n')).toContain('usage:')
  })

  test('rejects log without a pattern', () => {
    const deps = cliDeps(cliFiles())

    expect(runQuery(['log'], deps)).toBe(2)
    expect(deps.output.join('\n')).toContain('usage:')
  })
})
