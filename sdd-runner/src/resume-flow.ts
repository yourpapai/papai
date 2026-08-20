// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdirSync } from 'node:fs'

import type { AgentLayerDeps } from './agent-layer.js'
import type { DepthProfile } from './events.js'
import type { EventInput } from './events.js'
import { logPathFor, nowOf, readReviewResultFromSidecars } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { runPostConvergenceTail } from './post-review-tail.js'
import { replayEvents } from './replay.js'
import { resolveResumeDecision } from './resume-decision.js'
import type { ResumeDecision } from './resume-decision.js'
import type { ReviewLoopResult } from './review-loop.js'
import { resolveRoundCap, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { readSessionLedger } from './session-ledger.js'
import type { CalmStopController } from './stop-controller.js'

/** The orchestrator-owned stage runners the resume flow drives. */
export interface ResumeStageRunners {
  readonly runReviewStage: (
    depth: DepthProfile,
    entry: {
      readonly startRound?: number
      readonly cap?: number
      readonly resumeSession?: ResumeDecision['session']
    },
  ) => Promise<ReviewLoopResult>
  readonly runPostReviewToGate: (
    depth: DepthProfile,
    reviewResult: ReviewLoopResult,
    version?: number,
  ) => Promise<RunStartResult>
}

/** The pipeline environment pieces the resume flow needs. */
export interface ResumeEnv {
  readonly deps: OrchestratorDeps
  readonly state: RunState
  readonly ctx: StageContext
  readonly agent: AgentLayerDeps
  /** Calm-stop seam consulted between rounds/stages (D6). */
  readonly stop?: { readonly stopRequested: () => boolean }
}

export function nextGateVersion(state: RunState): number {
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

export async function resumeFromPoint(
  env: ResumeEnv,
  runners: ResumeStageRunners,
  decision: ResumeDecision,
  depth: DepthProfile,
): Promise<RunStartResult> {
  const { deps, state } = env
  const runId = state.runId
  if (decision.stage === 'review') {
    const continuation =
      decision.path === 'session-continuation' && decision.session !== undefined ? decision.session : undefined
    const startRound = continuation === undefined ? 1 : Math.max(decision.round, 1)
    const reviewResult = await runners.runReviewStage(depth, {
      startRound,
      cap: Math.max(resolveRoundCap(state), startRound),
      resumeSession: continuation,
    })
    state.stage = 'review'
    await saveRunState(state, nowOf(deps))
    const gate = await runners.runPostReviewToGate(depth, reviewResult)
    return { runId, halted: 'gate', gateMdPath: gate.gateMdPath, version: gate.version }
  }
  if (decision.stage === 'decompose' || decision.stage === 'atomicity' || decision.stage === 'gate') {
    const reviewResult = await readReviewResultFromSidecars(
      env.ctx.sidecarDir,
      state.round,
      decision.stage === 'gate' ? 'converged' : 'cap-hit',
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
  throw new Error(`resume from stage '${decision.stage}' (${decision.reason}) is not supported yet`)
}

/**
 * Calm-stop settlement (D6): if a stop was requested and honored, consume the
 * marker, record `status: stopped`, and report the stopped halt instead of a
 * gate halt — the run stays resumable.
 */
export async function settleStoppedResult<T extends { readonly runId: string; readonly halted: string }>(
  deps: OrchestratorDeps,
  state: RunState,
  stop: CalmStopController,
  result: T,
): Promise<T | { readonly runId: string; readonly halted: 'stopped' }> {
  if (!stop.stopRequested()) return result
  stop.consumeMarker()
  if (state.status !== 'stopped') {
    state.status = 'stopped'
    await saveRunState(state, nowOf(deps))
  }
  deps.stdout?.(`run ${state.runId} stopped calmly — resume with sdd-runner resume ${state.runId}`)
  return { runId: state.runId, halted: 'stopped' }
}

/** Resolve the D2 resume decision: artifact-first, session-second, rebuild-last. */
export async function deriveResumeDecision(
  deps: OrchestratorDeps,
  state: RunState,
): Promise<ReturnType<typeof resolveResumeDecision>> {
  const status = await deps.driver.status(state.changeName)
  return resolveResumeDecision(
    state,
    status.artifacts,
    replayEvents(logPathFor(state)),
    readSessionLedger(state.runDir),
  )
}

export function reportResumeDecision(
  deps: OrchestratorDeps,
  emit: (event: EventInput) => void,
  decision: ReturnType<typeof resolveResumeDecision>,
): void {
  emit({
    altitude: 'L2',
    type: 'resume',
    path: decision.path,
    stage: decision.stage,
    ...(decision.session === undefined ? {} : { session: decision.session.opencodeSessionId }),
  })
  deps.stdout?.(
    `resume: ${decision.path}${decision.session === undefined ? '' : ` (session ${decision.session.opencodeSessionId})`}`,
  )
}
