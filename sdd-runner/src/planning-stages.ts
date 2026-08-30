// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { runDraft } from './draft.js'
import type { DepthProfile } from './events.js'
import { nowOf } from './gate-digest.js'
import { runIntake } from './intake.js'
import type { IntakeResult } from './intake.js'
import { createMaterializer } from './materialize.js'
import type { PipelineEnv } from './pipeline-env.js'
import type { PlanChild } from './plan.js'
import type { ResumedSession } from './resume-decision.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { resolveRoundCap, saveRunState, steerSeamFor } from './run-state.js'
import type { CalmStopController } from './stop-controller.js'

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

export async function runIntakeStage(env: PipelineEnv): Promise<IntakeResult> {
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
      {
        changeName: input.changeName,
        taskText: input.taskText,
        depthOverride: input.depthOverride,
        forcePlan: input.forcePlan,
      },
    )
    if (intake.kind === 'single') {
      state.depth = intake.depth
      state.roundCap = resolveRoundCap({ depth: intake.depth, roundCap: undefined })
    }
  })
  return intake
}

export async function runDraftStage(env: PipelineEnv, depth: DepthProfile): Promise<void> {
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
  entry: {
    readonly startRound?: number
    readonly cap?: number
    readonly resumeSession?: ResumedSession
  } = {},
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

/**
 * The one verification round a `needs-review` cap-hit is owed: the round's open
 * set is clean but it edited an artifact no reviewer has seen. Raising the
 * persisted cap by one and re-entering the loop is real spend, so it is bound to
 * a single round — the tail flows into decomposition whatever this round records.
 */
export async function runVerificationRound(
  env: PipelineEnv,
  depth: DepthProfile,
  result: ReviewLoopResult,
): Promise<ReviewLoopResult> {
  env.state.roundCap = resolveRoundCap(env.state) + 1
  const verified = await runReviewStage(env, depth, env.input.taskText, {
    startRound: result.rounds + 1,
    cap: env.state.roundCap,
  })
  env.state.round = verified.rounds
  await saveRunState(env.state, nowOf(env.deps))
  return verified
}
