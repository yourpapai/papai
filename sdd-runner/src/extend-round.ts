// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { buildDriftCheck } from './drift.js'
import type { EventInput } from './events.js'
import {
  applyConfirmAll,
  buildBus,
  finalizeGate,
  findingsOf,
  gatherAssumptions,
  logPathFor,
  nowOf,
  presentGateAt,
  readReviewResultFromSidecars,
} from './gate-digest.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { resumeGate, vetoRedirects } from './gate.js'
import { createMaterializer } from './materialize.js'
import { runPostConvergenceTail } from './post-review-tail.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { loadRunState, resolveRoundCap, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { runVetoUpdater, updateAssumptionsFromVetoes } from './veto-updater.js'

export interface RunGateResumeResult {
  readonly runId: string
  readonly outcome: 'approved' | 'aborted' | 'veto' | 'extend'
  readonly version: number
  readonly gateMdPath?: string
}

export interface GateResumeOptions {
  readonly confirmAll?: boolean
  readonly abort?: boolean
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
  const extendResult = await runExtendedReview(deps, state, agent, emit, { changeDir, sidecarDir, depth })
  const ctx: StageContext = { cwd, changeDir, sidecarDir, emit }
  const next = version + 1
  if (extendResult.outcome === 'cap-hit') {
    const gate = await presentGateAt(deps, state, ctx, extendResult, next, 'early')
    return { runId: state.runId, outcome: 'extend', version: next, gateMdPath: gate.gateMdPath }
  }
  const gate = await runPostConvergenceTail({
    deps,
    state,
    ctx,
    agent,
    depth,
    reviewResult: extendResult,
    version: next,
  })
  return { runId: state.runId, outcome: 'extend', version: next, gateMdPath: gate.gateMdPath }
}

async function runExtendedReview(
  deps: OrchestratorDeps,
  state: RunState,
  agent: AgentLayerDeps,
  emit: (event: EventInput) => void,
  paths: { changeDir: string; sidecarDir: string; depth: 'S' | 'M' | 'L' },
): Promise<ReviewLoopResult> {
  const { changeDir, sidecarDir, depth } = paths
  const materialize = createMaterializer(sidecarDir, changeDir)
  const extendResult = await runReviewLoop(
    { agent, emit, sidecarDir, cwd: deps.config.repoRoot, materialize },
    { changeName: state.changeName, changeDir, depth, taskText: '', conventions: deps.conventions ?? '' },
    { startRound: state.round + 1, cap: state.roundCap },
  )
  state.round = extendResult.rounds
  state.stage = 'review'
  await saveRunState(state, nowOf(deps))
  return extendResult
}

export interface GateResumeContext {
  readonly deps: OrchestratorDeps
  readonly state: RunState
  readonly emit: (event: EventInput) => void
  readonly version: number
  readonly changeDir: string
  readonly sidecarDir: string
  readonly agent: AgentLayerDeps
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
  const ctx: GateResumeContext = { deps, state, emit, version, changeDir, sidecarDir, agent }
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
      gateMode: state.gate.mode,
      ...(findings.material.length > 0 ? { findings: findings.material } : {}),
      ...(requiredAck === undefined ? {} : { requiredAck }),
    },
  )
  if (outcome.kind === 'aborted') return finalizeGate(deps, state, 'aborted', version)
  if (outcome.kind === 'approved') return settleApprovedGate(ctx, reviewResult)
  if (outcome.kind === 'extend') return runExtendRound(deps, state, emit, agent, version)
  return settleVeto(ctx, reviewResult, vetoRedirects(outcome))
}

async function settleApprovedGate(
  ctx: GateResumeContext,
  reviewResult: ReviewLoopResult,
): Promise<RunGateResumeResult> {
  const { deps, state, emit, version, changeDir, sidecarDir, agent } = ctx
  if (state.gate?.mode === 'early') {
    const stageCtx: StageContext = { cwd: deps.config.repoRoot, changeDir, sidecarDir, emit }
    const gate = await runPostConvergenceTail({
      deps,
      state,
      ctx: stageCtx,
      agent,
      depth: state.depth ?? 'S',
      reviewResult,
      version: version + 1,
    })
    return { runId: state.runId, outcome: 'approved', version: gate.version, gateMdPath: gate.gateMdPath }
  }
  return finalizeGate(deps, state, 'completed', version)
}

async function settleVeto(
  ctx: GateResumeContext,
  reviewResult: ReviewLoopResult,
  vetoes: readonly { readonly id: string; readonly redirect?: string }[],
): Promise<RunGateResumeResult> {
  const { deps, state, emit, version, changeDir, sidecarDir, agent } = ctx
  const stageCtx: StageContext = { cwd: deps.config.repoRoot, changeDir, sidecarDir, emit }
  await updateAssumptionsFromVetoes(sidecarDir, state.round, vetoes)
  const driftCheck = buildDriftCheck(agent, state, changeDir, sidecarDir, deps.config.repoRoot)
  const { filesUpdated } = await runVetoUpdater({ driver: deps.driver, agent }, state, stageCtx, vetoes)
  const driftFiles = filesUpdated.filter((file) => file.includes('specs/') || file.endsWith('tasks.md'))
  if (driftFiles.length > 0) await driftCheck(driftFiles)
  const next = version + 1
  await presentGateAt(deps, state, stageCtx, reviewResult, next, state.gate?.mode ?? 'final')
  return { runId: state.runId, outcome: 'veto', version: next }
}
