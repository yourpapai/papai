// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { runBenchmark, type RunDeps } from '../../../scripts/test-audit/benchmark-run.js'
import {
  BENCH_GENERATED_ROOT,
  BENCHMARK_CLASS_VERSION,
  HOOK_CLASSES,
  buildBenchmarkReport,
  classManifest,
  generateArm,
  medianAndIqr,
  parseArmJUnit,
  perCaseMarginalCostMs,
  summarizeClass,
  type ArmRunSummary,
  type ClassRepeatPair,
  type Dispersion,
  type GeneratedArm,
  type HookClassSpec,
} from '../../../scripts/test-audit/benchmark.js'
import { AUDIT_SCAN_PATTERN } from '../../../scripts/test-audit/fragmentation.js'

const classById = (id: string): HookClassSpec => {
  const found = HOOK_CLASSES.find((cls) => cls.id === id)
  if (found === undefined) throw new Error(`no hook class ${id}`)
  return found
}

const importLines = (source: string): readonly string[] =>
  source
    .split('\n')
    .filter((line) => line.startsWith('import '))
    .sort()

const armsOf = (id: string, inputsPerArm: number): readonly [GeneratedArm, GeneratedArm] => [
  generateArm(classById(id), 'spread', inputsPerArm),
  generateArm(classById(id), 'grouped', inputsPerArm),
]

describe('benchmark generator hook classes', () => {
  test('covers none, cheap-before-each, setup-test-db, and mock-heavy', () => {
    expect(HOOK_CLASSES.map((cls) => cls.id)).toEqual(['none', 'cheap-before-each', 'setup-test-db', 'mock-heavy'])
  })

  test('every class carries an id, label, and fixture source', () => {
    for (const cls of HOOK_CLASSES) {
      expect(cls.id.length).toBeGreaterThan(0)
      expect(cls.label.length).toBeGreaterThan(0)
      expect(cls.fixtureSource.length).toBeGreaterThan(0)
    }
  })

  test('db and mock-heavy classes use the real frozen helpers; cheap class is a stated synthetic', () => {
    expect(classById('setup-test-db').fixtureSource).toContain('tests/utils/test-helpers.ts')
    expect(classById('setup-test-db').fixtureSource).toContain('setupTestDb')
    expect(classById('mock-heavy').fixtureSource).toContain('tests/utils/test-helpers.ts')
    expect(classById('mock-heavy').fixtureSource).toContain('mockLogger')
    expect(classById('cheap-before-each').fixtureSource).toBe('synthetic')
    expect(classById('none').fixtureSource).toBe('none')
  })

  test('emits a heuristicVersion-style class manifest', () => {
    expect(BENCHMARK_CLASS_VERSION).toBeGreaterThan(0)
    expect(classManifest().map((row) => row.id)).toEqual(HOOK_CLASSES.map((cls) => cls.id))
    for (const row of classManifest()) {
      expect(row.fixtureSource).toBe(classById(row.id).fixtureSource)
      expect(row.label.length).toBeGreaterThan(0)
    }
  })
})

describe('benchmark generator paired arms', () => {
  test('arms differ only in case structure: spread has N cases, grouped has one', () => {
    const [spread, grouped] = armsOf('cheap-before-each', 25)
    const caseSites = (source: string): number => [...source.matchAll(/(?:^|\n)\s*test\('/gu)].length
    expect(caseSites(spread.source)).toBe(25)
    expect(caseSites(grouped.source)).toBe(1)
    expect(grouped.source).toContain('assertEach')
  })

  test('arms assert the same fixture inputs and expected outputs', () => {
    const [spread, grouped] = armsOf('setup-test-db', 12)
    for (let input = 0; input < 12; input += 1) {
      expect(spread.source).toContain(`transform(${input})`)
      expect(grouped.source).toContain(`input: ${input}`)
    }
    const expectedOf = (source: string): readonly string[] => [...source.matchAll(/'v\d+'/gu)].map((match) => match[0])
    expect(expectedOf(grouped.source)).toHaveLength(12)
    for (const literal of expectedOf(grouped.source)) {
      expect(spread.source).toContain(literal)
    }
  })

  test('arms of every class carry identical imports', () => {
    for (const cls of HOOK_CLASSES) {
      const [spread, grouped] = armsOf(cls.id, 5)
      expect(importLines(spread.source)).toEqual(importLines(grouped.source))
    }
  })

  test('both arms carry the class hook; the none class carries no beforeEach', () => {
    const hookCount = (source: string): number => [...source.matchAll(/beforeEach\(/gu)].length
    for (const cls of HOOK_CLASSES.filter((spec) => spec.id !== 'none')) {
      const [spread, grouped] = armsOf(cls.id, 5)
      expect(hookCount(spread.source)).toBe(1)
      expect(hookCount(grouped.source)).toBe(1)
      expect(spread.source).toContain(cls.hookBody)
      expect(grouped.source).toContain(cls.hookBody)
    }
    const [noneSpread, noneGrouped] = armsOf('none', 5)
    expect(hookCount(noneSpread.source)).toBe(0)
    expect(hookCount(noneGrouped.source)).toBe(0)
  })

  test('the mock-heavy hook mirrors the auth.test.ts beforeEach shape', () => {
    const cls = classById('mock-heavy')
    expect(cls.hookBody).toContain('mockLogger()')
    expect(cls.hookBody).toContain('await setupTestDb()')
    expect(cls.hookBody).toContain('seedCommonTestPlatformInstances()')
    const [spread] = armsOf('mock-heavy', 3)
    expect(spread.source).toContain(`from '../../../tests/utils/test-helpers.js'`)
  })
})

describe('benchmark generator path discipline', () => {
  test('generated paths sit under the ignored bench root', () => {
    for (const cls of HOOK_CLASSES) {
      for (const arm of armsOf(cls.id, 3)) {
        expect(arm.path.startsWith(`${BENCH_GENERATED_ROOT}/`)).toBe(true)
      }
    }
  })

  test('generated paths are outside bun test discovery and the audit scan set', () => {
    const auditPattern = new RegExp(`^${AUDIT_SCAN_PATTERN.replaceAll('.', '\\.').replaceAll('**', '.*')}$`, 'u')
    for (const cls of HOOK_CLASSES) {
      for (const arm of armsOf(cls.id, 3)) {
        expect(/(\.test|_test_|\.spec|_spec_)/u.test(arm.path)).toBe(false)
        expect(arm.path.endsWith('.bench.ts')).toBe(true)
        expect(auditPattern.test(arm.path)).toBe(false)
      }
    }
  })

  test('spread and grouped paths are distinguishable per class', () => {
    const [spread, grouped] = armsOf('none', 3)
    expect(spread.path).toBe(`${BENCH_GENERATED_ROOT}/none.spread.bench.ts`)
    expect(grouped.path).toBe(`${BENCH_GENERATED_ROOT}/none.grouped.bench.ts`)
  })
})

const junitWithTimes = (timesSec: readonly string[], failures = 0): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="${timesSec.length}" assertions="${timesSec.length}" failures="${failures}" skipped="0" time="0.9">
  <testsuite name="arm.bench.ts" file="reports/test-audit/bench/arm.bench.ts" tests="${timesSec.length}" failures="${failures}" skipped="0" time="0.5">
${timesSec.map((timeSec, index) => `    <testcase name="case ${index}" classname="" time="${timeSec}" file="reports/test-audit/bench/arm.bench.ts" line="${index + 2}" assertions="1" />`).join('\n')}
  </testsuite>
</testsuites>
`

describe('benchmark JUnit parsing', () => {
  test('derives per-arm in-test totals and per-case counts from JUnit text', () => {
    const summary: ArmRunSummary = parseArmJUnit(junitWithTimes(['0.010', '0.020', '0.030']))
    expect(summary.caseCount).toBe(3)
    expect(summary.inTestMs).toBeCloseTo(60, 6)
  })

  test('ignores process overhead in the root time attribute and reports failures', () => {
    const summary: ArmRunSummary = parseArmJUnit(junitWithTimes(['0.001'], 1))
    expect(summary.inTestMs).toBeCloseTo(1, 6)
    expect(summary.failures).toBe(1)
  })

  test('an empty document is a zero-case run, not a crash', () => {
    const summary: ArmRunSummary = parseArmJUnit(
      `<?xml version="1.0"?><testsuites name="bun test" tests="0" failures="0" skipped="0" time="0.6"></testsuites>`,
    )
    expect(summary.caseCount).toBe(0)
    expect(summary.inTestMs).toBe(0)
    expect(summary.failures).toBe(0)
  })
})

describe('benchmark analysis', () => {
  test('median and IQR over repeats', () => {
    const stats: Dispersion = medianAndIqr([5, 1, 9, 3, 7])
    expect(stats.median).toBe(5)
    expect(stats.q1).toBe(3)
    expect(stats.q3).toBe(7)
    expect(stats.iqr).toBe(4)
  })

  test('median of an even sample interpolates between the middle values', () => {
    const stats: Dispersion = medianAndIqr([1, 2, 3, 4])
    expect(stats.median).toBe(2.5)
    expect(stats.q1).toBeCloseTo(1.75, 6)
    expect(stats.q3).toBeCloseTo(3.25, 6)
  })

  test('per-case marginal cost divides the paired difference by N', () => {
    expect(perCaseMarginalCostMs(120, 20, 100)).toBeCloseTo(1, 6)
  })

  test('summarizeClass derives per-repeat marginals and their dispersion', () => {
    const pairs: readonly ClassRepeatPair[] = [
      { spreadMs: 120, groupedMs: 20 },
      { spreadMs: 100, groupedMs: 20 },
      { spreadMs: 80, groupedMs: 20 },
    ]
    const result = summarizeClass(classById('none'), pairs, { spreadCases: 100, groupedCases: 1 })
    expect(result.inputsPerArm).toBe(100)
    expect(result.marginalMsByRepeat).toHaveLength(3)
    expect(result.marginal.median).toBeCloseTo(0.8, 6)
    expect(result.marginalMsByRepeat[1]).toBeCloseTo(0.8, 6)
  })

  test('buildBenchmarkReport carries versions, repeats, host shape, and the class manifest', () => {
    const pairs: readonly ClassRepeatPair[] = [{ spreadMs: 10, groupedMs: 5 }]
    const report = buildBenchmarkReport({
      repeats: 1,
      inputsPerArm: 50,
      bunVersion: '1.3.13-test',
      hostLoad: [0.25, 0.5, 0.75],
      cores: 4,
      classRuns: HOOK_CLASSES.map((cls) => ({
        spec: cls,
        pairs,
        spreadCases: 50,
        groupedCases: 1,
      })),
    })
    expect(report.schemaVersion).toBe(1)
    expect(report.classManifestVersion).toBe(BENCHMARK_CLASS_VERSION)
    expect(report.repeats).toBe(1)
    expect(report.bunVersion).toBe('1.3.13-test')
    expect(report.hostLoad).toEqual([0.25, 0.5, 0.75])
    expect(report.cores).toBe(4)
    expect(report.classes).toHaveLength(HOOK_CLASSES.length)
    for (const row of report.classes) {
      expect(row.fixtureSource).toBe(classById(row.id).fixtureSource)
    }
  })
})

describe('runBenchmark orchestration through the RunDeps seam', () => {
  const armJunit = (cases: number, msPerCase: number, failures = 0): string =>
    junitWithTimes(
      Array.from({ length: cases }, () => (msPerCase / 1000).toFixed(6)),
      failures,
    )

  const makeRecordingDeps = (written: string[], ran: string[]): RunDeps => ({
    write: async (relPath, source) => {
      await Promise.resolve()
      written.push(relPath)
      expect(source.length).toBeGreaterThan(0)
    },
    runArm: async (relPath) => {
      await Promise.resolve()
      ran.push(relPath)
      return armJunit(relPath.includes('spread') ? 6 : 1, relPath.includes('spread') ? 2 : 6)
    },
  })

  test('writes both arms once, runs every repeat, and reports per-class results', async () => {
    const written: string[] = []
    const ran: string[] = []
    const report = await runBenchmark(
      makeRecordingDeps(written, ran),
      { repeats: 2, inputsPerArm: 6 },
      { bunVersion: 'test', hostLoad: [0, 0, 0], cores: 1 },
    )
    expect(written).toHaveLength(HOOK_CLASSES.length * 2)
    expect(ran).toHaveLength(HOOK_CLASSES.length * 2 * 2)
    expect(report.repeats).toBe(2)
    expect(report.classes).toHaveLength(HOOK_CLASSES.length)
    for (const row of report.classes) {
      // (6 cases x 2ms) - (1 case x 6ms) = 6ms over 6 inputs = 1ms/case in every repeat.
      expect(row.marginal.median).toBeCloseTo(1, 6)
    }
  })

  test('a failing arm aborts the run instead of feeding timings into the report', async () => {
    const deps: RunDeps = {
      write: async () => {
        await Promise.resolve()
      },
      runArm: async () => {
        await Promise.resolve()
        return armJunit(1, 1, 1)
      },
    }
    await expect(
      runBenchmark(
        deps,
        { repeats: 1, inputsPerArm: 4 },
        {
          bunVersion: 'test',
          hostLoad: [0, 0, 0],
          cores: 1,
        },
      ),
    ).rejects.toThrow('failures')
  })
})
