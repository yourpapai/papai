// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { deriveChangeName } from './config.js'
import { runAtomicity, runDecompose } from './decompose.js'
import { runDraft } from './draft.js'
import type { DepthProfile, EventInput } from './events.js'
import {
  applyConfirmAll,
  buildBus,
  buildDriftCheck,
  finalizeGate,
  findingsOf,
  gatherAssumptions,
  logPathFor,
  nowOf,
  presentGateAt,
  readReviewResultFromSidecars,
} from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { resumeGate, vetoRedirects } from './gate.js'
import { runIntake } from './intake.js'
import { createMaterializer } from './materialize.js'
import type { Verbosity } from './renderer.js'
import { replayEvents } from './replay.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { createRunState, loadRunState, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { deriveResumePoint } from './run-state.js'
import { createStageMachine } from './stage-machine.js'
import { runVetoUpdater, updateAssumptionsFromVetoes } from './veto-updater.js'

export type { OrchestratorDeps, RunStartResult } from './gate-digest.js'

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

interface FreshInput {
  readonly taskText: string
  readonly changeName: string
  readonly depthOverride?: DepthProfile
}

export async function runStart(deps: OrchestratorDeps, options: StartOptions): Promise<RunStartResult> {
  const taskText = await readFile(options.taskFile, 'utf8')
  const changeName = deriveChangeName(options.taskFile, taskText)
  const state = await createRunState(
    { workDir: deps.config.workDir, repoRoot: deps.config.repoRoot, changeName },
    nowOf(deps),
  )
  const emit = buildBus(deps, logPathFor(state))
  return runFreshPipeline(deps, state, emit, { taskText, changeName, depthOverride: options.depthOverride })
}

export async function runResume(deps: OrchestratorDeps, runId: string): Promise<RunResumeResult> {
  const state = await loadRunState(deps.config.workDir, runId)
  const emit = buildBus(deps, logPathFor(state))
  if (state.gate !== null) return { runId, halted: 'gate-pending' }
  const status = await deps.driver.status(state.changeName)
  const resume = deriveResumePoint(state, status.artifacts, replayEvents(logPathFor(state)))
  const depth = state.depth ?? 'S'
  const cwd = deps.config.repoRoot
  const sidecarDir = path.join(state.runDir, 'sidecars')
  const changeDir = path.join(cwd, 'openspec', 'changes', state.changeName)
  const machine = createStageMachine({ emit })
  const agent: AgentLayerDeps = { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit }
  const ctx: StageContext = { cwd, changeDir, sidecarDir, emit }
  const env: PipelineEnv = {
    deps,
    state,
    machine,
    agent,
    ctx,
    input: { changeName: state.changeName, depthOverride: depth, taskText: '' },
  }
  if (resume.stage !== 'review') {
    throw new Error(`resume from stage '${resume.stage}' (${resume.reason}) is not supported yet`)
  }
  const materialize = createMaterializer(sidecarDir, changeDir)
  let reviewResult!: ReviewLoopResult
  await machine.runStage('review', async () => {
    reviewResult = await runReviewLoop(
      { agent, emit, sidecarDir, cwd, materialize },
      { changeName: state.changeName, changeDir, depth, taskText: '', conventions: deps.conventions ?? '' },
    )
    state.round = reviewResult.rounds
  })
  state.stage = 'review'
  await saveRunState(state, nowOf(deps))
  const gate = await runPostReviewToGate(env, depth, reviewResult)
  return { runId, halted: 'gate', gateMdPath: gate.gateMdPath, version: gate.version }
}

interface FreshInput {
  readonly taskText: string
  readonly changeName: string
  readonly depthOverride?: DepthProfile
}

async function runFreshPipeline(
  deps: OrchestratorDeps,
  state: RunState,
  emit: (event: EventInput) => void,
  input: FreshInput,
): Promise<RunStartResult> {
  const cwd = deps.config.repoRoot
  const sidecarDir = path.join(state.runDir, 'sidecars')
  const changeDir = path.join(cwd, 'openspec', 'changes', input.changeName)
  const machine = createStageMachine({ emit })
  const agent: AgentLayerDeps = { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit }
  const ctx: StageContext = { cwd, changeDir, sidecarDir, emit }
  const env: PipelineEnv = { deps, state, machine, agent, ctx, input }
  const { depth, reviewResult } = await runPlanningStages(env)
  return runPostReviewToGate(env, depth, reviewResult)
}

async function runPostReviewToGate(
  env: PipelineEnv,
  depth: DepthProfile,
  reviewResult: ReviewLoopResult,
): Promise<RunStartResult> {
  const { deps, state, machine, ctx } = env
  if (reviewResult.outcome === 'cap-hit') return presentGateAt(deps, state, ctx, reviewResult, 1, 'early')
  await runDecomposeStages(env, depth)
  state.stage = 'gate'
  let gateResult!: RunStartResult
  await machine.runStage('gate', async () => {
    gateResult = await presentGateAt(deps, state, ctx, reviewResult, 1, 'final')
  })
  return gateResult
}

interface PipelineEnv {
  readonly deps: OrchestratorDeps
  readonly state: RunState
  readonly machine: ReturnType<typeof createStageMachine>
  readonly agent: AgentLayerDeps
  readonly ctx: StageContext
  readonly input: FreshInput
}

async function runPlanningStages(env: PipelineEnv): Promise<{ depth: DepthProfile; reviewResult: ReviewLoopResult }> {
  const { deps, state, machine, agent, ctx, input } = env
  let depth: DepthProfile = input.depthOverride ?? 'S'
  await machine.runStage('intake', async () => {
    const result = await runIntake(
      { driver: deps.driver, agent, emit: ctx.emit, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
      { changeName: input.changeName, taskText: input.taskText, depthOverride: input.depthOverride },
    )
    depth = result.depth
    state.depth = depth
  })
  await saveRunState(state, nowOf(deps))
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
  state.stage = 'draft'
  await saveRunState(state, nowOf(deps))
  const materialize = createMaterializer(ctx.sidecarDir, ctx.changeDir)
  let reviewResult!: ReviewLoopResult
  await machine.runStage('review', async () => {
    reviewResult = await runReviewLoop(
      { agent, emit: ctx.emit, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd, materialize },
      {
        changeName: input.changeName,
        changeDir: ctx.changeDir,
        depth,
        taskText: input.taskText,
        conventions: deps.conventions ?? '',
      },
    )
    state.round = reviewResult.rounds
  })
  state.stage = 'review'
  await saveRunState(state, nowOf(deps))
  return { depth, reviewResult }
}

async function runDecomposeStages(env: PipelineEnv, depth: DepthProfile): Promise<void> {
  const { deps, state, machine, agent, ctx, input } = env
  await machine.runStage('decompose', () =>
    runDecompose(
      { driver: deps.driver, agent, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
      { changeName: input.changeName },
    ),
  )
  state.stage = 'decompose'
  await saveRunState(state, nowOf(deps))
  if (depth !== 'S') {
    await machine.runStage('atomicity', async () => {
      await runAtomicity(
        { driver: deps.driver, agent, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
        { changeName: input.changeName, depth },
      )
    })
    state.stage = 'atomicity'
    await saveRunState(state, nowOf(deps))
  }
}

export interface GateResumeOptions {
  readonly confirmAll?: boolean
  readonly abort?: boolean
}

export interface RunGateResumeResult {
  readonly runId: string
  readonly outcome: 'approved' | 'aborted' | 'veto'
  readonly version: number
}

async function prepareResumeInput(
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

export async function runGateResume(
  deps: OrchestratorDeps,
  runId: string,
  options: GateResumeOptions,
): Promise<RunGateResumeResult> {
  const state = await loadRunState(deps.config.workDir, runId)
  if (state.gate === null) throw new Error(`run ${runId} is not gate-pending`)
  const emit = buildBus(deps, logPathFor(state))
  const version = state.gate.version
  const changeDir = path.join(deps.config.repoRoot, 'openspec', 'changes', state.changeName)
  const sidecarDir = path.join(state.runDir, 'sidecars')
  const gateMdPath = path.join(state.runDir, `gate-${version}.md`)
  if (options.abort === true) await writeFile(gateMdPath, 'ABORT\n')
  else if (options.confirmAll === true) await applyConfirmAll(gateMdPath)
  const { assumptions, reviewResult, requiredAck } = await prepareResumeInput(sidecarDir, state.round, state.gate.mode)
  const findings = findingsOf(reviewResult)
  const agent: AgentLayerDeps = { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit }
  const outcome = await resumeGate(
    {
      emit,
      runDir: state.runDir,
      changeDir,
      driftCheck: buildDriftCheck(agent, state, changeDir, sidecarDir, deps.config.repoRoot),
    },
    {
      version,
      assumptions,
      blockers: findings.blockers,
      ...(findings.material.length > 0 ? { findings: findings.material } : {}),
      ...(requiredAck === undefined ? {} : { requiredAck }),
    },
  )
  if (outcome.kind === 'aborted') return finalizeGate(deps, state, 'aborted', version)
  if (outcome.kind === 'approved') return finalizeGate(deps, state, 'completed', version)
  const vetoes = vetoRedirects(outcome)
  const ctx: StageContext = { cwd: deps.config.repoRoot, changeDir, sidecarDir, emit }
  await updateAssumptionsFromVetoes(sidecarDir, state.round, vetoes)
  const driftCheck = buildDriftCheck(agent, state, changeDir, sidecarDir, deps.config.repoRoot)
  const { filesUpdated } = await runVetoUpdater({ driver: deps.driver, agent }, state, ctx, vetoes)
  const driftFiles = filesUpdated.filter((file) => file.includes('specs/') || file.endsWith('tasks.md'))
  if (driftFiles.length > 0) await driftCheck(driftFiles)
  const next = version + 1
  await presentGateAt(deps, state, ctx, reviewResult, next, state.gate.mode)
  return { runId, outcome: 'veto', version: next }
}
