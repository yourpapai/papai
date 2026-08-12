// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * What a phase is **called** — including what it used to be called.
 *
 * Split from `types.ts` when the persisted state schema and this vocabulary would no
 * longer fit in one file, along a seam that file already had: everything here is
 * about a *name* and its history, where what is left there is about the shape one run
 * hands the next. The two change for different reasons, and this half is the one with
 * a migration in it — a phase name is written into every `AGENT_STATE` block, so
 * renaming one is a persisted-shape change and the rename lives beside the enum it
 * rewrites rather than a file away from it.
 *
 * `types.ts` re-exports all of it, so every caller keeps naming one module for the
 * machine's vocabulary; `phaseName` is the one export that stays here, because the
 * schema is its only reader.
 */

/**
 * Phases of the issue-driven agent state machine.
 *
 * `DESIGN_SPEC` and `PLAN_REVIEW` are deliberate stops: each artefact the agent
 * produces is parked in front of a human who can question it, refine it, or
 * approve it before the pipeline spends anything on the next step.
 *
 * `CI_FIX` is entered from outside the issue conversation — a red check run on
 * the agent's own pull request — and returns to `COMPLETE` once the branch is
 * green again. `CODE_REVIEW` is the other way back into a finished issue: it
 * runs the `review-loop/` workspace over the pushed branch on an explicit
 * `/review`, and returns to `COMPLETE` too.
 *
 * `INCOMPLETE` is where a **wall-clock** stop parks: no handler, `resumeFrom`
 * recorded, left by `/continue`. A waiting state and not a failure — nothing broke, a
 * bound was reached — which is why it is a phase rather than a second kind of park in
 * `FAILED`: telling those apart would need a field every reader of `FAILED` had to
 * consult, and `/retry` means "the thing that broke, again" where `/continue` means
 * "you were not finished".
 *
 * `REVIEW_AND_MUTATE` keeps its name although it no longer reviews anything —
 * it implements and pushes, and `IMPLEMENT` would be the honest name. `phase` is
 * read back out of hidden blocks on live issues, so *removing* a member
 * invalidates every conversation in flight, which buys clarity in one file at
 * the price of stranding the field. **Adding** one costs nothing for the same
 * reason: no block written before this change names `CODE_REVIEW`, and none names
 * `INCOMPLETE` either — so neither needed a `STATE_VERSION` bump. It does make a
 * rollback **one-way**, which is worth recording: older code parses `phase` through
 * a `z.enum(PHASES)` without `INCOMPLETE` in it and rejects a block naming that
 * phase outright, so the restore scan walks past it to an older comment — losing the
 * resume point a `/continue` needed — or starts the conversation over.
 */
export const PHASES = [
  'INIT_OR_CLARIFY',
  'DESIGN_SPEC',
  'PLANNING',
  'PLAN_REVIEW',
  'REVIEW_AND_MUTATE',
  'PR_DELIVERY',
  'CODE_REVIEW',
  'CI_FIX',
  'ARCHIVE',
  'COMPLETE',
  'FAILED',
  'INCOMPLETE',
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
export const phaseName = z.preprocess(
  (value) =>
    typeof value === 'string' && Object.hasOwn(LEGACY_PHASE_NAMES, value) ? LEGACY_PHASE_NAMES[value] : value,
  z.enum(PHASES),
)

/**
 * Phases that wait on a human and run no handler of their own.
 *
 * `CODE_REVIEW` is deliberately not one, although a human's `/review` is the
 * only way in: the command moves the phase and the handler runs in the same job,
 * exactly as `/approve` into `REVIEW_AND_MUTATE` does. A waiting phase is one
 * the cascade *stops* at, and this one it never does.
 *
 * `FAILED` and `INCOMPLETE` are the other side of that: the cascade does stop at
 * both, and neither belongs here, because this set has one reader — the dispatch in
 * `triggers.ts` deciding whether a **plain** comment is worth a classifier turn.
 * Neither park accepts either signal a classifier can produce, so a comment typed
 * under one is read and set aside with a 👍, and `INCOMPLETE` mirrors `FAILED` here
 * deliberately: what moves a park on is a command, and prose is not one.
 */
export const WAITING_PHASES: ReadonlySet<Phase> = new Set<Phase>(['DESIGN_SPEC', 'PLAN_REVIEW'])
