// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  evaluatePrivacyContractGate,
  runPrivacyContractGate,
} from '../../../scripts/analytics/privacy-contract-gate.js'
import type { PrivacyContractGateDeps } from '../../../scripts/analytics/privacy-contract-gate.js'
import { privacyContractFixtures } from '../../../scripts/analytics/privacy-contract-table.js'
import { LAST_RUN_JSON } from '../../../scripts/test/paths.js'
import type { RunReport } from '../../../scripts/test/report.js'

const FRESH = 'abc123abc123abc1'
const MOVED = 'ffff0000ffff0000'

const FIXTURES = privacyContractFixtures()

/** A file the suite runs that the contract says nothing about. */
const UNRELATED = 'tests/chat/router.test.ts'

/** Every contract fixture recorded as green, plus one unrelated green file. */
const greenFiles = (): RunReport['files'] => {
  const files: RunReport['files'] = { [UNRELATED]: { tests: 4, failures: 0 } }
  for (const fixture of FIXTURES) files[fixture] = { tests: 3, failures: 0 }
  return files
}

/** A full-scope, fresh, all-green run — the only shape the gate may pass. */
const greenReport = (): RunReport => ({
  schemaVersion: 1,
  startedAt: '2026-08-09T10:30:00.000Z',
  wallMs: 214_000,
  argv: ['--timeout', '15000'],
  scope: { kind: 'full' },
  mode: 'serial',
  loadDemoted: false,
  fingerprint: FRESH,
  gitSha: 'deadbeef',
  totals: { files: 58, tests: 175, pass: 175, fail: 0, skip: 0, expects: 900 },
  files: greenFiles(),
  failures: [],
  runErrors: [],
  slowestFiles: [],
  joinWarnings: [],
})

const withFiles = (mutate: (files: RunReport['files']) => void): RunReport => {
  const report = greenReport()
  mutate(report.files)
  return report
}

const evaluate = (report: RunReport | null, currentFingerprint = FRESH): { ok: boolean; problems: string[] } =>
  evaluatePrivacyContractGate({ report, currentFingerprint, fixtures: FIXTURES })

/** Drop one fixture from an otherwise-green run and report how the gate answered. */
const withoutFixture = (fixture: string): { ok: boolean; named: boolean } => {
  const result = evaluate(
    withFiles((files) => {
      Reflect.deleteProperty(files, fixture)
    }),
  )
  return { ok: result.ok, named: result.problems.some((problem) => problem.includes(fixture)) }
}

const problemsMentioning = (problems: readonly string[], needle: string): string[] =>
  problems.filter((problem) => problem.includes(needle))

/** The first fixture in the table; any single fixture proves the per-fixture rule. */
const firstFixture = (): string => {
  const fixture = FIXTURES[0]
  if (fixture === undefined) throw new Error('the privacy contract table has no fixtures')
  return fixture
}

/** Deps whose report file contains `raw`, with a fingerprint that matches it. */
const depsFor = (raw: string | null, currentFingerprint = FRESH): PrivacyContractGateDeps & { lines: string[] } => {
  const lines: string[] = []
  return {
    lines,
    readFile: (relPath: string): string | null => (relPath === LAST_RUN_JSON ? raw : null),
    fingerprint: (): string => currentFingerprint,
    write: (text: string): void => {
      lines.push(text)
    },
  }
}

describe('evaluatePrivacyContractGate', () => {
  test('the table contributes 57 distinct proof fixtures', () => {
    expect(FIXTURES).toHaveLength(57)
    expect(new Set(FIXTURES).size).toBe(FIXTURES.length)
  })

  test('passes when a fresh full-scope run recorded every proof fixture green', () => {
    const result = evaluate(greenReport())
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
  })

  test('a failing file outside the contract is not this gate’s business', () => {
    const result = evaluate(
      withFiles((files) => {
        files[UNRELATED] = { tests: 4, failures: 2 }
      }),
    )
    expect(result.ok).toBe(true)
  })

  test('fails closed when there is no report at all', () => {
    const result = evaluate(null)
    expect(result.ok).toBe(false)
    expect(problemsMentioning(result.problems, LAST_RUN_JSON)).toHaveLength(1)
  })

  test('fails closed when the recorded run was subset-scoped', () => {
    const report = greenReport()
    const result = evaluate({ ...report, scope: { kind: 'paths', paths: ['tests/analytics'] } })
    expect(result.ok).toBe(false)
    expect(problemsMentioning(result.problems, 'full')).toHaveLength(1)
    expect(problemsMentioning(result.problems, 'tests/analytics')).toHaveLength(1)
  })

  test('fails closed when the recorded run is stale against the working tree', () => {
    const result = evaluate(greenReport(), MOVED)
    expect(result.ok).toBe(false)
    const stale = problemsMentioning(result.problems, 'stale')
    expect(stale).toHaveLength(1)
    expect(stale[0]).toContain(FRESH)
    expect(stale[0]).toContain(MOVED)
  })

  test('fails closed when a proof fixture never ran, naming it', () => {
    const absent = firstFixture()
    const result = evaluate(
      withFiles((files) => {
        Reflect.deleteProperty(files, absent)
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain(absent)
    expect(result.problems[0]).toContain('did not run')
  })

  test('fails closed when a proof fixture ran with failures, naming it', () => {
    const failing = firstFixture()
    const result = evaluate(
      withFiles((files) => {
        files[failing] = { tests: 9, failures: 2 }
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain(failing)
    expect(result.problems[0]).toContain('failed')
  })

  test('fails closed when the recorded run had module load errors, naming the file', () => {
    const report = greenReport()
    const runErrors = [{ file: 'tests/analytics/keyring.test.ts', message: 'Cannot find module "x"\nat …' }]
    const result = evaluate({ ...report, runErrors })
    expect(result.ok).toBe(false)
    expect(problemsMentioning(result.problems, 'tests/analytics/keyring.test.ts')).toHaveLength(1)
  })

  test('every one of the 57 fixtures is individually load-bearing', () => {
    const outcomes = FIXTURES.map((fixture) => ({ fixture, ...withoutFixture(fixture) }))

    expect(outcomes.filter((outcome) => outcome.ok)).toEqual([])
    expect(outcomes.filter((outcome) => !outcome.named).map((outcome) => outcome.fixture)).toEqual([])
  })

  test('accumulates every problem rather than stopping at the first', () => {
    const [first, second] = FIXTURES
    const report = withFiles((files) => {
      Reflect.deleteProperty(files, String(first))
      files[String(second)] = { tests: 5, failures: 1 }
    })
    const result = evaluate({ ...report, scope: { kind: 'paths', paths: ['tests/analytics'] } }, MOVED)
    expect(result.ok).toBe(false)
    expect(result.problems.length).toBeGreaterThanOrEqual(4)
    expect(problemsMentioning(result.problems, String(first))).toHaveLength(1)
    expect(problemsMentioning(result.problems, String(second))).toHaveLength(1)
  })
})

describe('runPrivacyContractGate', () => {
  test('exits zero and says what it proved when the recorded run satisfies the contract', () => {
    const deps = depsFor(JSON.stringify(greenReport()))
    expect(runPrivacyContractGate(deps)).toBe(0)
    expect(deps.lines.join('\n')).toContain('57')
  })

  test('exits non-zero and prints every problem when the report is unusable', () => {
    const deps = depsFor(null)
    expect(runPrivacyContractGate(deps)).not.toBe(0)
    expect(deps.lines.join('\n')).toContain(LAST_RUN_JSON)
  })

  test('exits non-zero when the report on disk is corrupt, because readReport fails open', () => {
    const deps = depsFor('{ not json')
    expect(runPrivacyContractGate(deps)).not.toBe(0)
    expect(deps.lines.join('\n')).toContain(LAST_RUN_JSON)
  })

  test('exits non-zero when a proof fixture is missing from the report on disk', () => {
    const report = withFiles((files) => {
      Reflect.deleteProperty(files, firstFixture())
    })
    const deps = depsFor(JSON.stringify(report))
    expect(runPrivacyContractGate(deps)).not.toBe(0)
    expect(deps.lines.join('\n')).toContain(firstFixture())
  })
})
