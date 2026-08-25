// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Benchmark orchestration + CLI (design test-consolidation-speed-evidence D1/D3). The
 * world is touched only here: {@link RunDeps} carries the fs writes and the bun-test
 * spawn, so the pure core in `benchmark.ts` stays exercisable against in-memory fakes.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import pLimit from 'p-limit'

import {
  BENCH_GENERATED_ROOT,
  BENCH_REPORT_PATH,
  HOOK_CLASSES,
  buildBenchmarkReport,
  generateArm,
  parseArmJUnit,
  type ArmRunSummary,
  type BenchmarkReport,
  type ClassRepeatPair,
  type ClassRunInput,
  type GeneratedArm,
  type HookClassSpec,
} from './benchmark.js'
import { projectCli } from './project-cli.js'

/** Every world touch the orchestration needs, injected so tests never spawn. */
export interface RunDeps {
  readonly write: (relPath: string, source: string) => Promise<void>
  /** Run one generated arm under the real runner; resolves to that run's JUnit XML text. */
  readonly runArm: (relPath: string) => Promise<string>
}

export interface RunOptions {
  readonly repeats: number
  readonly inputsPerArm: number
}

export interface RunContext {
  readonly bunVersion: string
  readonly hostLoad: readonly number[]
  readonly cores: number
}

const requireHealthyArm = (relPath: string, run: ArmRunSummary, expectedCases: number): void => {
  if (run.failures > 0) throw new Error(`benchmark arm ${relPath} reported ${run.failures} failures`)
  if (run.caseCount !== expectedCases) {
    throw new Error(`benchmark arm ${relPath} ran ${run.caseCount} cases, expected ${expectedCases}`)
  }
}

interface RepeatOutcome {
  readonly pair: ClassRepeatPair
  readonly spreadCases: number
  readonly groupedCases: number
}

const runRepeatPair = async (
  deps: RunDeps,
  spread: GeneratedArm,
  grouped: GeneratedArm,
  inputsPerArm: number,
): Promise<RepeatOutcome> => {
  const spreadRun = parseArmJUnit(await deps.runArm(spread.path))
  requireHealthyArm(spread.path, spreadRun, inputsPerArm)
  const groupedRun = parseArmJUnit(await deps.runArm(grouped.path))
  requireHealthyArm(grouped.path, groupedRun, 1)
  return {
    pair: { spreadMs: spreadRun.inTestMs, groupedMs: groupedRun.inTestMs },
    spreadCases: spreadRun.caseCount,
    groupedCases: groupedRun.caseCount,
  }
}

/** One class end-to-end: write both arms, then its repeats strictly serially. */
const runClass = async (deps: RunDeps, options: RunOptions, spec: HookClassSpec): Promise<ClassRunInput> => {
  const spread = generateArm(spec, 'spread', options.inputsPerArm)
  const grouped = generateArm(spec, 'grouped', options.inputsPerArm)
  await deps.write(spread.path, spread.source)
  await deps.write(grouped.path, grouped.source)
  const repeatLimit = pLimit(1)
  const outcomes = await Promise.all(
    Array.from({ length: options.repeats }, () =>
      repeatLimit(() => runRepeatPair(deps, spread, grouped, options.inputsPerArm)),
    ),
  )
  const first = outcomes[0]
  return {
    spec,
    pairs: outcomes.map((outcome) => outcome.pair),
    spreadCases: first?.spreadCases ?? 0,
    groupedCases: first?.groupedCases ?? 0,
  }
}

/** Orchestrate the full benchmark through {@link RunDeps}: write once, run serially. */
export async function runBenchmark(deps: RunDeps, options: RunOptions, ctx: RunContext): Promise<BenchmarkReport> {
  const classLimit = pLimit(1)
  const classRuns = await Promise.all(HOOK_CLASSES.map((spec) => classLimit(() => runClass(deps, options, spec))))
  return buildBenchmarkReport({
    repeats: options.repeats,
    inputsPerArm: options.inputsPerArm,
    bunVersion: ctx.bunVersion,
    hostLoad: ctx.hostLoad,
    cores: ctx.cores,
    classRuns,
  })
}

// --- CLI wiring: the only world-touching path ---------------------------------------------

const runArmOnce = async (relPath: string): Promise<string> => {
  const junitPath = `${relPath}.junit.xml`
  // Bun writes the outfile only when a file loads; a stale one would describe the
  // previous run (the same known behavior the test wrapper works around).
  fs.rmSync(junitPath, { force: true })
  const proc = Bun.spawn(['bun', 'test', `./${relPath}`, '--reporter=junit', `--reporter-outfile=${junitPath}`], {
    cwd: process.cwd(),
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`bun test exited ${exitCode} for ${relPath}:\n${stderr}`)
  }
  return fs.readFileSync(junitPath, 'utf8')
}

const realDeps: RunDeps = {
  write: async (relPath, source) => {
    await Promise.resolve()
    fs.mkdirSync(path.dirname(relPath), { recursive: true })
    fs.writeFileSync(relPath, source)
  },
  runArm: runArmOnce,
}

const parsePositiveIntFlag = (args: readonly string[], name: string, fallback: number): number => {
  const match = args.find((arg) => arg.startsWith(`--${name}=`))
  if (match === undefined) return fallback
  const value = Number.parseInt(match.slice(name.length + 3), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const printReport = (report: BenchmarkReport): void => {
  const load = report.hostLoad.map((value) => value.toFixed(2)).join('/')
  console.log(
    `consolidation benchmark (class manifest v${report.classManifestVersion}): bun ${report.bunVersion}, ` +
      `${report.repeats} repeats, ${report.inputsPerArm} inputs/arm, load ${load}, ${report.cores} cores`,
  )
  for (const row of report.classes) {
    console.log(
      `  ${row.id.padEnd(18)} ${row.marginal.median.toFixed(3)} ms/case median ` +
        `(IQR ${row.marginal.iqr.toFixed(3)})  fixture: ${row.fixtureSource}`,
    )
  }
  console.log(`-> ${BENCH_REPORT_PATH}`)
}

const main = async (): Promise<void> => {
  if (process.argv.includes('--project')) {
    projectCli()
    return
  }
  const repeats = parsePositiveIntFlag(process.argv, 'repeats', 5)
  const inputsPerArm = parsePositiveIntFlag(process.argv, 'inputs', 100)
  fs.mkdirSync(BENCH_GENERATED_ROOT, { recursive: true })
  const report = await runBenchmark(
    realDeps,
    { repeats, inputsPerArm },
    { bunVersion: Bun.version, hostLoad: os.loadavg(), cores: os.cpus().length },
  )
  fs.writeFileSync(BENCH_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  printReport(report)
}

if (import.meta.main) {
  await main()
}
