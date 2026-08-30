// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { runPlanBranch } from './children.js'
import { autonomyOf } from './config.js'
import type { DepthProfile, EventInput } from './events.js'
import { buildBus, logPathFor, nowOf } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { resolveTaskSource } from './intake.js'
import {
  isInterruptedPlanBranchResume,
  isPlanParentResume,
  resumePlanParent,
  runContinuationStart,
} from './plan-resume.js'
import type { PlanChild } from './plan.js'
import { runPlanningStages, runReviewStage } from './planning-stages.js'
import type { FreshInput, PipelineEnv } from './planning-stages.js'
import { runPostReviewToGate } from './post-review-tail.js'
import type { Verbosity } from './renderer.js'
import { resumeFromPoint } from './resume-flow.js'
import { deriveResumeDecision, reportResumeDecision, settleStoppedResult } from './resume-flow.js'
import type { ReviewLoopResult } from './review-loop.js'
import { createRunState, loadRunState, resolveRoundCap, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { createStageMachine } from './stage-machine.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'

export type { OrchestratorDeps, RunStartResult } from './gate-digest.js'
export type { GateResumeOptions, RunGateResumeResult } from './extend-round.js'
export { runContinue } from './continue.js'
export type { RunContinueResult } from './continue.js'

export interface AutonomyOverrides {
  readonly deadlineMinutes?: number
}

export interface StartOptions {
  readonly taskFile?: string
  /** Inline task text (D3): starts a session without a task file. */
  readonly taskText?: string
  /** Explicit session name; defaults to the first heading of inline text. */
  readonly changeName?: string
  readonly depthOverride?: DepthProfile
  readonly verbosity?: Verbosity
  readonly autonomy?: AutonomyOverrides
  /** Tree spend baseline (D10) a nested run adds before its single-ceiling compare. */
  readonly spendBaselineUsd?: number
  /** The plan child this nested run executes (D6) — a `changeName`-carrier gets a continuation start. */
  readonly child?: PlanChild
  /** Reports the fresh run dir (D11) before stage work so a parent can propagate calm-stop. */
  readonly onRunDirReady?: (runDir: string) => void
}

export interface RunResumeResult {
  readonly runId: string
  readonly halted: 'gate' | 'gate-pending' | 'stopped' | 'completed'
  readonly gateMdPath?: string
  readonly version?: number
  readonly childRunId?: string
}

export async function runStart(deps: OrchestratorDeps, options: StartOptions): Promise<RunStartResult> {
  const adoptedChangeName = options.child?.changeName
  if (adoptedChangeName !== undefined) return runContinuationStart(deps, options, adoptedChangeName)
  const { taskText, changeName } = await resolveTaskSource(options)
  const state = await createRunState(
    {
      workDir: deps.config.workDir,
      repoRoot: deps.config.repoRoot,
      changeName,
      spendBaselineUsd: options.spendBaselineUsd,
    },
    nowOf(deps),
  )
  options.onRunDirReady?.(state.runDir)
  await writeFile(path.join(state.runDir, 'task.md'), taskText, 'utf8')
  const emit = buildBus(deps, logPathFor(state))
  writeHolder(state.runDir)
  deps.mountRunScreen?.({ runDir: state.runDir, logPath: logPathFor(state) })
  // Fresh-run calm-stop seam (D6/D11): honors the marker at the next round boundary, settles stopped (resumable).
  const stop = createStopMarkerSeam(state.runDir)
  try {
    const env = buildPipelineEnv(deps, state, emit, {
      taskText,
      changeName,
      depthOverride: options.depthOverride,
      autonomy: autonomyOf(deps.config, options.autonomy?.deadlineMinutes),
    })
    const planned = await runPlanningStages(env, stop)
    const halted =
      planned.kind === 'plan'
        ? await runPlanBranch(env.deps, env.state, env.ctx, planned.children)
        : await runPostReviewToGate(tailInputOf(env, planned.depth, planned.reviewResult))
    await settleStoppedResult(deps, state, stop, halted)
    return halted
  } finally {
    removeHolder(state.runDir)
    deps.unmountRunScreen?.()
  }
}

export async function runResume(
  deps: OrchestratorDeps,
  runId: string,
  overrides: AutonomyOverrides = {},
): Promise<RunResumeResult> {
  const autonomy = autonomyOf(deps.config, overrides.deadlineMinutes)
  const state = await loadRunState(deps.config.workDir, runId)
  if (state.gate !== null) {
    deps.stdout?.(`run ${runId} awaits a gate decision (gate ${state.gate.version}, ${state.gate.mode})`)
    deps.stdout?.(`sdd ${runId}`)
    return { runId, halted: 'gate-pending' }
  }
  const emit = buildBus(deps, logPathFor(state))
  if (isPlanParentResume(state) || isInterruptedPlanBranchResume(state)) {
    const resumed = await resumePlanParent(deps, state, emit, autonomy, runStart)
    return resumed
  }
  const decision = await deriveResumeDecision(deps, state)
  reportResumeDecision(deps, emit, decision)
  const depth = state.depth ?? 'S'
  const stop = createStopMarkerSeam(state.runDir)
  writeHolder(state.runDir)
  deps.mountRunScreen?.({ runDir: state.runDir, logPath: logPathFor(state) })
  try {
    const env = buildPipelineEnv(deps, state, emit, {
      taskText: '',
      changeName: state.changeName,
      depthOverride: depth,
      autonomy,
    })
    const result = await resumeFromPoint(
      { deps: env.deps, state, ctx: env.ctx, agent: env.agent, stop },
      {
        runReviewStage: (d, entry) => runReviewStage(env, d, '', entry, stop),
        runPostReviewToGate: (d, reviewResult, version) =>
          runPostReviewToGate(tailInputOf(env, d, reviewResult, version)),
      },
      decision,
      depth,
    )
    return await settleStoppedResult(deps, state, stop, result)
  } finally {
    removeHolder(state.runDir)
    deps.unmountRunScreen?.()
  }
}

function buildPipelineEnv(
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

/** Build the shared post-review tail input from the pipeline env. */
function tailInputOf(
  env: PipelineEnv,
  depth: DepthProfile,
  reviewResult: ReviewLoopResult,
  version: number = 1,
): Parameters<typeof runPostReviewToGate>[0] {
  return {
    deps: env.deps,
    state: env.state,
    ctx: env.ctx,
    agent: env.agent,
    depth,
    reviewResult,
    version,
    runVerification: (result) => runVerificationRound(env, depth, result),
  }
}

/**
 * One further review round over edits no reviewer has seen. It raises the
 * persisted cap by one — the round is real spend and the trajectory must show
 * it — and re-enters the loop at the next round, exactly as an extend does.
 */
async function runVerificationRound(
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
