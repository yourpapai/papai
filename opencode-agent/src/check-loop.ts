// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mapSeries } from './sequence.js'
import type { CommandResult } from './shell.js'

/**
 * A "make these commands green" loop, used by the CI-fix phase.
 *
 * This is deliberately *not* the review loop: reviewing a diff for latent
 * problems is the `review-loop/` workspace's job and it is driven from
 * `review-runner.ts`. What this does is narrower and has no equivalent there —
 * take a set of named commands that CI reported red, run them locally, hand the
 * output to the agent, and repeat until they pass or the round budget runs out.
 */

/** One check the loop runs, as an argv vector. */
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

export interface CheckLoopOptions {
  checks: readonly CheckSpec[]
  run: CheckRunner
  repair: RepairFn
  /** Total attempts, including the first. `1` disables self-repair. */
  maxRounds: number
  /** Characters of check output handed to the repair agent, per failure. */
  outputBudget?: number
}

export interface CheckLoopResult {
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
 * Runs every check, and on failure hands the output back to the agent to
 * repair, up to `maxRounds` attempts.
 *
 * All checks run each round even after the first failure: a repair prompt that
 * sees the lint error *and* the failing test fixes both in one pass, where a
 * fail-fast loop would burn a round on each.
 */
export const runCheckLoop = (options: CheckLoopOptions): Promise<CheckLoopResult> => {
  const budget = options.outputBudget ?? DEFAULT_OUTPUT_BUDGET
  const maxRounds = Math.max(1, options.maxRounds)

  const round = async (attempt: number): Promise<CheckLoopResult> => {
    const failures = await collectFailures(options.checks, options.run, budget)
    if (failures.length === 0) return { passed: true, rounds: attempt, failures: [] }
    if (attempt >= maxRounds) return { passed: false, rounds: attempt, failures }

    await options.repair(failures, attempt)
    return round(attempt + 1)
  }

  return round(1)
}

/** Renders failures for an issue comment, capped to keep the comment readable. */
export const formatFailures = (failures: readonly CheckFailure[], perFailure = 1500): string =>
  failures
    .map((failure) => {
      const body = failure.output.length > perFailure ? failure.output.slice(-perFailure) : failure.output
      return `**${failure.name}** (exit ${failure.exitCode})\n\n\`\`\`\n${body}\n\`\`\``
    })
    .join('\n\n')
