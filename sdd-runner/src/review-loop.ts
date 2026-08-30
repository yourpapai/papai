// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { AssumptionRecordSchema, ResolutionSchema } from './agent-layer.js'
import type { AgentLayerDeps, Finding, Resolution } from './agent-layer.js'
import type { DepthProfile, EventInput, FindingCounts } from './events.js'
export { consumeSteerFile, parseSteerDirectives, reloadStagedSteer } from './steer.js'
export type { ParsedSteer, StagedSteer, SteerDirective } from './steer.js'
import { detectConcernThrash, fingerprintOf } from './concern-model.js'
import type { ConcernRecord } from './concern-model.js'
import { resolveRound, runLenses } from './review-agents.js'
import { applySteerAtBoundary, consumeResumeSession } from './review-boundary.js'
import { ROUND_CAPS } from './review-model.js'
import { closeRound } from './review-round.js'
import type { ClosedRound } from './review-round.js'
import type { SteerDirective } from './steer.js'

export const ResolverOutputSchema = z
  .object({
    resolutions: z.array(ResolutionSchema),
    assumptions: z.array(AssumptionRecordSchema),
  })
  .refine((output) => new Set(output.resolutions.map((entry) => entry.id)).size === output.resolutions.length, {
    message: 'resolutions must have unique finding ids within a round',
  })
export type ResolverOutput = z.infer<typeof ResolverOutputSchema>

export interface ReviewLoopDeps {
  readonly agent: AgentLayerDeps
  readonly emit: (event: EventInput) => void
  readonly runDir: string
  readonly sidecarDir: string
  readonly cwd: string
  readonly materialize: (round: number) => Promise<void>
  /**
   * Resume continuation (D2): continue this recorded opencode session at its
   * exact prior context instead of re-spawning the round's first agent from a
   * rebuilt prompt. Consumed by the first spawn of the resumed round.
   */
  readonly resumeSession?: {
    readonly label: string
    readonly opencodeSessionId: string
    readonly round: number
  }
  /**
   * Calm-stop seam (D6): consulted between rounds — a stop lands after the
   * in-flight round completes and its artifacts are recorded. Omitted → no
   * stop path (tests, embedders).
   */
  readonly stop?: { readonly stopRequested: () => boolean }
  /**
   * Round-boundary steering seam (D6): consume `steer.md` at each round-cap
   * evaluation point and re-read the persisted round cap so a steered
   * `extend` takes effect at the next boundary without consuming
   * `autoExtendsUsed`. Omitted → no steering (today's behavior).
   */
  readonly steer?: {
    readonly runDir: string
    readonly onWarning: (line: string) => void
    readonly onDirectives?: (directives: readonly SteerDirective[]) => void
    readonly readRoundCap: () => number
  }
}

export interface ReviewLoopOptions {
  readonly changeName: string
  readonly changeDir: string
  readonly depth: DepthProfile
  readonly taskText: string
  readonly conventions: string
}

export interface ReviewLoopResult {
  readonly outcome: 'converged' | 'cap-hit'
  readonly rounds: number
  /** The round's three-valued verdict over the open set. */
  readonly verdict: 'converged' | 'needs-review' | 'open'
  /** Every finding the round recorded, by class — the trajectory's number, not the gate's. */
  readonly raised: FindingCounts
  readonly openBlockers: readonly Resolution[]
  readonly openMaterial: readonly Resolution[]
  readonly openNitpicks: readonly Resolution[]
  /** Thrashing concerns that stopped the loop (loop-memory D5); present only on a concern-history cap-hit. */
  readonly recurringConcerns?: readonly ConcernRecord[]
}

function capHitWith(
  round: number,
  closed: ClosedRound,
  recurringConcerns?: readonly ConcernRecord[],
): ReviewLoopResult {
  return {
    outcome: 'cap-hit',
    rounds: round,
    verdict: closed.verdict,
    raised: closed.raised,
    ...closed.openLists,
    ...(recurringConcerns === undefined ? {} : { recurringConcerns }),
  }
}

/** Emit the round's classified findings with their concern fingerprints (loop-memory D5). */
function emitClassified(deps: ReviewLoopDeps, merged: readonly Finding[], round: number): void {
  for (const finding of merged) {
    deps.emit({
      altitude: 'L2',
      type: 'finding',
      action: 'classified',
      id: finding.id,
      round,
      class: finding.class,
      fingerprint: fingerprintOf(finding.gap),
    })
  }
}

async function runRound(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  cap: number,
  prevOpenBlockers: number,
  resumeSession?: ReviewLoopDeps['resumeSession'],
): Promise<ReviewLoopResult> {
  const effectiveCap = applySteerAtBoundary(deps, cap)
  deps.emit({ altitude: 'L2', type: 'round_open', round, cap: effectiveCap })
  // The resumed session continues once: whichever agent the ledger recorded
  // consumes it, and later rounds/spawns are fresh by design (D2).
  const consumedSession = consumeResumeSession(resumeSession, round)
  const merged = await runLenses(deps, options, round, prevOpenBlockers, consumedSession)
  emitClassified(deps, merged, round)
  const resolved = await resolveRound(deps, options, round, merged, consumedSession)
  const closed = await closeRound(deps, options, resolved, round, effectiveCap)
  const settled = { rounds: round, verdict: closed.verdict, raised: closed.raised } as const
  if (closed.verdict === 'converged') {
    const { openNitpicks } = closed.openLists
    return { ...settled, outcome: 'converged', openBlockers: [], openMaterial: [], openNitpicks }
  }
  const recurringConcerns = detectConcernThrash(closed.concernHistory, merged, round)
  if (recurringConcerns.length > 0) {
    // Concern-history gate (loop-memory D5): a thrashing concern stops the loop
    // with an early gate carrying its round-by-round history.
    return capHitWith(round, closed, recurringConcerns)
  }
  if (deps.stop?.stopRequested() === true) {
    // Calm stop (D6): the in-flight round is fully recorded; do not enter the next.
    return capHitWith(round, closed)
  }
  const nextCap = applySteerAtBoundary(deps, effectiveCap)
  if (round >= nextCap) return capHitWith(round, closed)
  // Lens escalation asks "are blockers still being found", not "is one waiting
  // for a human", so it carries the raised count forward — not the open one.
  return runRound(deps, options, round + 1, nextCap, closed.raised.blocker)
}

export function runReviewLoop(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  entry: { readonly startRound?: number; readonly cap?: number } = {},
): Promise<ReviewLoopResult> {
  const startRound = entry.startRound ?? 1
  const cap = entry.cap ?? ROUND_CAPS[options.depth]
  return runRound(deps, options, startRound, cap, 0, deps.resumeSession)
}
