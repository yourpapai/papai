// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentLayerDeps } from './agent-layer.js'
import type { AutonomyConfig } from './config.js'
import { runDraft } from './draft.js'
import type { DepthProfile } from './events.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { nowOf } from './gate-digest.js'
import { runIntake } from './intake.js'
import type { IntakeResult } from './intake.js'
import { createMaterializer } from './materialize.js'
import type { PlanChild } from './plan.js'
import type { ResumedSession } from './resume-decision.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { resolveRoundCap, saveRunState, steerSeamFor } from './run-state.js'
import type { RunState } from './run-state.js'
import { createStageMachine } from './stage-machine.js'
import type { CalmStopController } from './stop-controller.js'

/** The fresh-run inputs the planning stages read; fixed for a run's lifetime. */
export interface FreshInput {
  readonly taskText: string
  readonly changeName: string
  readonly depthOverride?: DepthProfile
  readonly autonomy: AutonomyConfig
}

/** Everything a stage driver needs: resolved deps, the run, and its emit seams. */
export interface PipelineEnv {
  readonly deps: OrchestratorDeps
  readonly state: RunState
  readonly machine: ReturnType<typeof createStageMachine>
  readonly agent: AgentLayerDeps
  readonly ctx: StageContext
  readonly input: FreshInput
}

/** Review-loop entry: where to re-enter, under which cap, continuing which session. */
export interface ReviewStageEntry {
  readonly startRound?: number
  readonly cap?: number
  readonly resumeSession?: ResumedSession
}

export type PlanningOutcome =
  | { readonly kind: 'plan'; readonly children: PlanChild[] }
  | { readonly kind: 'single'; readonly depth: DepthProfile; readonly reviewResult: ReviewLoopResult }

export async function runPlanningStages(env: PipelineEnv, stop?: CalmStopController): Promise<PlanningOutcome> {
  const { deps, state } = env
  const intake = await runIntakeStage(env)
  await saveRunState(state, nowOf(deps))
  if (intake.kind === 'plan') return { kind: 'plan', children: intake.children }
  await runDraftStage(env, intake.depth)
  state.stage = 'draft'
  await saveRunState(state, nowOf(deps))
  const reviewResult = await runReviewStage(env, intake.depth, env.input.taskText, {}, stop)
  state.stage = 'review'
  await saveRunState(state, nowOf(deps))
  return { kind: 'single', depth: intake.depth, reviewResult }
}

async function runIntakeStage(env: PipelineEnv): Promise<IntakeResult> {
  const { deps, state, machine, agent, ctx, input } = env
  let intake: IntakeResult = {
    kind: 'single',
    changeName: input.changeName,
    depth: input.depthOverride ?? 'S',
    disagreement: false,
  }
  await machine.runStage('intake', async () => {
    intake = await runIntake(
      {
        driver: deps.driver,
        agent,
        emit: ctx.emit,
        sidecarDir: ctx.sidecarDir,
        runDir: state.runDir,
        cwd: ctx.cwd,
        stdout: (line) => deps.stdout?.(`intake: ${line}`),
      },
      { changeName: input.changeName, taskText: input.taskText, depthOverride: input.depthOverride },
    )
    if (intake.kind === 'single') {
      state.depth = intake.depth
      state.roundCap = resolveRoundCap({ depth: intake.depth, roundCap: undefined })
    }
  })
  return intake
}

async function runDraftStage(env: PipelineEnv, depth: DepthProfile): Promise<void> {
  const { deps, state, machine, agent, ctx, input } = env
  await machine.runStage('draft', () =>
    runDraft(
      {
        driver: deps.driver,
        agent,
        runDir: state.runDir,
        sidecarDir: ctx.sidecarDir,
        cwd: ctx.cwd,
      },
      { changeName: input.changeName, taskText: input.taskText, depth },
    ),
  )
}

export async function runReviewStage(
  env: PipelineEnv,
  depth: DepthProfile,
  taskText: string,
  entry: ReviewStageEntry = {},
  stop?: CalmStopController,
): Promise<ReviewLoopResult> {
  const { deps, state, machine, agent, ctx, input } = env
  const materialize = createMaterializer(ctx.sidecarDir, ctx.changeDir, ctx.emit, deps.config.repoRoot)
  let reviewResult!: ReviewLoopResult
  await machine.runStage('review', async () => {
    reviewResult = await runReviewLoop(
      {
        agent,
        emit: ctx.emit,
        runDir: state.runDir,
        sidecarDir: ctx.sidecarDir,
        cwd: ctx.cwd,
        materialize,
        stop,
        steer: steerSeamFor(state, (line) => deps.stdout?.(`steer: ${line}`)),
        resumeSession: entry.resumeSession,
      },
      {
        changeName: input.changeName,
        changeDir: ctx.changeDir,
        depth,
        taskText,
        conventions: deps.conventions ?? '',
      },
      { startRound: entry.startRound, cap: entry.cap },
    )
    state.round = reviewResult.rounds
  })
  return reviewResult
}
