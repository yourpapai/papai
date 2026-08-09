// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'

import { LAST_RUN_JSON, PREVIOUS_RUN_JSON } from '../../../scripts/test/paths.js'
import { buildReport, readReport, writeReport } from '../../../scripts/test/report.js'
import type { BuildReportInput, RunReport } from '../../../scripts/test/report.js'

const FIXTURES = joinPath(import.meta.dir, 'fixtures')
const CWD = '/home/user/papai'
const NESTED = 'reports/fixture-gen/nested.test.ts'

const readFixture = (name: string): string => readFileSync(joinPath(FIXTURES, name), 'utf8')

const META = {
  cwd: CWD,
  startedAt: '2026-08-09T10:30:00.000Z',
  wallMs: 168,
  argv: ['--parallel'],
  scope: { kind: 'full' } as const,
  mode: 'parallel' as const,
  fingerprint: 'abc123abc123abc1',
  gitSha: 'deadbeef',
}

const inputFor = (junit: string | null, log: string): BuildReportInput => ({
  ...META,
  junitXml: junit,
  logText: log,
})

const nestedReport = (): RunReport =>
  buildReport(inputFor(readFixture('junit-nested.xml'), readFixture('console-nested.log')))

/** An in-memory filesystem for the read/write seams. */
const fakeIo = (
  initial: Readonly<Record<string, string>> = {},
): {
  files: Record<string, string>
  read: (path: string) => string | null
  write: (path: string, contents: string) => void
} => {
  const files: Record<string, string> = { ...initial }
  return {
    files,
    read: (path) => files[path] ?? null,
    write: (path, contents) => {
      files[path] = contents
    },
  }
}

describe('buildReport', () => {
  test('carries the run metadata through unchanged', () => {
    const report = nestedReport()

    expect(report.schemaVersion).toBe(1)
    expect(report.startedAt).toBe(META.startedAt)
    expect(report.wallMs).toBe(META.wallMs)
    expect(report.argv).toEqual(['--parallel'])
    expect(report.scope).toEqual({ kind: 'full' })
    expect(report.mode).toBe('parallel')
    expect(report.fingerprint).toBe(META.fingerprint)
    expect(report.gitSha).toBe('deadbeef')
  })

  test('takes totals from the console summary, not the junit root', () => {
    const report = nestedReport()

    expect(report.totals).toEqual({ files: 1, tests: 5, pass: 1, fail: 4, skip: 0, expects: 4 })
  })

  test('joins every failure to its diagnostic', () => {
    const report = nestedReport()

    expect(report.failures).toHaveLength(4)
    expect(report.failures.map((failure) => failure.name)).toEqual(['deep fails', 'x', 'y', 'x'])
    expect(report.failures.every((failure) => failure.detail !== null)).toBe(true)
    expect(report.joinWarnings).toEqual([])
  })

  test('records per-file pass and failure counts', () => {
    const report = nestedReport()

    expect(report.files).toEqual({ [NESTED]: { tests: 5, failures: 4 } })
  })

  test('ranks files by summed in-test time', () => {
    const report = nestedReport()

    expect(report.slowestFiles).toHaveLength(1)
    expect(report.slowestFiles[0]).toMatchObject({ file: NESTED, tests: 5 })
    expect(report.slowestFiles[0]?.ms).toBeGreaterThan(0)
  })

  test('a green run reports no failures and no warnings', () => {
    const report = buildReport(inputFor(readFixture('junit-green.xml'), readFixture('console-green.log')))

    expect(report.totals).toEqual({ files: 1, tests: 2, pass: 2, fail: 0, skip: 0, expects: 2 })
    expect(report.failures).toEqual([])
    expect(report.runErrors).toEqual([])
    expect(report.joinWarnings).toEqual([])
  })

  test('does not call a run green because junit omitted the file that broke', () => {
    // junit-mixed.xml says tests="2" failures="0" for a run that exited 1. Trusting it
    // would report a broken run as clean — the whole reason totals come from the log.
    const report = buildReport(inputFor(readFixture('junit-mixed.xml'), readFixture('console-mixed.log')))

    expect(report.totals.fail).toBe(1)
    expect(report.totals.pass).toBe(2)
    expect(report.runErrors).toHaveLength(1)
    expect(report.runErrors[0]?.message).toContain('definitely-not-a-real-module')
  })

  test('builds a usable report when bun wrote no junit file at all', () => {
    const report = buildReport(inputFor(null, readFixture('console-unhandled.log')))

    expect(report.totals.fail).toBe(1)
    expect(report.totals.pass).toBe(0)
    expect(report.failures).toEqual([])
    expect(report.runErrors).toHaveLength(1)
    expect(report.files).toEqual({})
  })

  test('caps the slowest-file list at twenty', () => {
    const cases = Array.from(
      { length: 25 },
      (_, index) =>
        `<testcase name="t${index}" classname="s" time="${index + 1}" file="tests/f${index}.test.ts" line="1" />`,
    ).join('\n')
    const xml = `<testsuites name="bun test" tests="25" assertions="25" failures="0" skipped="0" time="1">${cases}</testsuites>`

    const report = buildReport(inputFor(xml, readFixture('console-green.log')))

    expect(report.slowestFiles).toHaveLength(20)
    expect(report.slowestFiles[0]?.file).toBe('tests/f24.test.ts')
    expect(report.slowestFiles.map((entry) => entry.ms)).toEqual(
      [...report.slowestFiles].sort((a, b) => b.ms - a.ms).map((entry) => entry.ms),
    )
  })
})

describe('readReport', () => {
  test('round-trips a written report', () => {
    const io = fakeIo()
    const report = nestedReport()

    writeReport(report, io)

    expect(readReport(LAST_RUN_JSON, io)).toEqual(report)
  })

  test('returns null when no report has been written', () => {
    expect(readReport(LAST_RUN_JSON, fakeIo())).toBeNull()
  })

  test('returns null rather than throwing on unparseable json', () => {
    expect(readReport(LAST_RUN_JSON, fakeIo({ [LAST_RUN_JSON]: '{ not json' }))).toBeNull()
  })

  test('returns null rather than throwing when the shape does not match', () => {
    const stored = JSON.stringify({ schemaVersion: 1, totals: 'not an object' })

    expect(readReport(LAST_RUN_JSON, fakeIo({ [LAST_RUN_JSON]: stored }))).toBeNull()
  })

  test('rejects a report written by a future schema', () => {
    const stored = JSON.stringify({ ...nestedReport(), schemaVersion: 2 })

    expect(readReport(LAST_RUN_JSON, fakeIo({ [LAST_RUN_JSON]: stored }))).toBeNull()
  })
})

describe('writeReport', () => {
  test('rotates the prior report so two runs can be compared', () => {
    const first = nestedReport()
    const second = { ...first, startedAt: '2026-08-09T11:00:00.000Z' }
    const io = fakeIo()

    writeReport(first, io)
    writeReport(second, io)

    expect(readReport(PREVIOUS_RUN_JSON, io)?.startedAt).toBe(first.startedAt)
    expect(readReport(LAST_RUN_JSON, io)?.startedAt).toBe(second.startedAt)
  })

  test('keeps only one generation of history', () => {
    const io = fakeIo()
    const stamps = ['a', 'b', 'c'].map((suffix) => ({ ...nestedReport(), gitSha: suffix }))

    for (const report of stamps) writeReport(report, io)

    expect(readReport(LAST_RUN_JSON, io)?.gitSha).toBe('c')
    expect(readReport(PREVIOUS_RUN_JSON, io)?.gitSha).toBe('b')
  })

  test('writes no history on the very first run', () => {
    const io = fakeIo()

    writeReport(nestedReport(), io)

    expect(io.files[PREVIOUS_RUN_JSON]).toBeUndefined()
  })
})
