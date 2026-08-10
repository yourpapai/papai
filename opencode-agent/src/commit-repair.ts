// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clipTail, truncateOutput } from './check-loop.js'
import type { StagedTotals } from './diff-guard.js'
import { GitError } from './git.js'
import type { Logger } from './logger.js'
import { CHECK_OUTPUT_BUDGET } from './prompt-budget.js'
import type { UntrustedEnvelope } from './prompts.js'

/**
 * A refused commit, handed back to the model to fix, rather than ending the run.
 *
 * The finding this closes: a repository that gates commits on its own checks makes
 * `git commit` the *last* place a lint error can surface, and the one place the
 * pipeline had no answer for it. `package.json`'s `prepare` installs
 * `scripts/pre-commit.sh` as `.git/hooks/pre-commit` on any install where `.git`
 * exists — the Actions runner included — and it runs lint, typecheck, format:check
 * and the licence scan over the staged files. So an implementation turn that wrote
 * working code with an unformatted file or an unused import in it could not commit
 * at all: `commitAll` threw `GitError`, `handleImplement` parked in `FAILED`, and a
 * maintainer had to reply `/retry` to buy a whole fresh job — which re-ran the model
 * turn that had already succeeded — for a fix the model could have made in seconds
 * from the output git had just printed. Observed on issue #240: eleven lint errors,
 * one type error and two unformatted files ended a run that had implemented ten of
 * twelve plan steps.
 *
 * This is deliberately *not* {@link import('./check-loop.js').runCheckLoop}. That
 * loop owns a set of named commands, runs them, and decides what is green; here the
 * repository's own hook is the judge, the pipeline never chooses or runs the checks,
 * and the only verdict available is whether `git commit` was accepted. What the two
 * share is the shape — output to the model, edit, try again, bounded — and the
 * helpers that clip a log to something a prompt can carry.
 *
 * Three properties, each a decision:
 *
 *  - **Only a `GitError` is repaired.** The guard's refusals — a staged credential, a
 *    binary, a runaway `git add --all` — are `PipelineError`s raised before the commit
 *    is ever issued, so they still end the run, and no repair round can talk the
 *    pipeline into committing a secret. What is left inside `commitAll` is a `status`,
 *    an `add --all`, a `diff --cached` and the commit itself, over a checkout this
 *    pipeline made moments earlier: the commit is the one of those that fails in
 *    practice, and the others failing means the checkout is broken in a way a bounded
 *    number of wasted turns reports just as honestly as a throw would.
 *  - **The rounds are bounded and the original rejection is what is finally
 *    thrown.** A run that spends them fails exactly as it failed before this module
 *    existed — same message, same `FAILED`, same `/retry` — so the change can only
 *    turn a failure into a success, never a success into a different failure.
 *  - **It never commits.** The repair prompt edits the tree and the caller re-issues
 *    `commitAll`, which re-stages and re-runs the guard over whatever the repair
 *    left behind. A repair that staged and committed for itself would put a tree the
 *    guard has not seen into history, which is the one thing `--no-verify` is
 *    reserved for and is reserved for the salvage path alone.
 */

/** What the refused `git commit` reported, in the shape the repair prompt renders. */
export interface CommitRejection {
  exitCode: number
  /** Combined stdout and stderr of the refused commit, tail-clipped. */
  output: string
}

/** Asks the model to fix what a rejection reported. Edits only; never commits. */
export type RepairCommitFn = (rejection: CommitRejection, round: number) => Promise<void>

export interface CommitRepairInput {
  /** Stages, guards and commits — `Git.commitAll` bound to this commit's message. */
  commit: () => Promise<StagedTotals | null>
  repair: RepairCommitFn
  /**
   * Commit attempts, including the first. `1` disables repair entirely and
   * restores the behaviour this module replaced.
   */
  maxRounds: number
  log: Logger
  issue: number
}

const rejectionOf = (error: GitError): CommitRejection => ({
  exitCode: error.result.exitCode,
  output: truncateOutput(error.result, CHECK_OUTPUT_BUDGET),
})

/**
 * Commits, and on a refusal hands what the repository printed back to the model.
 *
 * Resolves what {@link CommitRepairInput.commit} resolves — `null` for a tree that
 * was already clean, which is an ordinary outcome and never something to repair.
 * Rejects with the last refusal once the rounds are spent.
 *
 * Tail recursion rather than a loop, for the repo lint that forbids awaiting in a
 * loop body, and bounded by `maxRounds` rather than by the recursion.
 */
export const commitWithRepair = (input: CommitRepairInput): Promise<StagedTotals | null> => {
  const maxRounds = Math.max(1, input.maxRounds)

  const attempt = async (round: number): Promise<StagedTotals | null> => {
    try {
      return await input.commit()
    } catch (error) {
      if (!(error instanceof GitError) || round >= maxRounds) throw error

      const rejection = rejectionOf(error)
      input.log.warn(
        { issue: input.issue, round, of: maxRounds, exitCode: rejection.exitCode },
        'The repository refused the commit; asking the model to fix what its checks reported',
      )
      await input.repair(rejection, round)
      return attempt(round + 1)
    }
  }

  return attempt(1)
}

/**
 * What the model is told about a refused commit.
 *
 * The output is enveloped for the reason every check output in this pipeline is:
 * a hook prints whatever the repository's own scripts say, those scripts quote file
 * contents a contributor wrote, and this text is going into a prompt. The prompt
 * says what refused rather than naming a tool, because the hook is the
 * repository's and not the pipeline's — a checkout with a different hook gets the
 * same treatment and the same words remain true.
 *
 * The last instruction is load-bearing. The model has `bash`, so "the commit was
 * refused" reads to it as an invitation to commit — with `--no-verify`, since that
 * is what a refused hook suggests. That would put a tree neither the hook nor
 * `diff-guard.ts` has accepted into history, and the pipeline would then push it.
 */
export const buildCommitRepairPrompt = (
  envelope: UntrustedEnvelope,
  rejection: CommitRejection,
  round: number,
  budget = CHECK_OUTPUT_BUDGET,
): string =>
  [
    `The work you just finished could not be committed (repair round ${round}). This repository runs its own ` +
      'checks over the staged tree before it accepts a commit — lint, typecheck, formatting, licence headers, ' +
      'whatever this repository gates commits on — and they refused it.',
    `The commit exited ${rejection.exitCode}. What it printed:`,
    envelope.wrap('commit-check-output', clipTail(rejection.output, budget)),
    'Fix the root cause of every failure above in the working tree. Do not weaken, skip or delete a test to ' +
      'make a check pass, and do not add lint-disable or type-ignore comments — this repository rejects those too.',
    'Do not run git yourself: do not commit, do not stage, do not use --no-verify. The pipeline commits again ' +
      'the moment you are done, and it will run these same checks.',
    'Reply with a one-paragraph summary of what you changed.',
  ].join('\n\n')
