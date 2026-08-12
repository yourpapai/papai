// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { runAtomicity, runDecompose } from './decompose.js'
import type { DepthProfile, EventInput } from './events.js'
import { findingsOf, gatherAssumptions, nowOf, presentGateAt, readReviewResultFromSidecars } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { createMaterializer } from './materialize.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { resolveRoundCap, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { createStageMachine } from './stage-machine.js'

export interface RunGateResumeResult {
  readonly runId: string
  readonly outcome: 'approved' | 'aborted' | 'veto' | 'extend'
  readonly version: number
  readonly gateMdPath?: string
}

export async function prepareResumeInput(
  sidecarDir: string,
  round: number,
  gateMode: 'early' | 'final',
): Promise<{
  assumptions: readonly { id: string; text: string; blast_radius: string }[]
  reviewResult: ReviewLoopResult
  requiredAck: string | undefined
}> {
  const assumptions = await gatherAssumptions(sidecarDir, round)
  const capHitFired = gateMode === 'early'
  const reviewResult = await readReviewResultFromSidecars(sidecarDir, round, capHitFired ? 'cap-hit' : 'converged')
  const findings = findingsOf(reviewResult)
  const requiredAck = capHitFired && findings.blockers.length === 0 ? 'T1' : undefined
  return { assumptions, reviewResult, requiredAck }
}

/**
 * Shape B (extend-and-re-cap): bump `state.roundCap` by 1, re-enter the review
 * loop at `state.round + 1` with the bumped cap, then re-present the gate. If
 * the extended round converges, fall through decompose + atomicity and present
 * the final gate; otherwise re-cap at an early gate. Returns the `'extend'`
 * outcome with the new gate version and path.
 */
export async function runExtendRound(
  deps: OrchestratorDeps,
  state: RunState,
  emit: (event: EventInput) => void,
  agent: AgentLayerDeps,
  version: number,
): Promise<RunGateResumeResult> {
  const depth = state.depth ?? 'S'
  state.roundCap = resolveRoundCap(state) + 1
  const cwd = deps.config.repoRoot
  const changeDir = path.join(cwd, 'openspec', 'changes', state.changeName)
  const sidecarDir = path.join(state.runDir, 'sidecars')
  const materialize = createMaterializer(sidecarDir, changeDir)
  const extendResult = await runReviewLoop(
    { agent, emit, sidecarDir, cwd, materialize },
    {
      changeName: state.changeName,
      changeDir,
      depth,
      taskText: '',
      conventions: deps.conventions ?? '',
    },
    { startRound: state.round + 1, cap: state.roundCap },
  )
  state.round = extendResult.rounds
  state.stage = 'review'
  await saveRunState(state, nowOf(deps))
  const ctx: StageContext = { cwd, changeDir, sidecarDir, emit }
  const machine = createStageMachine({ emit })
  const next = version + 1
  if (extendResult.outcome === 'cap-hit') {
    const gate = await presentGateAt(deps, state, ctx, extendResult, next, 'early')
    return { runId: state.runId, outcome: 'extend', version: next, gateMdPath: gate.gateMdPath }
  }
  const gate = await runPostExtendConverged(deps, state, ctx, machine, agent, depth, extendResult, next)
  return { runId: state.runId, outcome: 'extend', version: next, gateMdPath: gate.gateMdPath }
}

async function runPostExtendConverged(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  machine: ReturnType<typeof createStageMachine>,
  agent: AgentLayerDeps,
  depth: DepthProfile,
  extendResult: ReviewLoopResult,
  version: number,
): Promise<RunStartResult> {
  await machine.runStage('decompose', () =>
    runDecompose(
      { driver: deps.driver, agent, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
      { changeName: state.changeName },
    ),
  )
  state.stage = 'decompose'
  await saveRunState(state, nowOf(deps))
  if (depth !== 'S') {
    await machine.runStage('atomicity', async () => {
      await runAtomicity(
        { driver: deps.driver, agent, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
        { changeName: state.changeName, depth },
      )
    })
    state.stage = 'atomicity'
    await saveRunState(state, nowOf(deps))
  }
  state.stage = 'gate'
  let gateResult!: RunStartResult
  await machine.runStage('gate', async () => {
    gateResult = await presentGateAt(deps, state, ctx, extendResult, version, 'final')
  })
  return gateResult
}
