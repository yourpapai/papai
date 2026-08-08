// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { phaseName } from './phase-names.js'
import type { Phase } from './phase-names.js'

/**
 * What one run of this pipeline hands the next, and the vocabulary it is written in.
 *
 * The phase **names** live next door in `phase-names.ts` — they were split out when
 * this file and their migration would no longer fit together — and are re-exported
 * here so every caller keeps naming one module for the machine's vocabulary, the same
 * reason `git.ts` re-exports `Salvage`. What is left in this file is the shape: which
 * signals a handler may report, and field by field what survives between two jobs.
 */
export type { Phase } from './phase-names.js'
export { LEGACY_PHASE_NAMES, PHASES, WAITING_PHASES } from './phase-names.js'

/**
 * Outcomes a phase handler reports back to the state machine. The machine — not
 * the handler — decides which phase follows, so handlers stay dumb about order.
 *
 * Three are reported by nothing in `phases/`: `RETRY` and `CONTINUE` are typed by a
 * human and injected by the trigger layer, and `OUT_OF_TIME` comes from the
 * cascade's own wall-clock stop before any handler runs.
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
  'REVIEW_REQUESTED',
  'REVIEW_DONE',
  'CANCELLED',
  'FAILED',
  'RETRY',
  'OUT_OF_TIME',
  'CONTINUE',
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
   * Review-loop rounds `/review` has spent on the delivered pull request.
   *
   * Per pull request, not per issue, and reset exactly where `ciAttempts` is —
   * `handleDeliver`'s `existing === null` branch, a genuinely new pull request.
   * It is also the *only* bound on `/review`: the loop's `opencode run`
   * subprocesses are invisible to `AGENT_MAX_TOKENS`, so without this the one
   * command in the pipeline that spawns a fleet of them is bounded by nothing
   * but the job timeout.
   */
  reviewAttempts: z.number().int().min(0).default(0),
  /**
   * Lines the implementation commit changed, as the diff guard measured them.
   *
   * The pipeline already held this figure and threw it away: `guardStaged` folds
   * `git diff --cached --numstat` between `git add --all` and the commit, so the
   * one fact that says whether a diff is worth reviewing was computed, used to
   * refuse a runaway commit, and discarded. `/review` being explicit only helps
   * a maintainer who knows when to reach for it, and this is what the delivery
   * comment sizes that recommendation against.
   *
   * The **raw count**, never a `shouldReview` boolean. A flag decided at commit
   * time and frozen into the block could only ever disagree with
   * `reviewHintLines` as the config carries it when the comment is read — the
   * same argument that keeps `approved` out of this schema, where the phase
   * already is the approval gate. It is also the more honest thing to print: a
   * recommendation that states its own figure can be judged rather than trusted.
   *
   * Written by the implementation phase and by nothing else. The review phase's
   * own commits deliberately do not update it: what this sizes is the diff one
   * model turn wrote with nothing having read it, and a `/review` that has since
   * run is the very thing being recommended.
   *
   * Needs no `STATE_VERSION` bump — it defaults, so a block written before it
   * existed still parses, and 0 is below every threshold `LINES_RANGE` allows,
   * which reads as "a small diff" rather than as "one nobody measured".
   */
  changedLines: z.number().int().min(0).default(0),
  /**
   * Steps of the **current plan** already finished, and therefore where the next
   * implementation run starts.
   *
   * The implementation is one model turn per plan step, committed and pushed between
   * them, so a wall-clock stop that lands between two steps costs the run nothing at
   * all — but only if the next job knows which step is next. Without this the
   * `/continue` the stop invites would re-implement the steps already on the branch,
   * paying for them a second time and asking the model to redo work it can see is
   * done.
   *
   * A count rather than an index, so `0` is both the default and the truthful reading
   * of a block written before this field existed: start at the first step. It counts
   * into the plan the state block's `planRevision` names, so `handlePlan` resets it
   * whenever it posts a plan — a cursor carried across a `/changes` would skip work
   * nobody has done, which is the same argument that retires the handoff note on a
   * plan revision. It is reset on a finished implementation too, so a re-entry walks
   * the plan rather than resuming past its end.
   *
   * Written by `REVIEW_AND_MUTATE` and by `PLANNING`, and only ever *forward* within
   * one plan. Note the one thing it deliberately does not survive: a run whose step
   * **threw** posts no outcome patch, so a `/retry` after a crash mid-plan walks the
   * plan from the cursor the last *stop* recorded rather than from the crash. The
   * steps it repeats are already committed, so it costs turns rather than
   * correctness.
   *
   * Needs no `STATE_VERSION` bump — it defaults, exactly as `changedLines`,
   * `tokensSpent` and the two revision counters do, and a bump strands every issue in
   * flight. That does make a rollback **one-way** in the same narrow sense
   * `INCOMPLETE` does: older code drops the key as unknown, so a continuation that
   * was mid-plan starts the plan again rather than resuming it.
   */
  stepsDone: z.number().int().min(0).default(0),
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
