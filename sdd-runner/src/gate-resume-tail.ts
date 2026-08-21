// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildDriftCheck } from './drift.js'
import type { GateResumeContext, RunGateResumeResult } from './extend-round.js'
import { finalizeGate, presentGateAt } from './gate-digest.js'
import type { StageContext } from './gate-digest.js'
import { runPostConvergenceTail } from './post-review-tail.js'
import type { ReviewLoopResult } from './review-loop.js'
import { runVetoUpdater, updateAssumptionsFromVetoes } from './veto-updater.js'

export async function settleApprovedGate(
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

export async function settleVeto(
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
  await presentGateAt(deps, state, stageCtx, reviewResult, next, state.gate?.mode ?? 'final', { skipPolicy: true })
  return { runId: state.runId, outcome: 'veto', version: next }
}
