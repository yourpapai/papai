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

/**
 * The per-stage agent deps, derived in one place from the orchestrator deps.
 *
 * Every stage entry point needs this same projection, and the claude run
 * context has to ride it: four hand-copied literals is exactly how one route
 * gets dropped on one path. `claude` is spread conditionally so a run without
 * the context has no key at all rather than an undefined one.
 */
export function agentDepsOf(deps: OrchestratorDeps, emit: (event: EventInput) => void): AgentLayerDeps {
  return {
    spawn: deps.spawn,
    config: deps.config,
    execGit: deps.execGit,
    emit,
    ...(deps.claude === undefined ? {} : { claude: deps.claude }),
  }
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
  const agent = agentDepsOf(deps, emit)
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
