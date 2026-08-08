// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { locateLatestBlock, readBlock, renderBlock } from './blocks.js'
import type { IssueComment } from './blocks.js'
import { agentStateSchema, InvalidTransitionError, STATE_VERSION } from './types.js'
import type { AgentState, Phase, TransitionSignal } from './types.js'

export type { IssueComment } from './blocks.js'

/** Marker opening every persisted state block. Also the grep handle for humans. */
export const STATE_MARKER = 'AGENT_STATE'

/**
 * Where each signal leads. Signals absent from a phase's row are rejected, so a
 * command arriving in the wrong phase is a loud no-op rather than a silent
 * corruption of the persisted state.
 *
 * `ANSWERED` is deliberately not in this table at all — see {@link transition}.
 * Every entry here names a phase the machine *moves to*; a signal that leaves
 * the phase alone has no business being expressed as a row per phase.
 *
 * `CI_FAILED` appears in exactly two rows, and the four absences are the
 * decision rather than an oversight. A red run is worth acting on only where
 * the branch is already pushed *and* no job of this pipeline is working it:
 * `COMPLETE` is the ordinary case, and `PR_DELIVERY` is the genuine race.
 * Phase 3 pushes the branch and posts a state block naming `PR_DELIVERY`
 * before phase 4 opens the pull request, and a delivery that dies after the
 * pull request exists leaves exactly that block behind — so the branch is live,
 * the checks are red, and the row that used to be missing had `applyCiTrigger`
 * refuse the run, post nothing and spend nothing. Silence is the failure mode
 * the whole CI path is built around, so it was the wrong row to leave out.
 *
 * The four phases before the branch exists — `INIT_OR_CLARIFY`, `DESIGN_SPEC`,
 * `PLANNING`, `PLAN_REVIEW` — have nothing pushed to repair, and
 * `handleCiFix` would happily run the configured checks against a branch cut
 * fresh from the base and commit the base's own failures onto the issue.
 *
 * `REVIEW_AND_MUTATE` and `CI_FIX` are out because the machine never persists
 * them: a state block is written only when a handler posts, and both of those
 * handlers post the phase they moved *to* (`PR_DELIVERY`, `COMPLETE`). A red
 * run appearing to find one is reading a hand-edited block, and honouring it
 * would put a second agent job on a branch another job is mid-commit on. The
 * workflow's concurrency group (`opencode-agent-<branch>`,
 * `cancel-in-progress: false`) does queue those two runs rather than overlap
 * them — but it keys a CI run off `workflow_run.head_branch` and an issue run
 * off `agent/issue-<n>`, so it holds only while those two strings agree, which
 * is a narrow coincidence to hang a push race on rather than a proof.
 *
 * `FAILED` is deliberately absent and is the close call, because there the
 * branch *is* pushed, a pull request may well be open, and its checks do go red
 * with nobody acting. It stays out because `FAILED`'s entire content is a
 * recorded pipeline failure plus the `resumeFrom` that undoes it, and
 * `CI_FAILED` is a forward move: it would reset `attempts`, and it would leave
 * `FAILED` for a phase where `/retry` is refused — `resumeFrom` survives the
 * move but nothing can ever act on it again — so a fix that went green would
 * land the issue in `COMPLETE`, announcing success for a pipeline that never
 * finished delivering. Nor is this the silence the `PR_DELIVERY` row is about:
 * a failed run has already posted "this failed, reply `/retry`", and that
 * `/retry` resumes the phase that broke, delivers, and reaches `COMPLETE`,
 * where the next red run is picked up as usual. The red checks are deferred
 * behind a maintainer, not abandoned.
 *
 * `REVIEW_REQUESTED` names exactly one row, and its absences are the same audit
 * with one answer changed. The four phases before the branch exists have nothing
 * to review; `REVIEW_AND_MUTATE`, `CODE_REVIEW` and `CI_FIX` are never
 * persisted, so a `/review` appearing to find one is reading a hand-edited block
 * and honouring it would put a second job on a branch another is mid-commit on;
 * and `FAILED` is parked under a comment asking for `/retry`, where reviewing a
 * delivery that did not finish reviews a branch nobody has claimed is complete.
 *
 * `PR_DELIVERY` is the one that differs from `CI_FAILED`, deliberately. That row
 * exists because a refused red run is **silent** — nothing posted, nothing
 * spent, and a maintainer with no way to learn the run was dropped. A refused
 * `/review` answers on the issue through `refuseCommand`, naming what the phase
 * does accept, so there is no silence to fix; and in `PR_DELIVERY` the pull
 * request may not exist yet, which is precisely what the review reports against.
 */
const TRANSITIONS: Record<Phase, Partial<Record<TransitionSignal, Phase>>> = {
  INIT_OR_CLARIFY: { NEEDS_CLARIFICATION: 'INIT_OR_CLARIFY', SPEC_POSTED: 'DESIGN_SPEC' },
  DESIGN_SPEC: { CHANGES_REQUESTED: 'INIT_OR_CLARIFY', APPROVED: 'PLANNING' },
  PLANNING: { PLAN_POSTED: 'PLAN_REVIEW' },
  PLAN_REVIEW: { CHANGES_REQUESTED: 'PLANNING', APPROVED: 'REVIEW_AND_MUTATE' },
  REVIEW_AND_MUTATE: { CHANGES_COMMITTED: 'PR_DELIVERY' },
  PR_DELIVERY: { PR_OPENED: 'COMPLETE', CI_FAILED: 'CI_FIX' },
  CODE_REVIEW: { REVIEW_DONE: 'COMPLETE' },
  CI_FIX: { CI_FIXED: 'COMPLETE' },
  COMPLETE: { CI_FAILED: 'CI_FIX', REVIEW_REQUESTED: 'CODE_REVIEW' },
  FAILED: {},
}

/** Fresh state for an issue the agent has not seen before. */
export const initialState = (issueId: number): AgentState =>
  agentStateSchema.parse({ v: STATE_VERSION, phase: 'INIT_OR_CLARIFY', issueId })

/** Renders the hidden block that carries state across ephemeral CI jobs. */
export const serializeState = (state: AgentState): string => renderBlock(STATE_MARKER, state)

/** Appends the hidden state block to a human-readable comment body. */
export const renderStateComment = (body: string, state: AgentState): string =>
  `${body.trimEnd()}\n\n${serializeState(state)}`

const toState = (candidate: unknown): AgentState | null => {
  if (candidate === undefined) return null
  const result = agentStateSchema.safeParse(candidate)
  return result.success ? result.data : null
}

/** Reads the state block out of a single comment body; `null` when absent or invalid. */
export const extractState = (commentBody: string): AgentState | null => toState(readBlock(commentBody, STATE_MARKER))

/**
 * Restores state from an issue thread: the newest comment authored by the agent
 * that carries a schema-valid state block **for this issue**.
 *
 * Two rejections, and the scan genuinely keeps walking back through both — it
 * used to take the newest readable block and validate afterwards, so a single
 * corrupt one reset a conversation that had a perfectly good block behind it.
 *
 * The `issueId` check is the security half. Anyone who can edit the agent's
 * comments can edit this block, and `issueId` is the field the rest of the
 * pipeline treats as authoritative: it names the branch through
 * `branchNameFor`, the commit trailers, and the `Closes #n` the pull request
 * carries. The event already knows which issue this is, so a block claiming a
 * different one is discarded rather than believed.
 *
 * A block from an older, incompatible `STATE_VERSION` is rejected the same way,
 * which does mean a breaking bump strands in-flight issues; see the migration
 * note in the README before bumping.
 */
export const findLatestState = (
  comments: readonly IssueComment[],
  agentLogin: string,
  issueId: number,
): AgentState | null => {
  const found = findLatestStateComment(comments, agentLogin, issueId)
  return found === null ? null : found.state
}

/** The restored state, together with the comment it was restored from. */
export interface StateComment {
  comment: IssueComment
  state: AgentState
}

/**
 * The same scan as {@link findLatestState}, keeping the comment it selected.
 *
 * `state-persist.ts` rewrites that comment's block in place instead of posting a
 * new one. Both functions come off one scan on purpose: the target of a rewrite
 * has to be the comment the *reader* will look at next, and two independent
 * scans agreeing is a coincidence rather than a property.
 */
export const findLatestStateComment = (
  comments: readonly IssueComment[],
  agentLogin: string,
  issueId: number,
): StateComment | null => {
  const found = locateLatestBlock(comments, agentLogin, STATE_MARKER, ownedBy(issueId))
  if (found === null) return null

  const state = toState(found.block)
  // `ownedBy` already parsed it, so this cannot be null; narrowing rather than
  // asserting keeps that true if the acceptance predicate ever loosens.
  return state === null ? null : { comment: found.comment, state }
}

const ownedBy =
  (issueId: number) =>
  (candidate: unknown): boolean => {
    const parsed = agentStateSchema.safeParse(candidate)
    return parsed.success && parsed.data.issueId === issueId
  }

/** Whether `signal` is accepted in `phase`. */
export const canTransition = (phase: Phase, signal: TransitionSignal): boolean => {
  if (signal === 'ANSWERED') return true
  if (signal === 'FAILED' || signal === 'CANCELLED') return phase !== 'COMPLETE'
  if (signal === 'RETRY') return phase === 'FAILED'
  return TRANSITIONS[phase][signal] !== undefined
}

const failTransition = (state: AgentState, patch: Partial<AgentState>): Partial<AgentState> => ({
  phase: 'FAILED',
  resumeFrom: state.phase === 'FAILED' ? state.resumeFrom : state.phase,
  attempts: state.attempts + 1,
  ...patch,
})

/**
 * The artefact counter this move bumps, if it rewrites an artefact at all.
 *
 * Spec and plan are counted apart because the heading each handler renders reads
 * as "the Nth version of *this* artefact" and cannot be read as anything else.
 * One counter serving both had them interleave, so the first plan on
 * every issue announced itself as revision 2 — and revision 3 if the spec had
 * been revised once first.
 *
 * A branch per signal rather than a lookup table with a computed key: the two
 * artefacts are the whole list, and naming the fields keeps a mistyped one a
 * compile error rather than a counter that silently never moves.
 */
const revisionBump = (state: AgentState, signal: TransitionSignal): Partial<AgentState> => {
  if (signal === 'SPEC_POSTED') return { specRevision: state.specRevision + 1 }
  if (signal === 'PLAN_POSTED') return { planRevision: state.planRevision + 1 }
  return {}
}

const forwardTransition = (
  state: AgentState,
  signal: TransitionSignal,
  next: Phase,
  patch: Partial<AgentState>,
): Partial<AgentState> => ({
  phase: next,
  // Every forward move clears the failure budget, because `attempts` counts
  // *consecutive* failures. An allow-list of "real progress" signals looked
  // equivalent and was not: asking a clarifying question and answering a
  // question are handler successes, so a conversation with the odd hiccup
  // accumulated toward the cap across runs that all succeeded. `RETRY` is the
  // deliberate exception and preserves the count in its own branch, so a retry
  // loop stays bounded, and `ANSWERED` clears it from its own branch below for
  // exactly the same reason.
  attempts: 0,
  ...revisionBump(state, signal),
  ciAttempts: signal === 'CI_FAILED' ? state.ciAttempts + 1 : state.ciAttempts,
  reviewAttempts: signal === 'REVIEW_REQUESTED' ? state.reviewAttempts + 1 : state.reviewAttempts,
  lastError: null,
  ...patch,
})

/**
 * Applies a handler signal to the state, returning a new state object. Throws
 * `InvalidTransitionError` on an illegal move so a bug surfaces loudly in the
 * job log instead of silently corrupting the persisted phase.
 */
export const transition = (
  state: AgentState,
  signal: TransitionSignal,
  patch: Partial<AgentState> = {},
): AgentState => {
  if (!canTransition(state.phase, signal)) throw new InvalidTransitionError(state.phase, signal)

  // Answering is phase-neutral: it is accepted everywhere and moves nothing.
  //
  // It used to be three self-referencing rows in TRANSITIONS — INIT_OR_CLARIFY,
  // DESIGN_SPEC, PLAN_REVIEW — while `/ask` was accepted in every phase, so the
  // two disagreed and the disagreement was fatal: a question asked in COMPLETE,
  // FAILED, REVIEW_AND_MUTATE, PR_DELIVERY or CI_FIX paid for the model turn and
  // then threw `InvalidTransitionError` out of the pipeline, which the runner
  // printed as a stack trace while the issue heard nothing at all. FAILED was
  // the worst of them, being exactly the state a maintainer asks "why did this
  // fail?" in.
  //
  // Handled here rather than by adding a row to every phase because two sources
  // of truth for "stay put" is what let the table and `/ask`'s reach drift apart
  // in the first place. The patch reproduces what the old rows did: `attempts`
  // cleared, because answering is a handler success; the artefact revisions and
  // `ciAttempts` untouched, because neither the spec nor the plan was rewritten
  // and no CI round was spent.
  if (signal === 'ANSWERED') return applyPatch(state, { attempts: 0, lastError: null, ...patch })

  if (signal === 'FAILED') return applyPatch(state, failTransition(state, patch))
  if (signal === 'CANCELLED') return applyPatch(state, { phase: 'COMPLETE', resumeFrom: null, ...patch })
  if (signal === 'RETRY') {
    return applyPatch(state, {
      phase: state.resumeFrom ?? 'INIT_OR_CLARIFY',
      resumeFrom: null,
      lastError: null,
      ...patch,
    })
  }

  const next = TRANSITIONS[state.phase][signal]
  if (next === undefined) throw new InvalidTransitionError(state.phase, signal)
  return applyPatch(state, forwardTransition(state, signal, next, patch))
}

/**
 * Records that the CI-fix give-up notice has been delivered.
 *
 * Not a transition: the phase does not move, the agent has simply stopped
 * acting on this pull request's red checks.
 */
export const markCiBudgetReported = (state: AgentState): AgentState => applyPatch(state, { ciBudgetReported: true })

const applyPatch = (state: AgentState, patch: Partial<AgentState>): AgentState =>
  agentStateSchema.parse({ ...state, ...patch, v: STATE_VERSION })
