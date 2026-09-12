// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildCommitRepairPrompt, commitWithRepair } from '../commit-repair.js'
import type { CommitRejection } from '../commit-repair.js'
import type { StagedTotals } from '../diff-guard.js'
import { isTurnDeadline, isTurnStall } from '../errors.js'
import type { PipelineError } from '../errors.js'
import { droppedBy } from '../git-commit.js'
import type { PhaseInput } from '../phase-context.js'
import { stepSubject } from '../plan-steps.js'
import type { StepMarker } from '../plan-steps.js'
import type { UntrustedEnvelope } from '../prompts.js'

/**
 * What making one plan step durable comes to: stage it, let the repository judge it,
 * repair what it refuses, commit, push.
 *
 * Split from `implement-steps.ts` when the repair loop pushed that file past
 * `max-lines`, along a seam it already had. That module decides *which* unit of work
 * runs next and when the walk has to stop; this one is about what committing a unit
 * costs and what it is allowed to look like. The two change for different reasons —
 * one for the plan and the clock, the other for what the repository will accept — and
 * only the second has anything to say to the model.
 *
 * It takes the walk's input structurally rather than importing `StepWalkInput`, which
 * is not fastidiousness: `implement-steps.ts` imports this module, so naming its shape
 * here would be the import cycle the repo lint refuses.
 */

/** Everything committing one step needs, which the step walk's own input satisfies. */
export interface StepCommitInput {
  input: PhaseInput
  /** Branch the step commits onto — already checked out by the handler. */
  branch: string
  /** The handler's one envelope, which the repair prompt's check output is wrapped in. */
  envelope: UntrustedEnvelope
  /** The handler's system prompt, which a repair turn reuses verbatim. */
  system: string
}

/** What one step's commit came to: what it wrote, what it cost, and what stopped it. */
export interface StepCommit {
  /** `null` for a tree that was already clean, and for a commit the clock stopped. */
  totals: StagedTotals | null
  /**
   * Paths this step wrote that a push cannot carry, dropped at staging.
   *
   * Carried per step rather than derived at the end, because a drop and a clean
   * tree are the same `null` totals and the walk has no other way to tell them
   * apart. Issue #240 lost two runs to a plan whose last step edited
   * `agent-pipeline.yml`; the drop kept the rest, and said so only to the log.
   */
  dropped: readonly string[]
  /** Repair turns this commit bought — `0` when the first attempt was accepted. */
  repairs: number
  /** The typed deadline failure, when a repair turn was what the clock stopped. */
  stopped: PipelineError | null
}

/**
 * Commits and pushes what one step wrote, and reports how much that was.
 *
 * `null` totals — a clean tree — is an ordinary outcome per step rather than a
 * failure: a step whose work was already done by an earlier one, or whose turn
 * concluded there was nothing to change, leaves the plan unfinished rather than the
 * run broken. Only a whole walk that committed *nothing* is `noChangesError`, which
 * is where that check has to live now. Nothing is pushed for a step that committed
 * nothing, because there is nothing to push.
 *
 * A refused commit is **not** an outcome here, which is the whole of `commit-repair.ts`:
 * the repository's own pre-commit checks get to reject a tree, the model gets to fix
 * what they reported, and only a rejection that survives every round ends the run.
 * The repair is counted at the call rather than reported by `commitWithRepair`,
 * because a turn the clock stops still happened and still has to be counted — the
 * count exists to be honest about what a run spent.
 */
export const commitStep = async (walk: StepCommitInput, marker: StepMarker | null): Promise<StepCommit> => {
  const { deps } = walk.input
  const paid = { repairs: 0 }

  try {
    const committed = await commitWithRepair({
      commit: () => deps.git.commitAll(stepMessage(walk.input.state.issueId, marker)),
      repair: async (rejection, round) => {
        paid.repairs += 1
        await repairCommit(walk, rejection, round)
      },
      maxRounds: deps.config.commitRepairMaxRounds,
      log: deps.log,
      issue: walk.input.state.issueId,
    })

    // `blocked` and `clean` take the same branch — there is nothing to push
    // either way — but only one of them has anything to tell a maintainer.
    if (committed.kind !== 'committed')
      return { totals: null, dropped: droppedBy(committed), repairs: paid.repairs, stopped: null }

    await deps.git.push(walk.branch)
    deps.log.info(
      {
        issue: walk.input.state.issueId,
        branch: walk.branch,
        step: marker?.number,
        files: committed.totals.files,
        lines: committed.totals.lines,
        dropped: committed.dropped,
        repairs: paid.repairs,
      },
      'Step committed and pushed',
    )
    return { totals: committed.totals, dropped: committed.dropped, repairs: paid.repairs, stopped: null }
  } catch (error) {
    // The same split `promptForStep` makes, for the same reason: a bound
    // reached — the whole-turn deadline or the provider-stall window — is not
    // the work breaking, and only those two may start a salvage. Every other
    // rejection — the refusal that outlived its rounds included — still ends
    // the run.
    if (!isTurnDeadline(error) && !isTurnStall(error)) throw error
    return { totals: null, dropped: [], repairs: paid.repairs, stopped: error }
  }
}

/**
 * One repair turn, under the handler's own system prompt and envelope.
 *
 * Reused rather than re-minted for the reason every prompt in this phase reuses them:
 * the nonce in the system prompt has to be the one closing the delimiter around the
 * check output, and a second mint would hand the model an id its other prompts do not
 * carry. The session is the same one that wrote the tree, so the turn arrives with the
 * work it is being asked to fix already in its context.
 */
const repairCommit = async (walk: StepCommitInput, rejection: CommitRejection, round: number): Promise<void> => {
  const agent = await walk.input.deps.agent()
  await agent.prompt({
    system: walk.system,
    prompt: buildCommitRepairPrompt(walk.envelope, rejection, round),
    agent: 'build',
  })
}

/**
 * The commit message one step earns.
 *
 * A plan with no steps keeps the message the phase has always written, character for
 * character: that path is the fallback, and a fallback that changes what it writes is
 * a fallback in name only. A step names itself, so `git log --oneline` on the branch
 * reads as the plan a maintainer approved.
 */
const stepMessage = (issueNumber: number, marker: StepMarker | null): string => {
  const subject =
    marker === null
      ? `feat(agent): implement issue #${issueNumber}`
      : `feat(agent): implement issue #${issueNumber} — step ${marker.number}/${marker.total}: ` +
        stepSubject(marker.title)

  return `${subject}\n\nRefs #${issueNumber}`
}
