// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StagedTotals } from './diff-guard.js'
import type { PhaseDeps } from './phase-context.js'
import { errorMessage } from './types.js'

/**
 * Keeping what a stopped turn left on disk, and degrading to a sentence when it
 * cannot.
 *
 * The rule this module exists to hold: the run it is rescuing is **already out of
 * time**, so nothing here may become a second thing that went wrong. Every way this
 * can fail — a refused guard, a clean tree, a git that rejects, a push that cannot
 * reach the remote, a model whose tool child would not stop — comes back as "nothing
 * pushed, and here is why". There is no path out of it that throws.
 *
 * That is not the ordinary shape for this pipeline and it is deliberately narrower
 * than the "one door per feedback channel" rule next door: those channels swallow
 * because their writes are decoration on work that matters, whereas this *is* the
 * work being kept, and the caller reports what it says. Swallowing without reporting
 * would be the silence the whole finding is about.
 */

/** What the branch ended up carrying, and the one sentence to say about it. */
export interface SalvageOutcome {
  /** Totals the salvage commit measured, or `null` when nothing was pushed. */
  kept: StagedTotals | null
  /** Why nothing was pushed, or which ceiling the commit was over. */
  note: string | null
}

const salvageMessage = (issueNumber: number): string =>
  [
    `chore(agent): salvage partial work on issue #${issueNumber}`,
    '',
    "Stopped part-way through by the job's own wall clock. Reply /continue to resume.",
    '',
    `Refs #${issueNumber}`,
  ].join('\n')

export interface SalvageInput {
  deps: PhaseDeps
  issueNumber: number
  branch: string
  /**
   * Whether the working tree is known to be still.
   *
   * The fence, and it is an **assertion** rather than a wait because that is what
   * the measurement allows: an abort returns with its writer already stopped — a
   * shell loop appending to a file was aborted mid-write, the call returned in 29 ms
   * and the file did not grow by a byte in the next five seconds. So there is
   * nothing to poll for. What is left is the case the measurement did not cover: a
   * command that traps `SIGTERM`, or one parked in uninterruptible I/O, which is why
   * the assertion stays rather than being dropped as proven unnecessary.
   *
   * `false` means no abort was accepted, and then the tree may still be being
   * written. Staging one in that state is the single thing this path must not do:
   * the size caps here only report, so a build still emitting files would be
   * committed rather than refused.
   */
  quiescent: boolean
}

export const salvageWork = async (input: SalvageInput): Promise<SalvageOutcome> => {
  const { deps, issueNumber, branch, quiescent } = input

  if (!quiescent) {
    deps.log.warn({ issue: issueNumber }, 'Not staging: the model’s tool child could not be confirmed stopped')
    return {
      kept: null,
      note:
        'I could not confirm the model had stopped, and staging a tree that is still being written to is worse ' +
        'than losing it',
    }
  }

  try {
    return await keep(input)
  } catch (error) {
    // Includes the push. A commit that exists only in a working tree that dies with
    // the job is not something a maintainer can act on, so "nothing was pushed" is
    // the literal truth in that case as well as the useful one.
    deps.log.warn({ issue: issueNumber, branch, error: errorMessage(error) }, 'The salvage could not keep the work')
    return { kept: null, note: `the salvage itself failed: ${errorMessage(error)}` }
  }
}

const keep = async (input: SalvageInput): Promise<SalvageOutcome> => {
  const { deps, issueNumber, branch } = input

  const salvaged = await deps.git.salvageAll(salvageMessage(issueNumber))
  // A turn that stopped before it wrote anything is a legitimate outcome, not an
  // error: the stop still parks and still hands over, it simply has nothing to keep.
  // `noChangesError` is the ordinary path's answer and would be wrong here — it
  // reports a model that finished the plan without touching a file, which is a
  // different story from one that was interrupted before it started.
  if (salvaged.kind === 'clean') return { kept: null, note: 'nothing had been written to the working tree yet' }
  if (salvaged.kind === 'refused') return { kept: null, note: salvaged.reason }

  await deps.git.push(branch, { noVerify: true })
  deps.log.info(
    { issue: issueNumber, branch, files: salvaged.totals.files, lines: salvaged.totals.lines },
    'Salvaged the partial work and pushed it',
  )
  return { kept: salvaged.totals, note: salvaged.overCap }
}
