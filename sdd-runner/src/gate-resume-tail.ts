// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { rowsOf } from './children.js'
import { buildDriftCheck } from './drift.js'
import type { GateResumeContext, RunGateResumeResult } from './extend-round.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { finalizeGate, nowOf, presentGateAt } from './gate-digest.js'
import { PLAN_REVIEW_SURROGATE } from './gate-prelude.js'
import { runPlanner } from './intake.js'
import { materializeChildFiles, planDigest, PlanSchema } from './plan.js'
import type { PlanChild } from './plan.js'
import { runPostConvergenceTail } from './post-review-tail.js'
import type { ReviewLoopResult } from './review-loop.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { narrowGateMode } from './run-state.js'
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
  await presentGateAt(deps, state, stageCtx, reviewResult, next, narrowGateMode(state.gate?.mode ?? 'final'), {
    skipPolicy: true,
  })
  return { runId: state.runId, outcome: 'veto', version: next }
}

/** Map `C<n>` veto ids to their plan child ids for the replan redirects. */
function childIdsOf(state: RunState): readonly string[] {
  return state.plan?.childIds ?? []
}

function redirectLines(
  vetoes: readonly { readonly id: string; readonly redirect?: string }[],
  childIds: readonly string[],
): string[] {
  return vetoes.map((veto) => {
    const childId = veto.id.startsWith('C') ? (childIds[Number(veto.id.slice(1)) - 1] ?? veto.id) : veto.id
    const guidance = veto.redirect ?? '(vetoed without a redirect)'
    return `${childId}: ${guidance}`
  })
}

function taskTextOf(children: readonly PlanChild[]): string {
  return children.map((child) => `- ${child.id}: ${child.instruction} (deps: ${child.deps.join(', ')})`).join('\n')
}

/**
 * D6 plan-gate veto settle — one re-plan per veto round, unbounded rounds:
 * re-run `runPlanner` with the round's redirects (replan bound inside),
 * re-materialize wholesale, emit a fresh `plan` event (the replay fold resets
 * `children` on it), update `state.plan`, and re-present at `gate-<n+1>.md`
 * with `skipPolicy: true` — the settled round never re-runs the ladder.
 * Approve and ABORT are the only terminals.
 */
export async function settlePlanVeto(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  vetoes: readonly { readonly id: string; readonly redirect?: string }[],
  version: number,
): Promise<RunGateResumeResult> {
  const agent: AgentLayerDeps = { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit }
  const current = PlanSchema.parse(JSON.parse(await readFile(path.join(ctx.sidecarDir, 'plan.json'), 'utf8')))
  const redirects = redirectLines(vetoes, childIdsOf(state))
  const ordered = await runPlanner(
    { driver: deps.driver, agent, emit: ctx.emit, sidecarDir: ctx.sidecarDir, runDir: state.runDir, cwd: ctx.cwd },
    {
      changeName: state.changeName,
      taskText: `Revise this plan:\n${taskTextOf(current.children)}`,
      redirects,
    },
  )
  await materializeChildFiles({ children: ordered }, state.runDir)
  const digest = planDigest(ordered)
  ctx.emit({ altitude: 'L2', type: 'plan', childCount: ordered.length, digest })
  state.plan = { childIds: ordered.map((child) => child.id), digest }
  const seeded: Record<string, { status: 'pending' }> = {}
  for (const child of ordered) seeded[child.id] = { status: 'pending' }
  state.children = seeded
  await saveRunState(state, nowOf(deps))
  const next = version + 1
  await presentGateAt(deps, state, ctx, PLAN_REVIEW_SURROGATE, next, 'plan', {
    children: rowsOf(ordered),
    skipPolicy: true,
  })
  return { runId: state.runId, outcome: 'veto', version: next }
}
