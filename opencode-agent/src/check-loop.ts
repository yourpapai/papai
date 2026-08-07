// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { fence } from './markdown.js'
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
  /**
   * Characters kept from each failing check's output.
   *
   * Per failure, and therefore not a bound on the prompt: N red checks carry N
   * times this into every repair round. `prompt-budget.ts` holds the aggregate
   * cap that actually bounds what the model is sent.
   */
  outputBudget?: number
}

export interface CheckLoopResult {
  passed: boolean
  rounds: number
  failures: CheckFailure[]
}

const DEFAULT_OUTPUT_BUDGET = 8000

/**
 * Keeps the tail of a log: failures and stack traces cluster at the end.
 *
 * Says how much it dropped rather than trimming silently, so a reader — model or
 * human — knows they are looking at an excerpt.
 */
export const clipTail = (text: string, budget: number): string => {
  if (text.length <= budget) return text
  return `…(truncated ${text.length - budget} chars)…\n${text.slice(-budget)}`
}

export const truncateOutput = (result: CommandResult, budget: number): string =>
  clipTail(`${result.stdout}\n${result.stderr}`.trim(), budget)

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

/** One pass of the loop: what it is about to run, and whether that is everything. */
interface Round {
  attempt: number
  scope: readonly CheckSpec[]
  /** Whether `scope` is every configured check. */
  full: boolean
}

/**
 * The checks that just failed, as the next round's scope.
 *
 * No guard against this coming out empty, and deliberately so. It cannot — the
 * failures were produced by running these same checks — and if it somehow did,
 * an empty scope runs nothing, finds nothing, and lands in the verification
 * branch below, which runs everything before anything can be called green. The
 * bad outcome is unreachable twice over, so a fallback here would be a defence
 * no test could hold in place.
 */
const narrowTo = (all: readonly CheckSpec[], failures: readonly CheckFailure[]): readonly CheckSpec[] => {
  const failed = new Set(failures.map((failure) => failure.name))
  return all.filter((check) => failed.has(check.name))
}

/**
 * Runs the checks, and on failure hands the output back to the agent to repair,
 * up to `maxRounds` attempts.
 *
 * **The first round runs everything; later rounds re-run only what failed.**
 * Those are two different questions and the old loop answered both the same
 * way. Running everything the first time is what lets one repair prompt see the
 * lint error *and* the failing test and fix both at once, where a fail-fast
 * loop would burn a round on each — that part is unchanged. Re-running the
 * checks that already passed is what cost the time: on a repository with a
 * twenty-minute test suite, a lint failure used to re-run the whole suite on
 * every round to watch it pass again.
 *
 * A narrowed round that comes back green does **not** finish the loop. The
 * checks it skipped have not been looked at since before a repair edited the
 * tree, and a fix for one check is entirely capable of breaking another — so
 * green on a subset is a reason to run everything, not a reason to stop. Only a
 * full pass can return `passed`.
 *
 * That verification pass costs no model call and no attempt, so `rounds` still
 * counts repairs rather than command runs.
 */
export const runCheckLoop = (options: CheckLoopOptions): Promise<CheckLoopResult> => {
  const budget = options.outputBudget ?? DEFAULT_OUTPUT_BUDGET
  const maxRounds = Math.max(1, options.maxRounds)
  const all = options.checks

  const round = async ({ attempt, scope, full }: Round): Promise<CheckLoopResult> => {
    const failures = await collectFailures(scope, options.run, budget)

    if (failures.length > 0) {
      if (attempt >= maxRounds) return { passed: false, rounds: attempt, failures }
      await options.repair(failures, attempt)
      return round({ attempt: attempt + 1, scope: narrowTo(all, failures), full: false })
    }

    if (full) return { passed: true, rounds: attempt, failures: [] }
    return round({ attempt, scope: all, full: true })
  }

  return round({ attempt: 1, scope: all, full: true })
}

/** Renders failures for an issue comment, capped to keep the comment readable. */
export const formatFailures = (failures: readonly CheckFailure[], perFailure = 1500): string =>
  failures
    .map((failure) => {
      const body = failure.output.length > perFailure ? failure.output.slice(-perFailure) : failure.output
      return `**${failure.name}** (exit ${failure.exitCode})\n\n${fence(body)}`
    })
    .join('\n\n')
