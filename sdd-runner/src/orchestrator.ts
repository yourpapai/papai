// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { deriveChangeName } from './config.js'
import { runDraft } from './draft.js'
import type { DepthProfile, EventInput } from './events.js'
import { runGateResume } from './extend-round.js'
import { buildBus, logPathFor, nowOf, presentGateAt, readReviewResultFromSidecars } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { runIntake } from './intake.js'
import { createMaterializer } from './materialize.js'
import { runPostConvergenceTail } from './post-review-tail.js'
import type { Verbosity } from './renderer.js'
import { replayEvents } from './replay.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import {
  createRunState,
  listPendingGates,
  loadRunState,
  resolveRoundCap,
  resolveRunId,
  saveRunState,
} from './run-state.js'
import type { RunState } from './run-state.js'
import { deriveResumePoint } from './run-state.js'
import { createStageMachine } from './stage-machine.js'

export type { OrchestratorDeps, RunStartResult } from './gate-digest.js'
export type { GateResumeOptions, RunGateResumeResult } from './extend-round.js'
export { runGateResume } from './extend-round.js'

export interface StartOptions {
  readonly taskFile: string
  readonly depthOverride?: DepthProfile
  readonly verbosity?: Verbosity
}

export interface RunResumeResult {
  readonly runId: string
  readonly halted: 'gate' | 'gate-pending'
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
  const taskText = await readFile(options.taskFile, 'utf8')
  const changeName = deriveChangeName(options.taskFile, taskText)
  const state = await createRunState(
    { workDir: deps.config.workDir, repoRoot: deps.config.repoRoot, changeName },
    nowOf(deps),
  )
  const emit = buildBus(deps, logPathFor(state))
  const env = buildPipelineEnv(deps, state, emit, {
    taskText,
    changeName,
    depthOverride: options.depthOverride,
  })
  const { depth, reviewResult } = await runPlanningStages(env)
  return runPostReviewToGate(env, depth, reviewResult)
}

export async function runResume(deps: OrchestratorDeps, runId: string): Promise<RunResumeResult> {
  const state = await loadRunState(deps.config.workDir, runId)
  if (state.gate !== null) {
    deps.stdout?.(`run ${runId} awaits a gate decision (gate ${state.gate.version}, ${state.gate.mode})`)
    deps.stdout?.(`sdd-runner gate resume ${runId}`)
    return { runId, halted: 'gate-pending' }
  }
  const emit = buildBus(deps, logPathFor(state))
  const status = await deps.driver.status(state.changeName)
  const resume = deriveResumePoint(state, status.artifacts, replayEvents(logPathFor(state)))
  const depth = state.depth ?? 'S'
  const env = buildPipelineEnv(deps, state, emit, { taskText: '', changeName: state.changeName, depthOverride: depth })
  if (resume.stage === 'review') {
    const reviewResult = await runReviewStage(env, depth, '')
    state.stage = 'review'
    await saveRunState(state, nowOf(deps))
    const gate = await runPostReviewToGate(env, depth, reviewResult)
    return { runId, halted: 'gate', gateMdPath: gate.gateMdPath, version: gate.version }
  }
  if (resume.stage === 'decompose' || resume.stage === 'atomicity' || resume.stage === 'gate') {
    const reviewResult = await readReviewResultFromSidecars(
      env.ctx.sidecarDir,
      state.round,
      resume.stage === 'gate' ? 'converged' : 'cap-hit',
    )
    const reviewSettled = replayEvents(logPathFor(state)).gate?.answered === true
    const outcome = reviewSettled ? 'converged' : reviewResult.outcome
    const settledResult: ReviewLoopResult = { ...reviewResult, outcome }
    const version = nextGateVersion(state)
    const gate = await runPostConvergenceTail({
      deps,
      state,
      ctx: env.ctx,
      agent: env.agent,
      depth,
      reviewResult: settledResult,
      version,
    })
    return { runId, halted: 'gate', gateMdPath: gate.gateMdPath, version: gate.version }
  }
  throw new Error(`resume from stage '${resume.stage}' (${resume.reason}) is not supported yet`)
}

/**
 * `continue` is a pure router (Decision 4): gate-pending → the gate flow
 * (`runGateResume` with no flags — interactive session on a TTY, hand-edited
 * file otherwise); interrupted mid-stage → `runResume`; completed → a pointer
 * to the report. Without an id, discovery picks the single pending/active
 * run, or lists the candidates when several exist.
 */
export async function runContinue(deps: OrchestratorDeps, runId: string | null): Promise<RunContinueResult> {
  if (runId === null) {
    const picked = await pickContinueRun(deps)
    if (picked === null) return { runId: null, routed: 'list' }
    return runContinue(deps, picked)
  }
  const resolved = await resolveRunId(deps.config.workDir, runId)
  const state = await loadRunState(deps.config.workDir, resolved)
  if (state.gate !== null) {
    const gate = await runGateResume(deps, resolved, {})
    return {
      runId: resolved,
      routed: 'gate',
      ...(gate.gateMdPath === undefined ? {} : { gateMdPath: gate.gateMdPath, version: gate.version }),
    }
  }
  if (state.status === 'completed') {
    deps.stdout?.(`run ${resolved} is completed — report: sdd-runner report ${resolved}`)
    return { runId: resolved, routed: 'report' }
  }
  const resumed = await runResume(deps, resolved)
  return {
    runId: resolved,
    routed: 'resume',
    ...(resumed.gateMdPath === undefined ? {} : { gateMdPath: resumed.gateMdPath, version: resumed.version }),
  }
}

/**
 * Discovery for a bare `continue`: exactly one gate-pending run routes to it;
 * several print the per-run gate commands and route nowhere (the operator
 * picks); none is an error (there is nothing obvious to continue).
 */
async function pickContinueRun(deps: OrchestratorDeps): Promise<string | null> {
  const pending = await listPendingGates(deps.config.workDir)
  if (pending.length === 1) return pending[0]?.runId ?? null
  if (pending.length > 1) {
    deps.stdout?.('several runs await gate decisions:')
    for (const entry of pending) {
      deps.stdout?.(`  sdd-runner gate resume ${entry.runId}  (${entry.changeName}, gate v${entry.gateVersion})`)
    }
    return null
  }
  throw new Error('no gate-pending runs found — pass a run id, or use `sdd-runner resume <runId>`')
}

function nextGateVersion(state: RunState): number {
  const versions = [0]
  try {
    for (const entry of readdirSync(state.runDir)) {
      const match = entry.match(/^gate-(\d+)\.md$/u)
      if (match !== null) versions.push(Number(match[1]))
    }
  } catch {
    // run dir unreadable — start at 1
  }
  return Math.max(...versions) + 1
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
  return { deps, state, machine, agent, ctx, input }
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

async function runPlanningStages(env: PipelineEnv): Promise<{ depth: DepthProfile; reviewResult: ReviewLoopResult }> {
  const { deps, state } = env
  const depth = await runIntakeStage(env)
  await saveRunState(state, nowOf(deps))
  await runDraftStage(env, depth)
  state.stage = 'draft'
  await saveRunState(state, nowOf(deps))
  const reviewResult = await runReviewStage(env, depth, env.input.taskText)
  state.stage = 'review'
  await saveRunState(state, nowOf(deps))
  return { depth, reviewResult }
}

async function runIntakeStage(env: PipelineEnv): Promise<DepthProfile> {
  const { deps, state, machine, agent, ctx, input } = env
  let depth: DepthProfile = input.depthOverride ?? 'S'
  await machine.runStage('intake', async () => {
    const result = await runIntake(
      { driver: deps.driver, agent, emit: ctx.emit, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
      { changeName: input.changeName, taskText: input.taskText, depthOverride: input.depthOverride },
    )
    depth = result.depth
    state.depth = depth
    state.roundCap = resolveRoundCap({ depth, roundCap: undefined })
  })
  return depth
}

async function runDraftStage(env: PipelineEnv, depth: DepthProfile): Promise<void> {
  const { deps, machine, agent, ctx, input } = env
  await machine.runStage('draft', () =>
    runDraft(
      {
        driver: deps.driver,
        agent,
        logPath: path.join(ctx.sidecarDir, 'logs'),
        sidecarDir: ctx.sidecarDir,
        cwd: ctx.cwd,
      },
      { changeName: input.changeName, taskText: input.taskText, depth },
    ),
  )
}

async function runReviewStage(env: PipelineEnv, depth: DepthProfile, taskText: string): Promise<ReviewLoopResult> {
  const { deps, state, machine, agent, ctx, input } = env
  const materialize = createMaterializer(ctx.sidecarDir, ctx.changeDir)
  let reviewResult!: ReviewLoopResult
  await machine.runStage('review', async () => {
    reviewResult = await runReviewLoop(
      { agent, emit: ctx.emit, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd, materialize },
      {
        changeName: input.changeName,
        changeDir: ctx.changeDir,
        depth,
        taskText,
        conventions: deps.conventions ?? '',
      },
    )
    state.round = reviewResult.rounds
  })
  return reviewResult
}
