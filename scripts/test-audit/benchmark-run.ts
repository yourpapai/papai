// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Benchmark orchestration + CLI (design test-consolidation-speed-evidence D1/D3). The
 * world is touched only here: {@link RunDeps} carries the fs writes and the bun-test
 * spawn, so the pure core in `benchmark.ts` stays exercisable against in-memory fakes.
 */

import pLimit from 'p-limit'

import {
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
