// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { shouldEnterWaiter } from './deadline-waiter.js'
import { buildDriftCheck } from './drift.js'
import type { EventInput } from './events.js'
// prettier-ignore is not allowed; oxfmt keeps this single line under 110 chars
import {
  buildBus,
  finalizeGate,
  findingsOf,
  logPathFor,
  nowOf,
  prepareResumeInput,
  presentGateAt,
} from './gate-digest.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import type { GateAssumption, GateFinding } from './gate-model.js'
import { settleApprovedGate, settleVeto } from './gate-resume-tail.js'
export { settleApprovedGate } from './gate-resume-tail.js'
import { desugarFlags } from './gate-session.js'
import type { GateSessionView } from './gate-session.js'
import { resumeGate, vetoRedirects } from './gate.js'
import type { GateOutcome } from './gate.js'
import { createMaterializer } from './materialize.js'
import { runPostConvergenceTail } from './post-review-tail.js'
import type { Verbosity } from './renderer.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { loadRunState, narrowGateMode, resolveRoundCap, saveRunState, steerSeamFor } from './run-state.js'
import type { RunState } from './run-state.js'
import { runTuiGateSession } from './tui-gate-session.js'

export interface RunGateResumeResult {
  readonly runId: string
  readonly outcome: 'approved' | 'aborted' | 'veto' | 'extend' | 'abandoned'
  readonly version: number
  readonly gateMdPath?: string
}

export interface GateResumeOptions {
  readonly confirmAll?: boolean
  readonly abort?: boolean
  readonly extend?: boolean
  readonly waitDeadline?: boolean
  readonly noWait?: boolean
  readonly verbosity?: Verbosity
  readonly vetoes?: readonly { readonly id: string; readonly redirect?: string }[]
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
  const materialize = createMaterializer(sidecarDir, changeDir, emit, deps.config.repoRoot)
  const extendResult = await runReviewLoop(
    {
      agent,
      emit,
      runDir: state.runDir,
      sidecarDir,
      cwd: deps.config.repoRoot,
      materialize,
      steer: steerSeamFor(state, (line) => deps.stdout?.(`steer: ${line}`)),
    },
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

function buildSessionView(
  state: RunState,
  gateMode: 'early' | 'final',
  assumptions: readonly GateAssumption[],
  findings: { blockers: GateFinding[]; material: GateFinding[] },
  requiredAck: string | undefined,
): GateSessionView {
  return {
    gateMode,
    items: [
      ...findings.material.map((finding) => ({
        kind: 'finding' as const,
        id: finding.id,
        text: finding.gap,
        evidence: finding.evidence,
        blastRadius: '',
      })),
      ...assumptions.map((assumption) => ({
        kind: 'assumption' as const,
        id: assumption.id,
        text: assumption.text,
        evidence: '',
        blastRadius: assumption.blast_radius,
      })),
    ],
    blockers: state.gate?.mode === 'early' ? findings.blockers : [],
    requiredAck: buildAck(requiredAck),
  }
}

const ACK_TEXT = 'I reviewed the trajectory and the open findings above'

function buildAck(requiredAck: string | undefined): { id: string; text: string } | null {
  const ack = requiredAck === undefined ? null : { id: requiredAck, text: ACK_TEXT }
  return ack
}

/**
 * Front half of the gate resume: TTY with no decision flags → TUI session
 * (abandoned sessions write nothing and short-circuit); decision flags →
 * flag desugaring; otherwise the hand-edited file path (no writes —
 * `resumeGate` parses whatever is on disk).
 */
async function collectGateDecision(
  deps: OrchestratorDeps,
  options: GateResumeOptions,
  view: GateSessionView,
  gateMdPath: string,
): Promise<boolean> {
  const hasDecisionFlags =
    options.abort === true ||
    options.confirmAll === true ||
    options.extend === true ||
    (options.vetoes?.length ?? 0) > 0
  if (hasDecisionFlags) {
    await desugarFlags(options, view, (md) => writeFile(gateMdPath, md))
    return true
  }
  const interactive = deps.interactive?.() === true
  if (interactive) {
    const session = await runTuiGateSession({
      view,
      writeGateMd: (md) => writeFile(gateMdPath, md),
      ...(deps.gateKeyScript === undefined ? {} : { keyScript: deps.gateKeyScript }),
    })
    if (session.status === 'abandoned') {
      deps.stdout?.('gate session abandoned — nothing written, the gate remains pending')
      return false
    }
  }
  return true
}

function collectGateOutcome(
  ctx: GateResumeContext,
  gateMode: 'early' | 'final',
  assumptions: readonly GateAssumption[],
  findings: { blockers: readonly GateFinding[]; material: readonly GateFinding[] },
  requiredAck: string | undefined,
): Promise<GateOutcome> {
  const { deps, state, emit, version, changeDir, sidecarDir, agent } = ctx
  return resumeGate(
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
      gateMode,
      ...(findings.material.length > 0 ? { findings: findings.material } : {}),
      ...(requiredAck === undefined ? {} : { requiredAck }),
    },
  )
}

export async function runGateResume(
  deps: OrchestratorDeps,
  runId: string,
  options: GateResumeOptions,
): Promise<RunGateResumeResult> {
  const state = await loadRunState(deps.config.workDir, runId)
  if (state.gate === null) throw new Error(`run ${runId} is not gate-pending`)
  const waiterEntry = await deadlineWaiterEntry(deps, state, options)
  if (waiterEntry !== null) return waiterEntry
  const emit = buildBus(deps, logPathFor(state))
  const version = state.gate.version
  const changeDir = path.join(deps.config.repoRoot, 'openspec', 'changes', state.changeName)
  const sidecarDir = path.join(state.runDir, 'sidecars')
  const gateMdPath = path.join(state.runDir, `gate-${version}.md`)
  const gateMode = narrowGateMode(state.gate.mode)
  const { assumptions, reviewResult, requiredAck } = await prepareResumeInput(sidecarDir, state.round, gateMode)
  const findings = findingsOf(reviewResult)
  const view = buildSessionView(state, gateMode, assumptions, findings, requiredAck)
  const proceed = await collectGateDecision(deps, options, view, gateMdPath)
  if (!proceed) return { runId: state.runId, outcome: 'abandoned', version }
  deps.mountRunScreen?.({ runDir: state.runDir, logPath: logPathFor(state) })
  try {
    const agent: AgentLayerDeps = { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit }
    const ctx: GateResumeContext = { deps, state, emit, version, changeDir, sidecarDir, agent }
    const outcome = await collectGateOutcome(ctx, gateMode, assumptions, findings, requiredAck)
    if (outcome.kind === 'aborted') return await finalizeGate(deps, state, 'aborted', version)
    if (outcome.kind === 'approved') return await settleApprovedGate(ctx, reviewResult)
    if (outcome.kind === 'extend') return await runExtendRound(deps, state, emit, agent, version)
    return await settleVeto(ctx, reviewResult, vetoRedirects(outcome))
  } finally {
    deps.unmountRunScreen?.()
  }
}

/** D11: return the waiter result when this invocation should wait, else null. */
async function deadlineWaiterEntry(
  deps: OrchestratorDeps,
  state: RunState,
  options: GateResumeOptions,
): Promise<RunGateResumeResult | null> {
  const wait = shouldEnterWaiter({
    isTty: deps.interactive?.() === true,
    deadlineAt: state.gateDeadlineAt,
    hasDecisionFlags:
      options.abort === true ||
      options.confirmAll === true ||
      options.extend === true ||
      (options.vetoes?.length ?? 0) > 0,
    noWait: options.noWait === true,
  })
  if (!wait && options.waitDeadline !== true) return null
  const { awaitGateDeadline } = await import('./deadline-waiter.js')
  return awaitGateDeadline(deps, state.runId, runGateResume)
}
