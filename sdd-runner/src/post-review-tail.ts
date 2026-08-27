// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentLayerDeps } from './agent-layer.js'
import { runAtomicity, runDecompose } from './decompose.js'
import type { DepthProfile } from './events.js'
import { nowOf, presentGateAt } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
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
}

/**
 * Post-review routing: severity-converged and plain-converged outcomes run
 * the shared post-convergence tail; an open cap-hit presents the early gate.
 */
export function runPostReviewToGate(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const reviewResult = input.reviewResult
  if (isSeverityConverged(reviewResult)) return runPostConvergenceTail(input)
  if (reviewResult.outcome === 'cap-hit') {
    return presentGateAt(input.deps, input.state, input.ctx, reviewResult, input.version, 'early')
  }
  return runPostConvergenceTail(input)
}

/**
 * Severity-based convergence (orchestrator-level verdict): a cap-hit round
 * with zero open BLOCKERs and zero open MATERIALs — nitpicks only, each
 * resolved or dismissed — is treated as converged and flows into decompose
 * without an early gate. Blockers/materials still force the early gate.
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
export async function runPostConvergenceTail(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const { deps, state, ctx, agent, depth, reviewResult, version } = input
  const machine = createStageMachine({ emit: ctx.emit })
  await machine.runStage('decompose', async () => {
    await runDecompose(
      { driver: deps.driver, agent, runDir: state.runDir, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
      { changeName: state.changeName },
    )
  })
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
