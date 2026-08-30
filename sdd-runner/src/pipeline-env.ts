// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import type { AutonomyConfig } from './config.js'
import type { DepthProfile, EventInput } from './events.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { runPostReviewToGate } from './post-review-tail.js'
import type { ReviewLoopResult } from './review-loop.js'
import type { RunState } from './run-state.js'
import { createStageMachine } from './stage-machine.js'

export interface FreshInput {
  readonly taskText: string
  readonly changeName: string
  readonly depthOverride?: DepthProfile
  readonly forcePlan?: boolean
  readonly autonomy: AutonomyConfig
}

export interface PipelineEnv {
  readonly deps: OrchestratorDeps
  readonly state: RunState
  readonly machine: ReturnType<typeof createStageMachine>
  readonly agent: AgentLayerDeps
  readonly ctx: StageContext
  readonly input: FreshInput
}

export function buildPipelineEnv(
  deps: OrchestratorDeps,
  state: RunState,
  emit: (event: EventInput) => void,
  input: FreshInput,
): PipelineEnv {
  const cwd = deps.config.repoRoot
  const sidecarDir = path.join(state.runDir, 'sidecars')
  const changeDir = path.join(cwd, 'openspec', 'changes', input.changeName)
  const machine = createStageMachine({ emit })
  const agent: AgentLayerDeps = { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit }
  const ctx: StageContext = { cwd, changeDir, sidecarDir, emit }
  const resolved: OrchestratorDeps = { ...deps, autonomy: input.autonomy }
  return { deps: resolved, state, machine, agent, ctx, input }
}

export type PostReviewTailInput = Parameters<typeof runPostReviewToGate>[0]

/**
 * Build the shared post-review tail input from the pipeline env. The
 * verification seam is passed in rather than built here: it re-enters the
 * review stage, which the orchestrator owns, and the tail treats its absence as
 * "cannot spend the round" — so a caller that forgets it silently loses the
 * one verification round a `needs-review` cap-hit is owed.
 */
export function tailInputOf(
  env: PipelineEnv,
  depth: DepthProfile,
  reviewResult: ReviewLoopResult,
  version: number = 1,
  runVerification?: PostReviewTailInput['runVerification'],
): PostReviewTailInput {
  return {
    deps: env.deps,
    state: env.state,
    ctx: env.ctx,
    agent: env.agent,
    depth,
    reviewResult,
    version,
    ...(runVerification === undefined ? {} : { runVerification }),
  }
}
