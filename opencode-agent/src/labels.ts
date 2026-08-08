// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PipelineConfig } from './config.js'
import type { LabelApi } from './github-labels.js'
import type { Logger } from './logger.js'
import { NEEDS_YOU_LABEL, presentationFor, WORKING_LABEL } from './presentation.js'
import type { LabelSpec, RunStance, WhoseTurn } from './presentation.js'
import type { RunResult } from './run-result.js'
import { mapSeries } from './sequence.js'
import { errorMessage } from './types.js'
import type { AgentState } from './types.js'

/**
 * The label channel — what the issue says about itself from a list view.
 *
 * The phase lives in an HTML comment, so answering "which of my twelve agent
 * issues are waiting on me" means opening each one and reading the last
 * comment's prose. A label is the only surface an issue list, a project board
 * and a notification all carry.
 *
 * Two rules shape everything here.
 *
 * **Feedback must never fail a run.** Every write in this module is decoration
 * on work that matters, and each one is a new way to break a pipeline that used
 * to work — a token without `issues: write`, a fork run, an organisation that
 * restricts who may create a label. So {@link reconcileLabels} is the single
 * door to the label API and it swallows everything, the way `feedback.ts` does
 * for reactions: a rejection degrades to a `warn` and the caller reaches the
 * same `RunResult` and the same persisted state it would have reached with no
 * label channel at all. That is a property of one function, not a convention
 * observed at each call site.
 *
 * **A diff, never a clear-and-reapply.** Removing every agent label and adding
 * the current set back is one line shorter and wrong twice: it writes two
 * timeline entries per phase for a state that usually did not change, and the
 * issue visibly flickers through "no state" in between. So the desired set is
 * computed and the difference issued — which, for a run that moved nothing,
 * means no write at all.
 *
 * Reconciling is deliberately *not* reporting. `RunResult.reported` means the
 * issue carries this run's account of what happened, and the workflow's fallback
 * comment is gated on it; a label is not an account of anything.
 */

export interface LabelDeps {
  /**
   * Narrower than `PhaseDeps` on purpose, the way `ReactionDeps` is: this module
   * touches four endpoints, and a structural type lets a test drive it without
   * standing up the rest of the GitHub surface to reach them.
   */
  github: LabelApi
  log: Logger
  /** Only the prefix is read, so a caller need not assemble a whole config. */
  config: Pick<PipelineConfig, 'labelPrefix'>
}

/**
 * A label as GitHub knows it: the prefix already applied.
 *
 * A type of its own rather than a {@link LabelSpec} whose `suffix` has quietly
 * become a whole name — the two are compared against what the issue carries, and
 * one field meaning both things is how a prefix ends up applied twice or not at
 * all.
 */
export interface QualifiedLabel {
  name: string
  color: string
}

/** The markers a stance implies, on top of the phase's own label. */
const markersFor = (stance: RunStance, whoseTurn: WhoseTurn): readonly LabelSpec[] => {
  // Mutually exclusive by construction, and that is the point: while the agent
  // holds the issue it is not waiting on anybody, so a run in flight must not
  // also show up in the "blocked on me" filter it is busy clearing.
  if (stance === 'working') return [WORKING_LABEL]
  return whoseTurn === 'you' ? [NEEDS_YOU_LABEL] : []
}

/**
 * Every label this state implies, fully qualified. Pure — nothing here talks to
 * GitHub, so the interesting half of the reconcile is testable as a value.
 */
export const desiredLabels = (state: AgentState, stance: RunStance, prefix: string): readonly QualifiedLabel[] => {
  const presentation = presentationFor(state, stance)

  return [presentation.label, ...markersFor(stance, presentation.whoseTurn)].map((spec) => ({
    name: `${prefix}${spec.suffix}`,
    color: spec.color,
  }))
}

/**
 * Brings the issue's labels in line with the state, best-effort.
 *
 * Also a repair, which is the half that is easy to leave out. Any `agent:*`
 * label the state does not imply is removed, so an issue whose labels were
 * edited by hand and a run whose runner was killed mid-flight — leaving
 * `agent:working` stranded on an issue nothing is working — both heal on the
 * next event rather than needing anybody to notice.
 *
 * Labels outside the prefix are never touched, in either direction. They are the
 * repository's own, this pipeline did not put them there, and removing one is
 * the worst thing this module could do.
 */
export const reconcileLabels = async (deps: LabelDeps, state: AgentState, stance: RunStance): Promise<void> => {
  const prefix = deps.config.labelPrefix
  if (prefix === null) return

  try {
    await applyDiff(deps, prefix, state, stance)
  } catch (error) {
    // Everything, and that includes a bug in this module: a `TypeError` from
    // `applyDiff` degrades to exactly the same `warn` as a 403, so a broken
    // reconcile is invisible unless somebody reads the log. That is the accepted
    // cost of the rule rather than an oversight — a channel that re-throws on
    // some classes of error is not best-effort any more, and deciding which is
    // which *here*, on an `unknown`, is how that gets fragile. It is worth
    // knowing how it will be found: this exact case appeared while writing the
    // stage's tests, when a stubbed transport answered the label read with the
    // wrong shape and `name.startsWith` threw into this catch, leaving a green
    // suite that had never reconciled a thing.
    deps.log.warn(
      { issue: state.issueId, phase: state.phase, stance, error: errorMessage(error) },
      'Could not reconcile the issue labels',
    )
  }
}

/**
 * The end-of-run reconcile, as a pass-through.
 *
 * Here rather than at each of the orchestrator's exits so that "the run is over,
 * whatever the outcome" is stated once: `agent:working` comes off a failed run,
 * a refused command and a delivered pull request alike. `fallback` covers the
 * skips that carry no state of their own — reconciling the restored one is still
 * the repair, and is what takes a stranded marker off an issue whose only event
 * this hour was somebody typing "thanks".
 */
export const settleLabels = async (deps: LabelDeps, result: RunResult, fallback: AgentState): Promise<RunResult> => {
  await reconcileLabels(deps, result.state ?? fallback, 'waiting')
  return result
}

const applyDiff = async (deps: LabelDeps, prefix: string, state: AgentState, stance: RunStance): Promise<void> => {
  const current = await deps.github.listLabels(state.issueId)
  const desired = desiredLabels(state, stance, prefix)

  const missing = desired.filter((label) => !current.includes(label.name))
  const stale = current.filter((name) => name.startsWith(prefix) && !desired.some((label) => label.name === name))
  if (missing.length === 0 && stale.length === 0) return

  await addLabels(deps, state.issueId, missing)
  // One at a time: there is no bulk delete, and the repo forbids awaiting in a
  // loop body.
  await mapSeries(stale, (name) => deps.github.removeLabel(state.issueId, name))

  deps.log.debug(
    { issue: state.issueId, added: missing.map((label) => label.name), removed: stale },
    'Reconciled the issue labels',
  )
}

/**
 * Adds labels, creating any the repository does not have yet.
 *
 * Created explicitly rather than left to the add call, because that is the only
 * way the palette is applied: a label GitHub invents on an issue gets a random
 * colour, and a colour per meaning — blue while the agent works, amber while it
 * waits on you, red for a failure — is most of what makes a list view readable
 * at a glance.
 */
const addLabels = async (deps: LabelDeps, issueNumber: number, missing: readonly QualifiedLabel[]): Promise<void> => {
  if (missing.length === 0) return

  await mapSeries(missing, (label) => deps.github.createLabel(label.name, label.color))
  await deps.github.addLabels(
    issueNumber,
    missing.map((label) => label.name),
  )
}
