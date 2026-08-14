// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CommandResult } from './shell.js'

/**
 * How a finished loop is **read**: what it produced, whether it is a failure, and
 * what to say about it.
 *
 * Split from `review-runner.ts` when that file passed `max-lines`, along the seam
 * the module already described: that file generates the loop's inputs and runs the
 * child, and this is the whole of what happens to its exit code afterwards. The two
 * change for different reasons — a new setting is a change over there, while a
 * newly-distinguishable ending (`stopped` was the last one) is a change here and in
 * whichever renderer reads the result.
 *
 * `review-runner.ts` re-exports all of it, so callers keep naming one module.
 */

/**
 * The exit code the loop uses for "I stopped at my own bound", from
 * `review-loop/src/cli.ts`.
 *
 * Two spellings of one contract, like `FIX_PUBLISHED_MARKER`, each with a test on
 * its own side of the pipe. It has to be distinguishable from both 0 and 1: the
 * loop neither finished its rounds nor broke, and reporting either of those is a
 * false statement about what a maintainer will find on the branch.
 */
export const REVIEW_STOPPED_EXIT_CODE = 75

/**
 * Builds `review-loop`'s config. Every agent role gets the same model because
 * the pipeline is configured with exactly one endpoint; the workspace's ability
 * to mix models per role is deliberately left unused rather than invented here.
 */

/**
 * `unavailable` is a distinct outcome, not a failure.
 *
 * The review loop is this repository's own workspace, so a checkout that does
 * not have it is not a repository whose review failed — it is one with no review
 * configured. Collapsing the two made every run in any other repository report a
 * permanently red review whose summary read `Module not found`.
 */
export type ReviewOutcome = 'passed' | 'stopped' | 'failed' | 'unavailable'

export interface ReviewRunResult {
  outcome: ReviewOutcome
  /** The loop's own summary block, or the tail of its output when it crashed. */
  summary: string
  exitCode: number
  /**
   * One sentence naming *how* a failed loop failed, or `null` when it did not.
   *
   * The exit code alone is not an account of anything: a build gate that went
   * red, a runner deadline, a missing `bun`, a plan path that does not resolve
   * and a merge conflict are all `exit 1` with sixty lines of tail, and each has
   * a different remedy. See {@link describeFailure}.
   */
  failure: string | null
}

const SUMMARY_TAIL_LINES = 60

/**
 * `review-loop` prints its summary to stdout before finalizing, so the tail of
 * stdout is the summary even on the runs that later fail their build gate —
 * which is exactly when the summary is worth reading.
 */
export const extractSummary = (result: CommandResult, tailLines = SUMMARY_TAIL_LINES): string => {
  const combined = `${result.stdout}\n${result.stderr}`.trim()
  if (combined.length === 0) return '(review-loop produced no output)'
  return combined.split('\n').slice(-tailLines).join('\n')
}

/** The last line of `text` that says anything, or `null` for text that says nothing. */
const lastMeaningfulLine = (text: string): string | null => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.at(-1) ?? null
}

const minutes = (ms: number): string => `${Math.round(ms / 60_000)}m`

/**
 * What went wrong, in one sentence a maintainer can act on — or `null` for a
 * loop that did not fail.
 *
 * Every branch here answers a failure that used to reach the issue as `exited 1`
 * beside sixty lines of tail, which names neither the cause nor the remedy. The
 * order matters: the deadline is asked first because a killed child's exit code
 * is whatever the signal left behind and says nothing, and the two sentences the
 * loop itself writes are matched before the fallback because they are the only
 * ones that already know why they lost the work.
 */
export const describeFailure = (result: CommandResult, timeoutMs: number): string | null => {
  if (result.exitCode === 0) return null

  // The loop stopping itself is an outcome, not a failure: it published what it
  // had, wrote its summary and said so. `reviewOutcome` reports it as `stopped`,
  // and there is nothing here to describe.
  if (result.exitCode === REVIEW_STOPPED_EXIT_CODE) return null

  if (result.timedOut === true) {
    return `the review loop timed out after ${minutes(timeoutMs)} and was killed; nothing it had not already published is lost`
  }

  if (result.exitCode === 127) {
    return `the review command could not be started (${lastMeaningfulLine(result.stderr) ?? 'no output'})`
  }

  const combined = `${result.stdout}\n${result.stderr}`
  if (combined.includes('Final build check failed')) {
    return "the loop's own build gate failed at the end of the run, so it merged nothing further"
  }
  if (combined.includes('Merge conflict while bringing')) {
    return 'the loop could not merge its branch back: it conflicts with the working branch'
  }

  const said = lastMeaningfulLine(result.stderr) ?? lastMeaningfulLine(result.stdout)
  return said === null
    ? `the review loop exited ${result.exitCode} silently`
    : `the review loop exited ${result.exitCode}: ${said}`
}

/** Three exit codes with three different things to tell a maintainer. */
export const reviewOutcome = (exitCode: number): ReviewOutcome => {
  if (exitCode === 0) return 'passed'
  return exitCode === REVIEW_STOPPED_EXIT_CODE ? 'stopped' : 'failed'
}
