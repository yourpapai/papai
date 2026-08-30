// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { AssumptionRecordSchema, ResolutionSchema } from './agent-layer.js'
import type { AgentLayerDeps, Finding, Resolution } from './agent-layer.js'
import type { DepthProfile, EventInput } from './events.js'
export { consumeSteerFile, parseSteerDirectives, reloadStagedSteer } from './steer.js'
export type { ParsedSteer, StagedSteer, SteerDirective } from './steer.js'
import { concernRecords, detectConcernThrash, fingerprintOf } from './concern-model.js'
import type { ConcernRecord } from './concern-model.js'
import { resolveRound, runLenses } from './review-agents.js'
import { evaluateConvergence, readResolutionsLedger, ROUND_CAPS } from './review-model.js'
import { consumeSteerFile } from './steer.js'
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
  readonly openBlockers: readonly Resolution[]
  readonly openMaterial: readonly Resolution[]
  readonly openNitpicks: readonly Resolution[]
  /** Thrashing concerns that stopped the loop (loop-memory D5); present only on a concern-history cap-hit. */
  readonly recurringConcerns?: readonly ConcernRecord[]
}

/**
 * Round-boundary steer consumption (D6): at each round-cap evaluation point
 * consume `steer.md` (rename-on-consume, staged set persisted first), surface
 * unknown directives as warn lines, and re-read the persisted round cap so a
 * steered `extend` takes effect at this boundary — never consuming
 * `autoExtendsUsed`.
 */
function applySteerAtBoundary(deps: ReviewLoopDeps, entryCap: number): number {
  const steer = deps.steer
  if (steer === undefined) return entryCap
  const consumed = consumeSteerFile(steer.runDir)
  for (const warning of consumed.warnings) steer.onWarning(warning)
  if (consumed.valid.length > 0) steer.onDirectives?.(consumed.valid)
  return steer.readRoundCap()
}

/**
 * The resumed session applies only to the round it was recorded in; a resume
 * entering an earlier round runs it fresh by design.
 */
function consumeResumeSession(
  resumeSession: ReviewLoopDeps['resumeSession'],
  round: number,
): ReviewLoopDeps['resumeSession'] {
  if (resumeSession === undefined || resumeSession.round !== round) return undefined
  return resumeSession
}

function openBucketsOf(resolved: ResolverOutput): {
  openBlockers: readonly Resolution[]
  openMaterial: readonly Resolution[]
  openNitpicks: readonly Resolution[]
} {
  return {
    openBlockers: resolved.resolutions.filter((entry) => entry.class === 'BLOCKER'),
    openMaterial: resolved.resolutions.filter((entry) => entry.class === 'MATERIAL'),
    openNitpicks: resolved.resolutions.filter((entry) => entry.class === 'NITPICK'),
  }
}

function capHitWith(
  round: number,
  open: ReturnType<typeof openBucketsOf>,
  recurringConcerns?: readonly ConcernRecord[],
): ReviewLoopResult {
  return {
    outcome: 'cap-hit',
    rounds: round,
    openBlockers: open.openBlockers,
    openMaterial: open.openMaterial,
    openNitpicks: open.openNitpicks,
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
  const { verdict, counts } = evaluateConvergence(resolved.resolutions)
  deps.emit({ altitude: 'L2', type: 'convergence', round, verdict, counts })
  await deps.materialize(round)
  const concernHistory = await writeConcernSidecar(deps, round)
  deps.emit({ altitude: 'L2', type: 'round_close', round, cap: effectiveCap })
  const open = openBucketsOf(resolved)
  if (verdict === 'converged') {
    return { outcome: 'converged', rounds: round, openBlockers: [], openMaterial: [], openNitpicks: open.openNitpicks }
  }
  const recurringConcerns = detectConcernThrash(concernHistory, merged, round)
  if (recurringConcerns.length > 0) {
    // Concern-history gate (loop-memory D5): a thrashing concern stops the loop
    // with an early gate carrying its round-by-round history.
    return capHitWith(round, open, recurringConcerns)
  }
  if (deps.stop?.stopRequested() === true) {
    // Calm stop (D6): the in-flight round is fully recorded; do not enter the next.
    return capHitWith(round, open)
  }
  const nextCap = applySteerAtBoundary(deps, effectiveCap)
  if (round >= nextCap) return capHitWith(round, open)
  return runRound(deps, options, round + 1, nextCap, open.openBlockers.length)
}

/** Round-close concern sidecar (loop-memory D5): persist the cross-round concern history. */
async function writeConcernSidecar(deps: ReviewLoopDeps, round: number): Promise<readonly ConcernRecord[]> {
  const ledger = await readResolutionsLedger(deps.sidecarDir, round + 1)
  const records = concernRecords(ledger)
  await mkdir(path.dirname(path.join(deps.sidecarDir, 'concerns.json')), { recursive: true })
  await writeFile(path.join(deps.sidecarDir, 'concerns.json'), `${JSON.stringify(records, null, 2)}\n`)
  return records
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
