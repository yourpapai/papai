// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { promptForJson } from '../ask-json.js'
import { renderFollowUpDecline, renderFollowUpFailure, renderFollowUpOverBudget } from '../follow-up-notices.js'
import {
  appliedSchema,
  applyRequest,
  assessmentContext,
  assessmentRequest,
  verdictSchema,
} from '../follow-up-prompts.js'
import { branchNameFor } from '../git.js'
import type { MachineInput } from '../phase-context.js'
import { postAnswer } from '../run-post.js'
import type { RunResult } from '../run-result.js'
import { totalTokens, withinBudget } from '../token-budget.js'
import { errorMessage } from '../types.js'
import { mintEnvelope } from './envelope.js'
import { applyAndPush } from './follow-up-commit.js'
import type { FollowUpEnd } from './follow-up-commit.js'

/**
 * The `/follow-up` side operation: apply a maintainer's small, requested change
 * to a delivered pull request as follow-up commits on the same branch.
 *
 * The `sync.ts` precedent — a handler that is not a phase, run by
 * `driveMachine` ahead of both budget stops because it owns its own ceilings.
 * The non-moving contract is the same: phase, `resumeFrom`, `attempts` and
 * every per-PR budget leave exactly as they arrived in every outcome, and the
 * only thing that ever changes on the thread is the running token total a turn
 * paid, rewritten in place through `state-persist.ts` inside `postAnswer`'s
 * one plain comment.
 *
 * What `/follow-up` adds to the `/sync` shape is a **size gate before any
 * write** (design D4): one read-only `plan`-profile turn reads the enveloped
 * request beside the change folder's digest and the branch's diff stat, and
 * answers a zod verdict `{size, reason}` — small applies, too-big declines
 * with a ready-to-paste issue draft and zero git writes. The reason is
 * mandatory and is restated to the maintainer on **both** paths, so a
 * subjective judgment never reads as a coin flip. A small verdict starts one
 * `build`-profile apply turn under pinned instructions, and everything after
 * it belongs to the pipeline alone — the checks, the commit under repair, the
 * reconcile-merge and the push — which is `follow-up-commit.ts`'s half, split
 * along the `implement-commit.ts` seam; what both turns say lives in
 * `follow-up-prompts.ts`, along the `implement-prompts.ts` seam.
 */

export const runFollowUp = async (input: MachineInput): Promise<RunResult> => {
  const { state, deps } = input
  const branch = branchNameFor(state.issueId)
  const base = await deps.baseBranch()
  const request = input.command?.argument ?? ''
  deps.log.info({ issue: state.issueId, branch, base, phase: state.phase }, 'Running the /follow-up side operation')

  try {
    // The standard drift guard — deliberately no `allowDependencyDrift`. A
    // drifted branch is the `/sync` remedy's condition, not this command's: a
    // follow-up would run every check against an install state that cannot
    // serve it, and the refusal names the command that actually repairs it.
    await deps.git.ensureBranch(branch, base)
    const end = await followUpEnd(input, branch, base, request)
    return await finish(input, end)
  } catch (error) {
    const message = errorMessage(error)
    deps.log.error({ issue: state.issueId, branch, base, error: message }, 'The /follow-up side operation failed')
    return finish(input, {
      status: 'failed',
      reason: message,
      comment: renderFollowUpFailure(state.phase, branch, message),
    })
  }
}

const followUpEnd = async (
  input: MachineInput,
  branch: string,
  base: string,
  request: string,
): Promise<FollowUpEnd> => {
  const { state, deps } = input

  // The ceiling is asked before the gate's turn, the `applyIntent` rule: never
  // pay a turn to learn what a refusal would say. Over budget, the notice is
  // the whole answer.
  const spent = await totalTokens(deps, input.carriedTokens)
  if (!withinBudget(spent, deps.config)) {
    deps.log.warn({ issue: state.issueId, spent }, 'No follow-up gate turn: at the token ceiling')
    return {
      status: 'failed',
      reason: `Token budget spent (${spent} of ${deps.config.maxTokens} tokens for this issue)`,
      comment: renderFollowUpOverBudget(spent, deps.config.maxTokens, branch, state.prUrl),
    }
  }

  const envelope = mintEnvelope()
  const agent = await deps.agent()
  const context = await assessmentContext(input, base)

  const verdict = await promptForJson({
    agent,
    envelope,
    log: deps.log,
    schema: verdictSchema,
    request: assessmentRequest(state.phase, deps.config.repoRoot, envelope, request, context),
  })
  deps.log.info({ issue: state.issueId, size: verdict.size }, 'The follow-up size gate answered')

  if (verdict.size === 'too-big') {
    return declinedEnd(verdict.reason, state.prUrl)
  }

  const applied = await promptForJson({
    agent,
    envelope,
    log: deps.log,
    schema: appliedSchema,
    request: applyRequest(state.phase, deps.config.repoRoot, envelope, request, context, verdict.reason),
  })

  return applyAndPush(input, branch, verdict.reason, applied, envelope, agent)
}

/** The gate said too big: a deliberate outcome, not a failure — nothing was written. */
const declinedEnd = (reason: string, prUrl: string | null): FollowUpEnd => ({
  status: 'completed',
  reason: `The follow-up was declined as too big: ${reason}`,
  comment: renderFollowUpDecline(reason, prUrl),
})

/**
 * The one exit every outcome takes, exactly as `/sync`'s: the reply is
 * `postAnswer`'s write — a plain comment on the trigger surface carrying no
 * state block — and the spend the run paid is folded into the state that write
 * persists in place.
 */
const finish = async (input: MachineInput, end: FollowUpEnd): Promise<RunResult> => {
  const spent = await totalTokens(input.deps, input.carriedTokens)
  const carried = { ...input.state, tokensSpent: spent }
  await postAnswer(input.thread, input, end.comment, carried)

  return { status: end.status, reason: end.reason, state: carried, reported: true }
}
