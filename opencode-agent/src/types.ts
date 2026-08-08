// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * Phases of the issue-driven agent state machine.
 *
 * `DESIGN_SPEC` and `PLAN_REVIEW` are deliberate stops: each artefact the agent
 * produces is parked in front of a human who can question it, refine it, or
 * approve it before the pipeline spends anything on the next step.
 *
 * `CI_FIX` is entered from outside the issue conversation — a red check run on
 * the agent's own pull request — and returns to `COMPLETE` once the branch is
 * green again.
 */
export const PHASES = [
  'INIT_OR_CLARIFY',
  'DESIGN_SPEC',
  'PLANNING',
  'PLAN_REVIEW',
  'REVIEW_AND_MUTATE',
  'PR_DELIVERY',
  'CI_FIX',
  'COMPLETE',
  'FAILED',
] as const

export type Phase = (typeof PHASES)[number]

/**
 * Phase names this pipeline has retired, mapped onto the ones that replaced them.
 *
 * `PLANNING` was `EXECUTION_PLAN`, and "execution plan" was the wrong name for
 * the artefact: what the phase produces is the implementation plan the rest of
 * the repository already calls a plan (`docs/superpowers/plans/`, `AGENT_PLAN`,
 * `/approve to implement this plan`), and only this one phase, its status row and
 * its heading called it something else.
 *
 * A rename is a persisted-shape change, because a phase name is written into
 * every `AGENT_STATE` block as `phase` and `resumeFrom`. It is deliberately
 * **not** a `STATE_VERSION` bump: a bump strands every in-flight issue, and there
 * is nothing here a bump would protect against — the old name maps onto the new
 * one exactly, with no field to reinterpret. So the schema migrates it on the way
 * in ({@link phaseName}) and every block written afterwards carries the new name.
 *
 * Read through `Object.hasOwn`, never `in`: `'toString' in LEGACY_PHASE_NAMES` is
 * true through the prototype, and a state block is attacker-editable text.
 */
export const LEGACY_PHASE_NAMES: Readonly<Record<string, Phase>> = { EXECUTION_PLAN: 'PLANNING' }

/**
 * A phase name as it may appear in a block on the issue, migrated to the name
 * the machine uses now.
 *
 * On the schema rather than at the restore call sites, because there are four
 * parse sites (`extractState`, `ownedBy`, `initialState`, `applyPatch`) and three
 * of them are on the read path; a migration honoured at two of those is a state
 * block that restores under one scan and is discarded by the other.
 */
const phaseName = z.preprocess(
  (value) =>
    typeof value === 'string' && Object.hasOwn(LEGACY_PHASE_NAMES, value) ? LEGACY_PHASE_NAMES[value] : value,
  z.enum(PHASES),
)

/** Phases that wait on a human and run no handler of their own. */
export const WAITING_PHASES: ReadonlySet<Phase> = new Set<Phase>(['DESIGN_SPEC', 'PLAN_REVIEW'])

/**
 * Outcomes a phase handler reports back to the state machine. The machine — not
 * the handler — decides which phase follows, so handlers stay dumb about order.
 */
export const TRANSITION_SIGNALS = [
  'NEEDS_CLARIFICATION',
  'SPEC_POSTED',
  'CHANGES_REQUESTED',
  'ANSWERED',
  'APPROVED',
  'PLAN_POSTED',
  'CHANGES_COMMITTED',
  'PR_OPENED',
  'CI_FAILED',
  'CI_FIXED',
  'CANCELLED',
  'FAILED',
  'RETRY',
] as const

export type TransitionSignal = (typeof TRANSITION_SIGNALS)[number]

/** Bumped when the persisted shape changes in a way old blocks cannot satisfy. */
export const STATE_VERSION = 2

/**
 * The durable state carried between ephemeral CI jobs. Serialized verbatim into
 * a hidden `<!-- AGENT_STATE: ... -->` block on the agent's own issue comment;
 * every field must survive a JSON round trip.
 *
 * Bulky artefacts (spec, plan, report) deliberately live in their own blocks
 * rather than here — this object is rewritten on every comment, and duplicating
 * a multi-kilobyte spec each time would bloat the thread.
 */
export const agentStateSchema = z.object({
  /** Absent on v1 blocks written before versioning; those are treated as v1. */
  v: z.number().int().min(1).default(1),
  phase: phaseName,
  issueId: z.number().int().positive(),
  // No `branch`: it is exactly `agent/issue-<issueId>`, every phase recomputes
  // it with `branchNameFor`, and persisting a derivable value only adds a field
  // that anyone able to edit the agent's comments could point somewhere else.
  /** Phase to resume from when a FAILED run is retried. */
  resumeFrom: phaseName.nullable().default(null),
  /** Consecutive failures. Cleared by any forward move; preserved across `/retry`. */
  attempts: z.number().int().min(0).default(0),
  /**
   * CI-fix rounds spent on the delivered pull request.
   *
   * Per pull request, not per issue: `handleDeliver` clears it — with
   * `ciBudgetReported` — when it opens a **new** one, and leaves both alone when
   * it refreshes the one already open. Nothing else resets it, so within a
   * single pull request the count only climbs, which is what bounds an agent and
   * CI bouncing off each other.
   */
  ciAttempts: z.number().int().min(0).default(0),
  /**
   * Whether the "I have stopped fixing CI" notice has been posted for the
   * current pull request. CI events arrive on every push and re-run, so without
   * this the notice repeats forever; cleared alongside `ciAttempts` when a new
   * pull request is opened, or the notice could never be said again for it.
   */
  ciBudgetReported: z.boolean().default(false),
  /**
   * Revisions of the design spec and of the plan, counted apart.
   *
   * One shared counter used to serve both, bumped on `SPEC_POSTED` and on
   * `PLAN_POSTED` alike while each handler rendered it into its own heading, so
   * the two numbers interleaved. On an issue that ran straight through, the
   * first spec a maintainer ever saw was "revision 1" and the first plan
   * "revision 2"; revise the spec once beforehand and that same first plan was
   * "revision 3". A revision number on a heading is read as "the Nth version of
   * this artefact" — there is nothing else it could mean — so neither figure
   * meant what it said.
   *
   * Both carry defaults, so a block written before the split still parses and
   * needs no `STATE_VERSION` bump, which would strand every in-flight issue (see
   * the README's migration note). The old `revision` key is dropped as an
   * unknown one, exactly as `approved` and `updatedAt` were. The price is that
   * an issue mid-conversation across the change restarts both counts at 1, and
   * that is the deliberate choice: the number it was carrying is a sum of two
   * artefacts' revisions and was never the count of either, so carrying it into
   * one of the new fields would preserve nothing but the wrong answer.
   */
  specRevision: z.number().int().min(0).default(0),
  planRevision: z.number().int().min(0).default(0),
  /**
   * Model tokens this issue has consumed, across every job it has run.
   *
   * Persisted because the runaway this bounds is not one job — it is an issue
   * bouncing through retries and CI-fix rounds, each of which starts a fresh
   * runner with no memory of what the last one spent.
   *
   * Tokens rather than currency. Token counts come from the provider's own
   * usage block and are always right; the cost figure OpenCode reports is
   * derived from its model catalogue and reads **0** for any model it does not
   * price — which, for a pipeline whose whole point is an arbitrary configured
   * model, is the ordinary case. Verified against a real server: a made-up model
   * id reported the correct token counts and a cost of zero. A ceiling that
   * silently never fires is worse than no ceiling, because it looks like one.
   *
   * Needs no `STATE_VERSION` bump: it has a default, so blocks written before it
   * existed still parse — the same reasoning that let `approved` and `updatedAt`
   * be removed.
   */
  tokensSpent: z.number().int().min(0).default(0),
  lastError: z.string().nullable().default(null),
  prUrl: z.url().nullable().default(null),
  prNumber: z.number().int().positive().nullable().default(null),
  // No `approved` and no `updatedAt`. The phase *is* the approval gate, so a
  // separate flag could only ever disagree with it, and the comment carrying
  // this block is already timestamped by GitHub. Both were written and never
  // read. Removing them needs no `STATE_VERSION` bump: zod strips unknown keys,
  // so a block written with them still parses.
})

export type AgentState = z.infer<typeof agentStateSchema>

/** Raised when a handler reports a signal the current phase cannot accept. */
export class InvalidTransitionError extends Error {
  readonly phase: Phase
  readonly signal: TransitionSignal

  constructor(phase: Phase, signal: TransitionSignal) {
    super(`Phase ${phase} cannot accept signal ${signal}`)
    this.name = 'InvalidTransitionError'
    this.phase = phase
    this.signal = signal
  }
}

/** Extracts a message from an unknown thrown value. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export type RunStatus = 'skipped' | 'waiting' | 'completed' | 'failed'

/** What one call to the pipeline concluded. `state` is null when nothing ran. */
export interface RunResult {
  status: RunStatus
  reason: string
  state: AgentState | null
  /**
   * Whether this run has already said what happened on the issue itself.
   *
   * Not diagnostic — the workflow reads it. Its last step posts an "Agent job
   * failed" comment under `if: failure()`, and `failure()` selects *every* red
   * job, including the six paths that exit 1 only after posting their own
   * report: `failRun`, `failAnswer`, both over-budget stops in
   * `token-budget.ts`, `refuseExhausted` and the CI-budget notice in
   * `triggers.ts`. So every genuine failure drew a second, contradicting
   * comment — "The issue state is unchanged" beside a block that had just been
   * moved to `FAILED` or parked with a resume point, and "reply `/retry`"
   * beside a notice that had just explained why `/retry` is refused. Only the
   * CI path escaped, by accident: `github.event.issue.number` is empty on a
   * `workflow_run` event. `runCli` turns this flag into a `$GITHUB_OUTPUT`
   * marker the fallback step is gated on, so it covers what its own wording
   * claims and nothing else: a job that died with nothing on the issue at all.
   *
   * A field rather than something derived from `status` and `state`, because
   * neither says it. `failed` covers both a reported failure and a crash;
   * `skipped` covers both a silent guardrail rejection and a refused command
   * that answered on the issue; and the state block rides on the same call that
   * posts, so "the state moved" and "a comment exists" are one event seen from
   * the side that cannot distinguish the paths that post from the ones that do
   * not. Required rather than optional so a new terminal path has to decide,
   * the way `SystemPromptInput.nonce` makes forgetting the envelope a type
   * error.
   */
  reported: boolean
}
