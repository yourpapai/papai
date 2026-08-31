// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'
import { z } from 'zod'

import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import { AssumptionRecordSchema, FindingsSidecarSchema, ResolutionSchema, runStageAgent } from '../agent-layer.js'
import type { AgentLayerDeps, Finding, Resolution } from '../agent-layer.js'
import type { DepthProfile, EventInput, FindingCounts } from '../events.js'
export { consumeSteerFile, parseSteerDirectives, reloadStagedSteer } from './steer.js'
export type { ParsedSteer, StagedSteer, SteerDirective } from './steer.js'
import { ROUND_CAPS } from '../run-state.js'
import { applySteerAtBoundary, consumeResumeSession, sessionForLabel } from './review-boundary.js'
import {
  buildResolverPrompt,
  buildReviewerPrompt,
  lensesForRound,
  mergeLensFindings,
  readResolutionsLedger,
  readReviewArtifacts,
} from './review-model.js'
import { closeRound } from './review-round.js'
import type { SteerDirective } from './steer.js'

export const ResolverOutputSchema = z.object({
  resolutions: z.array(ResolutionSchema),
  assumptions: z.array(AssumptionRecordSchema),
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
  /** How the loop ended, not what the last round found — see `verdict` for that. */
  readonly outcome: 'converged' | 'cap-hit'
  readonly rounds: number
  /**
   * The last round's verdict. `needs-review` means nothing is open but the
   * round produced an edit no reviewer has seen; cap-hit routing reads this to
   * tell a loop that needs one more look from one that needs a human.
   */
  readonly verdict: 'converged' | 'needs-review' | 'open'
  /** Every finding the last round recorded, by class — the trajectory's number. */
  readonly raised: FindingCounts
  readonly openBlockers: readonly Resolution[]
  readonly openMaterial: readonly Resolution[]
  readonly openNitpicks: readonly Resolution[]
}

async function runLens(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  lens: 'reviewer' | 'skeptic',
  round: number,
  artifacts: string,
  ledger: readonly Resolution[],
  continueSessionId?: string,
): Promise<Finding[]> {
  const outputPath = lens === 'skeptic' ? `findings-skeptic-${round}.json` : `findings-${round}.json`
  const result = await runStageAgent(deps.agent, {
    role: lens,
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildReviewerPrompt({
      lens,
      artifacts,
      conventions: options.conventions,
      ledger,
      outputTarget: agentWritePath(deps.cwd, outputPath),
    }),
    outputPath,
    outputSchema: FindingsSidecarSchema,
    label: `${lens}-r${round}`,
    runDir: deps.runDir,
    round,
    sidecarDir: deps.sidecarDir,
    ...(continueSessionId === undefined ? {} : { continueSessionId }),
  })
  return result.value.findings
}

async function runResolver(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  artifacts: string,
  merged: readonly Finding[],
  continueSessionId?: string,
): Promise<ResolverOutput> {
  const result = await runStageAgent(deps.agent, {
    role: 'resolver',
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildResolverPrompt({
      artifacts,
      findings: merged,
      conventions: options.conventions,
      taskText: options.taskText,
      outputTarget: agentWritePath(deps.cwd, `resolutions-${round}.json`),
    }),
    outputPath: `resolutions-${round}.json`,
    outputSchema: ResolverOutputSchema,
    label: `resolver-r${round}`,
    runDir: deps.runDir,
    round,
    sidecarDir: deps.sidecarDir,
    ...(continueSessionId === undefined ? {} : { continueSessionId }),
  })
  for (const entry of result.value.resolutions) {
    const action = entry.resolution === 'dismissed' ? 'dismissed' : 'resolved'
    deps.emit({ altitude: 'L2', type: 'finding', action, id: entry.id, round, class: entry.class })
  }
  for (const assumption of result.value.assumptions) {
    deps.emit({ altitude: 'L2', type: 'assumption', action: 'logged', id: assumption.id })
  }
  return result.value
}

/** Run this round's lenses (bounded 2-way) and merge their findings. */
async function runLenses(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  prevOpenBlockers: number,
  consumedSession: ReviewLoopDeps['resumeSession'],
): Promise<readonly Finding[]> {
  const artifacts = await readReviewArtifacts(options.changeDir)
  const ledger = await readResolutionsLedger(deps.sidecarDir, round)
  const lenses = lensesForRound(options.depth, round, prevOpenBlockers)
  const limit = pLimit(2)
  const perLens = await Promise.all(
    lenses.map((lens) =>
      limit(() =>
        runLens(deps, options, lens, round, artifacts, ledger, sessionForLabel(consumedSession, lens, round)),
      ),
    ),
  )
  return mergeLensFindings(...perLens)
}

/**
 * Round-open owedness (log-fidelity D2): the state-shaped `round_open` is
 * owed iff it changes the folded round state — the round being opened is not
 * the entry fold's current round, or the effective cap differs from the
 * fold's recorded cap. Same-round re-entries (resume, extend re-entry,
 * escalation retry) owe nothing; recursion into round n+1 always clears the
 * comparison; a cap amendment on an open round still emits (defensive — the
 * steer wiring reads the entry fold, so within-invocation cap changes cannot
 * occur today).
 */
export function roundOpenOwed(
  foldRound: { readonly current: number; readonly cap: number } | null | undefined,
  round: number,
  effectiveCap: number,
): boolean {
  return foldRound?.current !== round || foldRound?.cap !== effectiveCap
}

async function runRound(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  cap: number,
  prevOpenBlockers: number,
  resumeSession?: ReviewLoopDeps['resumeSession'],
  entryFoldRound?: { readonly current: number; readonly cap: number } | null,
): Promise<ReviewLoopResult> {
  const effectiveCap = applySteerAtBoundary(deps, cap)
  if (roundOpenOwed(entryFoldRound, round, effectiveCap)) {
    deps.emit({ altitude: 'L2', type: 'round_open', round, cap: effectiveCap })
  }
  // The resumed session continues once: whichever agent the ledger recorded
  // consumes it, and later rounds/spawns are fresh by design (D2).
  const consumedSession = consumeResumeSession(resumeSession, round)
  const merged = await runLenses(deps, options, round, prevOpenBlockers, consumedSession)
  for (const finding of merged) {
    deps.emit({ altitude: 'L2', type: 'finding', action: 'classified', id: finding.id, round, class: finding.class })
  }
  const artifacts = await readReviewArtifacts(options.changeDir)
  const resolved = await runResolver(
    deps,
    options,
    round,
    artifacts,
    merged,
    sessionForLabel(consumedSession, 'resolver', round),
  )
  const { verdict, raised, openLists } = await closeRound(deps, options, resolved, round, effectiveCap)
  const settled = { rounds: round, verdict, raised } as const
  if (verdict === 'converged') {
    const openNitpicks = openLists.openNitpicks
    return { ...settled, outcome: 'converged', openBlockers: [], openMaterial: [], openNitpicks }
  }
  if (deps.stop?.stopRequested() === true) {
    // Calm stop (D6): the in-flight round is fully recorded; do not enter the next.
    return { ...settled, outcome: 'cap-hit', ...openLists }
  }
  const nextCap = applySteerAtBoundary(deps, effectiveCap)
  if (round >= nextCap) return { ...settled, outcome: 'cap-hit', ...openLists }
  // Lens escalation asks "are blockers still being found", not "is one waiting
  // for a human", so it carries the raised count forward — not the open one.
  return runRound(deps, options, round + 1, nextCap, raised.blocker)
}

export function runReviewLoop(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  entry: {
    readonly startRound?: number
    readonly cap?: number
    readonly foldRound?: { readonly current: number; readonly cap: number } | null
  } = {},
): Promise<ReviewLoopResult> {
  const startRound = entry.startRound ?? 1
  const cap = entry.cap ?? ROUND_CAPS[options.depth]
  return runRound(deps, options, startRound, cap, 0, deps.resumeSession, entry.foldRound ?? null)
}
