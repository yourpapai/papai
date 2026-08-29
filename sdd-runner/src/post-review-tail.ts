// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentLayerDeps } from './agent-layer.js'
import { DEFAULT_ROUND_COST_USD } from './auto-policy.js'
import { runAtomicity, runDecompose } from './decompose.js'
import type { DepthProfile } from './events.js'
import { nowOf, presentGateAt } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { gatherGateSignals } from './gate-signals.js'
import type { ReviewLoopResult } from './review-loop.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { createStageMachine } from './stage-machine.js'

export interface PostConvergenceTailInput {
  readonly deps: OrchestratorDeps
  readonly state: RunState
  readonly ctx: StageContext
  readonly agent: AgentLayerDeps
  readonly depth: DepthProfile
  readonly reviewResult: ReviewLoopResult
  readonly version: number
  /**
   * Runs one further review round over unreviewed edits. Supplied by callers
   * that own the review loop; absent for callers that cannot spend a round,
   * which then continue straight to the final gate. Routing is never
   * re-entered from its result — that is what bounds it to one per cap-hit.
   */
  readonly runVerification?: (result: ReviewLoopResult) => Promise<ReviewLoopResult>
}

/** What a settled review round does next. */
export type CapHitRoute = { readonly kind: 'tail' } | { readonly kind: 'early-gate' } | { readonly kind: 'verify' }

export interface RouteConditions {
  /** A verification round has already been spent for this cap-hit. */
  readonly verified?: boolean
  /** The budget guard refuses another round's spend. */
  readonly overBudget?: boolean
}

/**
 * Route a settled review by its verdict. Three outcomes, one each for the three
 * things a round can leave behind:
 *
 * - `open` — something only a human can settle, so the early gate is presented.
 *   This holds even after a verification round: that round can dismiss a
 *   finding of its own, and a spent round does not waive the human's call.
 * - `needs-review` — nothing open, but an edit no reviewer has seen. One
 *   further round looks at it. The bound is structural: the verification
 *   round's own result routes straight to the tail rather than back through
 *   here, so a second can never be granted for the same cap-hit.
 * - `converged` — into the tail, no gate.
 *
 * An over-budget verification round is declined rather than deferred; the run
 * continues to its final gate, where a human sees the result either way.
 */
export function routeCapHit(reviewResult: ReviewLoopResult, conditions: RouteConditions = {}): CapHitRoute {
  if (reviewResult.outcome !== 'cap-hit') return { kind: 'tail' }
  // Gating keys on findings above a nitpick, exactly as severity convergence
  // always has. The verdict's three-nitpick bar governs whether the loop keeps
  // running, which is a different question from whether a human is needed, and
  // routing on it would newly gate the nitpick-heavy cap-hits that used to
  // flow straight through.
  if (!isSeverityConverged(reviewResult)) return { kind: 'early-gate' }
  if (reviewResult.verdict !== 'needs-review') return { kind: 'tail' }
  if (conditions.verified === true || conditions.overBudget === true) return { kind: 'tail' }
  return { kind: 'verify' }
}

/**
 * Post-review routing: a converged or severity-converged outcome runs the
 * shared post-convergence tail, an open cap-hit presents the early gate, and a
 * cap-hit carrying unreviewed edits buys exactly one verification round first.
 */
export async function runPostReviewToGate(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const verify = input.runVerification
  const route = routeCapHit(input.reviewResult, await routeConditionsFor(input))
  if (route.kind === 'early-gate') {
    return presentGateAt(input.deps, input.state, input.ctx, input.reviewResult, input.version, 'early')
  }
  // A caller with no verification seam cannot spend the round; it continues to
  // the final gate, where a human sees the unreviewed edits either way.
  if (route.kind === 'verify' && verify !== undefined) {
    return runPostConvergenceTail({ ...input, reviewResult: await verify(input.reviewResult) })
  }
  return runPostConvergenceTail(input)
}

/**
 * Severity-based convergence: a cap-hit round with nothing a human must settle
 * flows into decompose without an early gate.
 */
export function isSeverityConverged(reviewResult: ReviewLoopResult): boolean {
  return (
    reviewResult.outcome === 'cap-hit' &&
    reviewResult.openBlockers.length === 0 &&
    reviewResult.openMaterial.length === 0
  )
}

/**
 * Shared post-convergence tail: decompose → atomicity (depth ≠ S) → final
 * gate at `version`. Serves the fresh pipeline's converged path, the extend
 * round's converged continuation, and the early-gate approval continuation,
 * so every route into the tail presents the same final-gate shape.
 */
/**
 * The budget question the verification round has to pass: would one more
 * round's conservative projection reach the configured ceiling? Unknown cost
 * fails closed the same way R4 does — an unmeterable run does not get to spend
 * a round it cannot account for.
 */
async function routeConditionsFor(input: PostConvergenceTailInput): Promise<RouteConditions> {
  if (input.reviewResult.verdict !== 'needs-review') return {}
  const signals = await gatherGateSignals(input.deps, input.state, input.ctx, input.reviewResult)
  const ceiling = input.deps.autonomy?.costCeilingUsd ?? input.deps.config.budget
  const baseline = input.state.spendBaselineUsd ?? 0
  const rounds = input.reviewResult.rounds
  const perRound = rounds > 0 ? signals.costUsd / rounds : DEFAULT_ROUND_COST_USD
  const projected = baseline + signals.costUsd + perRound
  return { overBudget: !signals.costKnown || projected >= ceiling }
}

export async function runPostConvergenceTail(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const { deps, state, ctx, agent, depth, reviewResult, version } = input
  const machine = createStageMachine({ emit: ctx.emit })
  await machine.runStage('decompose', () =>
    runDecompose(
      { driver: deps.driver, agent, runDir: state.runDir, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
      { changeName: state.changeName },
    ),
  )
  state.stage = 'decompose'
  await saveRunState(state, nowOf(deps))
  if (depth !== 'S') {
    await machine.runStage('atomicity', async () => {
      await runAtomicity(
        {
          driver: deps.driver,
          agent,
          runDir: state.runDir,
          sidecarDir: ctx.sidecarDir,
          cwd: ctx.cwd,
        },
        { changeName: state.changeName, depth },
      )
    })
    state.stage = 'atomicity'
    await saveRunState(state, nowOf(deps))
  }
  state.stage = 'gate'
  let gateResult!: RunStartResult
  await machine.runStage('gate', async () => {
    gateResult = await presentGateAt(deps, state, ctx, reviewResult, version, 'final')
  })
  return gateResult
}
