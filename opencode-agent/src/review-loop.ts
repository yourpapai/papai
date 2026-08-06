// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mapSeries } from './sequence.js'
import type { CommandResult } from './shell.js'

/** One check the review loop runs, as an argv vector. */
export interface CheckSpec {
  name: string
  argv: readonly string[]
}

export type CheckRunner = (check: CheckSpec) => Promise<CommandResult>

export interface CheckFailure {
  name: string
  exitCode: number
  /** Trimmed combined output, capped so a 50k-line log never reaches the model. */
  output: string
}

/** Asks the agent to fix the reported failures in place. */
export type RepairFn = (failures: readonly CheckFailure[], round: number) => Promise<void>

export interface ReviewLoopOptions {
  checks: readonly CheckSpec[]
  run: CheckRunner
  repair: RepairFn
  /** Total attempts, including the first. `1` disables self-repair. */
  maxRounds: number
  /** Characters of check output handed to the repair agent, per failure. */
  outputBudget?: number
}

export interface ReviewLoopResult {
  passed: boolean
  rounds: number
  failures: CheckFailure[]
}

const DEFAULT_OUTPUT_BUDGET = 8000

/** Keeps the tail of a log: failures and stack traces cluster at the end. */
export const truncateOutput = (result: CommandResult, budget: number): string => {
  const combined = `${result.stdout}\n${result.stderr}`.trim()
  if (combined.length <= budget) return combined
  return `…(truncated ${combined.length - budget} chars)…\n${combined.slice(-budget)}`
}

const collectFailures = async (
  checks: readonly CheckSpec[],
  run: CheckRunner,
  budget: number,
): Promise<CheckFailure[]> => {
  const results = await mapSeries(checks, async (check) => ({ check, result: await run(check) }))

  return results
    .filter(({ result }) => result.exitCode !== 0)
    .map(({ check, result }) => ({
      name: check.name,
      exitCode: result.exitCode,
      output: truncateOutput(result, budget),
    }))
}

/**
 * Runs every check, and on failure hands the output back to the agent to repair,
 * up to `maxRounds` attempts.
 *
 * All checks run each round even after the first failure: a repair prompt that
 * sees the lint error *and* the failing test fixes both in one pass, where a
 * fail-fast loop would burn a round on each.
 */
export const runReviewLoop = (options: ReviewLoopOptions): Promise<ReviewLoopResult> => {
  const budget = options.outputBudget ?? DEFAULT_OUTPUT_BUDGET
  const maxRounds = Math.max(1, options.maxRounds)

  const round = async (attempt: number): Promise<ReviewLoopResult> => {
    const failures = await collectFailures(options.checks, options.run, budget)
    if (failures.length === 0) return { passed: true, rounds: attempt, failures: [] }
    if (attempt >= maxRounds) return { passed: false, rounds: attempt, failures }

    await options.repair(failures, attempt)
    return round(attempt + 1)
  }

  return round(1)
}

export interface MutationReport {
  score: number | null
  output: string
  exitCode: number
}

export interface MutationImproveOptions {
  /** Command reporting a mutation score; must print a parsable score. */
  check: CheckSpec
  run: CheckRunner
  /** Asks the agent to strengthen tests using the reported survivors. */
  improve: (report: MutationReport, round: number) => Promise<void>
  /** Score in [0, 1] the run must reach. */
  threshold: number
  maxRounds: number
  outputBudget?: number
}

export interface MutationImproveResult {
  passed: boolean
  rounds: number
  finalScore: number | null
  report: MutationReport
}

/** Matches Stryker-style summary lines, e.g. `Mutation score: 87.42%`. */
const SCORE_PATTERN = /mutation\s+score[^\d%]*(\d+(?:\.\d+)?)\s*%?/iu

/** Pulls the mutation score out of a runner's output; `null` when absent. */
export const parseMutationScore = (output: string): number | null => {
  const match = SCORE_PATTERN.exec(output)
  if (match === null) return null

  const raw = match[1]
  if (raw === undefined) return null

  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return null
  return value > 1 ? value / 100 : value
}

/**
 * The mutation-improve pattern: measure, and while the score sits under the
 * floor, feed the survivor report back to the agent so it writes the tests that
 * would have killed them. A run that cannot report a score at all counts as a
 * failure — silently passing an unmeasured gate is the worse outcome.
 */
export const runMutationImprove = (options: MutationImproveOptions): Promise<MutationImproveResult> => {
  const budget = options.outputBudget ?? DEFAULT_OUTPUT_BUDGET
  const maxRounds = Math.max(1, options.maxRounds)

  const round = async (attempt: number): Promise<MutationImproveResult> => {
    const result = await options.run(options.check)
    const output = truncateOutput(result, budget)
    const report: MutationReport = {
      score: parseMutationScore(output),
      output,
      exitCode: result.exitCode,
    }

    if (isSatisfied(report, options.threshold)) {
      return { passed: true, rounds: attempt, finalScore: report.score, report }
    }
    if (attempt >= maxRounds) {
      return { passed: false, rounds: attempt, finalScore: report.score, report }
    }

    await options.improve(report, attempt)
    return round(attempt + 1)
  }

  return round(1)
}

const isSatisfied = (report: MutationReport, threshold: number): boolean =>
  report.exitCode === 0 && report.score !== null && report.score >= threshold

/** Renders failures for an issue comment, capped to keep the comment readable. */
export const formatFailures = (failures: readonly CheckFailure[], perFailure = 1500): string =>
  failures
    .map((failure) => {
      const body = failure.output.length > perFailure ? failure.output.slice(-perFailure) : failure.output
      return `**${failure.name}** (exit ${failure.exitCode})\n\n\`\`\`\n${body}\n\`\`\``
    })
    .join('\n\n')
