// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Consolidation speed benchmark core (design test-consolidation-speed-evidence D1/D3):
 * generates paired synthetic arms per hook class, parses the runner's own JUnit
 * durations for them, and derives per-case marginal cost (spread − grouped) / N with
 * median ± IQR over repeats. Pure functions throughout; the world is touched only
 * through the injected {@link RunDeps} seam and the CLI wiring at the bottom.
 *
 * Generated arms use a `.bench.ts` suffix under `reports/test-audit/bench/`: bun's
 * discovery is cwd-wide (it picks up e.g. docs/research fixtures), and only
 * `.test`/`_test`/`.spec`/`_spec` filenames are discovered, so `.bench.ts` files run
 * exclusively via the explicit paths this CLI passes to `bun test`.
 */

/** Ignored tree the generated arms live in (gitignored, outside discovery and the audit scan). */
export const BENCH_GENERATED_ROOT = 'reports/test-audit/bench'

/** Where the CLI persists the benchmark report. */
export const BENCH_REPORT_PATH = 'reports/test-audit/benchmark.json'

/** Bump when a hook class's fixture shape or the pairing structure changes. */
export const BENCHMARK_CLASS_VERSION = 1

export type HookClassId = 'none' | 'cheap-before-each' | 'setup-test-db' | 'mock-heavy'

export type ArmKind = 'spread' | 'grouped'

export interface HookClassSpec {
  readonly id: HookClassId
  readonly label: string
  /** Where the class's fixture work comes from: `none`, `synthetic`, or `real: <helper path>`. */
  readonly fixtureSource: string
  /** Statements both arms run inside `beforeEach`; empty for the `none` class. */
  readonly hookBody: string
  /** Import lines both arms carry verbatim, so a pairing's arms have identical imports. */
  readonly imports: readonly string[]
}

const TEST_HELPERS_IMPORT = `import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../../../tests/utils/test-helpers.js'`
const GROUPED_IMPORT = `import { assertEach, type Row } from '../../../tests/utils/grouped-assertions.js'`

export const HOOK_CLASSES: readonly HookClassSpec[] = [
  {
    id: 'none',
    label: 'no hooks (pure function)',
    fixtureSource: 'none',
    hookBody: '',
    imports: [`import { describe, expect, test } from 'bun:test'`, GROUPED_IMPORT],
  },
  {
    id: 'cheap-before-each',
    label: 'cheap beforeEach (synthetic fixture construction)',
    fixtureSource: 'synthetic',
    hookBody:
      "const fixtures = Array.from({ length: 8 }, (_, index) => ({ id: `fixture-${index}`, tags: ['a', 'b', 'c'] }))\n    void fixtures",
    imports: [`import { beforeEach, describe, expect, test } from 'bun:test'`, GROUPED_IMPORT],
  },
  {
    id: 'setup-test-db',
    label: 'setupTestDb per case (real frozen helper)',
    fixtureSource: 'real: tests/utils/test-helpers.ts setupTestDb',
    hookBody: 'await setupTestDb()',
    imports: [
      `import { beforeEach, describe, expect, test } from 'bun:test'`,
      `import { setupTestDb } from '../../../tests/utils/test-helpers.js'`,
      GROUPED_IMPORT,
    ],
  },
  {
    id: 'mock-heavy',
    label: 'mockLogger + setupTestDb + seedCommonTestPlatformInstances (auth.test.ts shape)',
    fixtureSource: 'real: tests/utils/test-helpers.ts mockLogger+setupTestDb+seedCommonTestPlatformInstances',
    hookBody: 'mockLogger()\n    await setupTestDb()\n    seedCommonTestPlatformInstances()',
    imports: [`import { beforeEach, describe, expect, test } from 'bun:test'`, TEST_HELPERS_IMPORT, GROUPED_IMPORT],
  },
]

/** heuristicVersion-style manifest of the benchmarked classes, embedded in every report. */
export interface ClassManifestRow {
  readonly id: string
  readonly label: string
  readonly fixtureSource: string
}

export const classManifest = (): readonly ClassManifestRow[] =>
  HOOK_CLASSES.map((cls) => ({ id: cls.id, label: cls.label, fixtureSource: cls.fixtureSource }))

export interface GeneratedArm {
  /** Repo-relative, POSIX-separated, under {@link BENCH_GENERATED_ROOT}. */
  readonly path: string
  readonly source: string
}

/** The pure function every row of every arm asserts on; duplicated into the generated file. */
const transformInHarness = (value: number): string => {
  let acc = value
  for (let step = 0; step < 4; step += 1) acc = (acc * 31 + 7) % 1000
  return `v${acc}`
}

const headerComment = (arm: ArmKind): string =>
  `// Generated benchmark arm (${arm}); runs only via the explicit path\n` +
  `// scripts/test-audit/benchmark.ts passes to bun test. Not part of the suite.\n\n` +
  `const transform = (value: number): string => {\n` +
  `  let acc = value\n` +
  `  for (let step = 0; step < 4; step += 1) acc = (acc * 31 + 7) % 1000\n` +
  `  return \`v\${acc}\`\n` +
  `}\n`

const hookBlock = (cls: HookClassSpec): string =>
  cls.hookBody === '' ? '' : `\n  beforeEach(async () => {\n    ${cls.hookBody}\n  })\n`

const spreadCase = (input: number): string =>
  `  test('input ${input}', () => {\n    expect(transform(${input})).toBe('${transformInHarness(input)}')\n  })\n`

const groupedRow = (input: number): string =>
  `      { label: 'input ${input}', input: ${input}, expected: '${transformInHarness(input)}' },\n`

const groupedCase = (inputsPerArm: number): string =>
  `  test('grouped matrix', async () => {\n` +
  `    const rows: readonly Row<{ readonly input: number; readonly expected: string }>[] = [\n` +
  Array.from({ length: inputsPerArm }, (_, input) => groupedRow(input)).join('') +
  `    ]\n` +
  `    await assertEach(rows, (row) => {\n` +
  `      expect(transform(row.input)).toBe(row.expected)\n` +
  `    })\n` +
  `  })\n`

/** Generate one arm of one class's pairing: same inputs, assertions, and imports as its twin. */
export function generateArm(cls: HookClassSpec, arm: ArmKind, inputsPerArm: number): GeneratedArm {
  const body =
    arm === 'spread'
      ? Array.from({ length: inputsPerArm }, (_, input) => spreadCase(input)).join('')
      : groupedCase(inputsPerArm)
  const source =
    headerComment(arm) +
    `\n${cls.imports.join('\n')}\n\n` +
    `describe('bench ${cls.id} ${arm}', () => {${hookBlock(cls)}\n` +
    `${body}})\n`
  return { path: `${BENCH_GENERATED_ROOT}/${cls.id}.${arm}.bench.ts`, source }
}

/** What one arm's own JUnit says about its run. */
export interface ArmRunSummary {
  readonly caseCount: number
  /** Sum of `<testcase>` durations in ms — the runner's in-test accounting, spawn excluded. */
  readonly inTestMs: number
  readonly failures: number
}

const TESTCASE_TIME_PATTERN = /<testcase\b[^>]*\btime="([0-9.eE+-]+)"/gu

const ROOT_FAILURES_PATTERN = /<testsuites\b[^>]*\bfailures="(\d+)"/u
const TESTCASE_COUNT_PATTERN = /<testcase\b/gu

/** Parse one generated arm's JUnit (fresh file, no collision surface — design D3). */
export function parseArmJUnit(xml: string): ArmRunSummary {
  let inTestSec = 0
  for (const match of xml.matchAll(TESTCASE_TIME_PATTERN)) {
    inTestSec += Number.parseFloat(match[1] ?? '0')
  }
  const failures = ROOT_FAILURES_PATTERN.exec(xml)
  return {
    caseCount: [...xml.matchAll(TESTCASE_COUNT_PATTERN)].length,
    inTestMs: inTestSec * 1000,
    failures: failures === null ? 0 : Number.parseInt(failures[1] ?? '0', 10),
  }
}

/** Median plus quartiles (linear interpolation at position q·(n−1)). */
export interface Dispersion {
  readonly median: number
  readonly q1: number
  readonly q3: number
  readonly iqr: number
}

const quantile = (sorted: readonly number[], q: number): number => {
  if (sorted.length === 0) return 0
  const position = q * (sorted.length - 1)
  const low = Math.floor(position)
  const high = Math.ceil(position)
  const at = (index: number): number => sorted[index] ?? 0
  if (low === high) return at(low)
  return at(low) + (at(high) - at(low)) * (position - low)
}

export function medianAndIqr(values: readonly number[]): Dispersion {
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const median = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  return { median, q1, q3, iqr: q3 - q1 }
}

/** Per-case marginal cost: what one hooked per-value case costs over one grouped row. */
export const perCaseMarginalCostMs = (spreadMs: number, groupedMs: number, inputsPerArm: number): number =>
  (spreadMs - groupedMs) / inputsPerArm

export interface ClassRepeatPair {
  readonly spreadMs: number
  readonly groupedMs: number
}

export interface ClassResult {
  readonly id: HookClassId
  readonly label: string
  readonly fixtureSource: string
  readonly inputsPerArm: number
  readonly spreadCases: number
  readonly groupedCases: number
  readonly spreadMsByRepeat: readonly number[]
  readonly groupedMsByRepeat: readonly number[]
  readonly marginalMsByRepeat: readonly number[]
  readonly marginal: Dispersion
}

/** Reduce one class's repeat pairs into its per-case marginal cost with dispersion. */
export function summarizeClass(
  spec: HookClassSpec,
  pairs: readonly ClassRepeatPair[],
  counts: { readonly spreadCases: number; readonly groupedCases: number },
): ClassResult {
  const marginalMsByRepeat = pairs.map((pair) =>
    perCaseMarginalCostMs(pair.spreadMs, pair.groupedMs, counts.spreadCases),
  )
  return {
    id: spec.id,
    label: spec.label,
    fixtureSource: spec.fixtureSource,
    inputsPerArm: counts.spreadCases,
    spreadCases: counts.spreadCases,
    groupedCases: counts.groupedCases,
    spreadMsByRepeat: pairs.map((pair) => pair.spreadMs),
    groupedMsByRepeat: pairs.map((pair) => pair.groupedMs),
    marginalMsByRepeat,
    marginal: medianAndIqr(marginalMsByRepeat),
  }
}

export interface ClassRunInput {
  readonly spec: HookClassSpec
  readonly pairs: readonly ClassRepeatPair[]
  readonly spreadCases: number
  readonly groupedCases: number
}

export interface BuildBenchmarkInput {
  readonly repeats: number
  readonly inputsPerArm: number
  readonly bunVersion: string
  readonly hostLoad: readonly number[]
  readonly cores: number
  readonly classRuns: readonly ClassRunInput[]
}

export interface BenchmarkReport {
  readonly schemaVersion: 1
  readonly classManifestVersion: number
  readonly repeats: number
  readonly inputsPerArm: number
  readonly bunVersion: string
  readonly hostLoad: readonly number[]
  readonly cores: number
  readonly classes: readonly ClassResult[]
}

export function buildBenchmarkReport(input: BuildBenchmarkInput): BenchmarkReport {
  return {
    schemaVersion: 1,
    classManifestVersion: BENCHMARK_CLASS_VERSION,
    repeats: input.repeats,
    inputsPerArm: input.inputsPerArm,
    bunVersion: input.bunVersion,
    hostLoad: input.hostLoad,
    cores: input.cores,
    classes: input.classRuns.map((run) =>
      summarizeClass(run.spec, run.pairs, {
        spreadCases: run.spreadCases,
        groupedCases: run.groupedCases,
      }),
    ),
  }
}
