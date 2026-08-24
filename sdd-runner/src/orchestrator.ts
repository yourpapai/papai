// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { deriveChangeName } from './config.js'
import { autonomyOf } from './config.js'
import type { AutonomyConfig } from './config.js'
import { runDraft } from './draft.js'
import type { DepthProfile, EventInput } from './events.js'
import { buildBus, logPathFor, nowOf, presentGateAt } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { runIntake } from './intake.js'
import { createMaterializer } from './materialize.js'
import { runPostConvergenceTail } from './post-review-tail.js'
import type { Verbosity } from './renderer.js'
import type { ResumedSession } from './resume-decision.js'
import { resumeFromPoint } from './resume-flow.js'
import { deriveResumeDecision, reportResumeDecision, settleStoppedResult } from './resume-flow.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { createRunState, loadRunState, resolveRoundCap, saveRunState, steerSeamFor } from './run-state.js'
import type { RunState } from './run-state.js'
import { createStageMachine } from './stage-machine.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'
import type { CalmStopController } from './stop-controller.js'

export type { OrchestratorDeps, RunStartResult } from './gate-digest.js'
export type { GateResumeOptions, RunGateResumeResult } from './extend-round.js'
export { runGateResume } from './extend-round.js'
export { runContinue } from './continue.js'

export interface AutonomyOverrides {
  readonly deadlineMinutes?: number
}

function resolveAutonomy(deps: OrchestratorDeps, overrides: AutonomyOverrides = {}): AutonomyConfig {
  return autonomyOf(deps.config, overrides.deadlineMinutes)
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
}

export interface RunResumeResult {
  readonly runId: string
  readonly halted: 'gate' | 'gate-pending' | 'stopped'
  readonly gateMdPath?: string
  readonly version?: number
}

export interface RunContinueResult {
  readonly runId: string | null
  readonly routed: 'gate' | 'resume' | 'report' | 'list'
  readonly gateMdPath?: string
  readonly version?: number
}

interface FreshInput {
  readonly taskText: string
  readonly changeName: string
  readonly depthOverride?: DepthProfile
  readonly autonomy: AutonomyConfig
}

interface PipelineEnv {
  readonly deps: OrchestratorDeps
  readonly state: RunState
  readonly machine: ReturnType<typeof createStageMachine>
  readonly agent: AgentLayerDeps
  readonly ctx: StageContext
  readonly input: FreshInput
}

export async function runStart(deps: OrchestratorDeps, options: StartOptions): Promise<RunStartResult> {
  let taskText: string
  let changeName: string
  if (options.taskFile === undefined) {
    const text = options.taskText
    if (text === undefined) {
      throw new Error('runStart requires a task file or inline task text')
    }
    taskText = text
    changeName = options.changeName ?? deriveChangeName('task.md', taskText)
  } else {
    taskText = await readFile(options.taskFile, 'utf8')
    changeName = deriveChangeName(options.taskFile, taskText)
  }
  const state = await createRunState(
    { workDir: deps.config.workDir, repoRoot: deps.config.repoRoot, changeName },
    nowOf(deps),
  )
  if (options.taskText !== undefined) {
    await writeFile(path.join(state.runDir, 'task.md'), taskText, 'utf8')
  }
  const emit = buildBus(deps, logPathFor(state))
  writeHolder(state.runDir)
  deps.mountRunScreen?.({ runDir: state.runDir, logPath: logPathFor(state) })
  try {
    const env = buildPipelineEnv(deps, state, emit, {
      taskText,
      changeName,
      depthOverride: options.depthOverride,
      autonomy: resolveAutonomy(deps, options.autonomy),
    })
    const { depth, reviewResult } = await runPlanningStages(env)
    return await runPostReviewToGate(env, depth, reviewResult)
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
  const autonomy = resolveAutonomy(deps, overrides)
  const state = await loadRunState(deps.config.workDir, runId)
  if (state.gate !== null) {
    deps.stdout?.(`run ${runId} awaits a gate decision (gate ${state.gate.version}, ${state.gate.mode})`)
    deps.stdout?.(`sdd ${runId}`)
    return { runId, halted: 'gate-pending' }
  }
  const emit = buildBus(deps, logPathFor(state))
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
        runPostReviewToGate: (d, reviewResult, version) => runPostReviewToGate(env, d, reviewResult, version),
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

function runPostReviewToGate(
  env: PipelineEnv,
  depth: DepthProfile,
  reviewResult: ReviewLoopResult,
  version: number = 1,
): Promise<RunStartResult> {
  const { deps, state, ctx, agent } = env
  if (isSeverityConverged(reviewResult)) {
    return runPostConvergenceTail({ deps, state, ctx, agent, depth, reviewResult, version })
  }
  if (reviewResult.outcome === 'cap-hit') return presentGateAt(deps, state, ctx, reviewResult, version, 'early')
  return runPostConvergenceTail({ deps, state, ctx, agent, depth, reviewResult, version })
}

/**
 * Severity-based convergence (orchestrator-level verdict): a cap-hit round
 * with zero open BLOCKERs and zero open MATERIALs — nitpicks only, each
 * resolved or dismissed — is treated as converged and flows into decompose
 * without an early gate. Blockers/materials still force the early gate.
 */
function isSeverityConverged(reviewResult: ReviewLoopResult): boolean {
  return (
    reviewResult.outcome === 'cap-hit' &&
    reviewResult.openBlockers.length === 0 &&
    reviewResult.openMaterial.length === 0
  )
}

async function runPlanningStages(
  env: PipelineEnv,
  stop?: CalmStopController,
): Promise<{ depth: DepthProfile; reviewResult: ReviewLoopResult }> {
  const { deps, state } = env
  const depth = await runIntakeStage(env)
  await saveRunState(state, nowOf(deps))
  await runDraftStage(env, depth)
  state.stage = 'draft'
  await saveRunState(state, nowOf(deps))
  const reviewResult = await runReviewStage(env, depth, env.input.taskText, {}, stop)
  state.stage = 'review'
  await saveRunState(state, nowOf(deps))
  return { depth, reviewResult }
}

async function runIntakeStage(env: PipelineEnv): Promise<DepthProfile> {
  const { deps, state, machine, agent, ctx, input } = env
  let depth: DepthProfile = input.depthOverride ?? 'S'
  await machine.runStage('intake', async () => {
    const result = await runIntake(
      { driver: deps.driver, agent, emit: ctx.emit, sidecarDir: ctx.sidecarDir, runDir: state.runDir, cwd: ctx.cwd },
      { changeName: input.changeName, taskText: input.taskText, depthOverride: input.depthOverride },
    )
    if (result.kind === 'plan') {
      throw new Error(`intake ruled ${input.changeName} oversize; the plan branch is not wired into runStart yet`)
    }
    depth = result.depth
    state.depth = depth
    state.roundCap = resolveRoundCap({ depth, roundCap: undefined })
  })
  return depth
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

async function runReviewStage(
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
