// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import path from 'node:path'

import { runChildren, runPlanBranch, planChildrenOf } from './children.js'
import type { RunChildRun } from './children.js'
import type { AutonomyConfig } from './config.js'
import type { EventInput } from './events.js'
import { readEvents } from './events.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { logPathFor, presentGateAt } from './gate-digest.js'
import { PLAN_REVIEW_SURROGATE } from './gate-prelude.js'
import { planGateRows } from './plan-gate-resume.js'
import type { PlanChild } from './plan.js'
import type { RunState } from './run-state.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'

/** The orchestrator-supplied nested-run starter (D7): `runStart` by default. */
export type StartChildRun = (
  deps: OrchestratorDeps,
  options: {
    readonly child: PlanChild
    readonly taskFile: string
    readonly spendBaselineUsd: number
    readonly onRunDirReady?: (childRunDir: string) => void
  },
) => Promise<{ readonly runId: string }>

export interface PlanResumeResult {
  readonly runId: string
  readonly halted: 'gate-pending' | 'stopped' | 'completed'
  /** The gate-pending child's runId (D2 routing) — threaded so every caller can route into the child's gate flow. */
  readonly childRunId?: string
}

/** A plan parent (D9): `state.plan` present, resumable while running or stopped. */
export function isPlanParentResume(state: RunState): boolean {
  return state.plan !== undefined && (state.status === 'running' || state.status === 'stopped')
}

/**
 * The earlier crash window (D9): a crash between the planner's sidecar
 * promotion (`sidecars/plan.json`) and `runPlanBranch`'s first
 * `saveRunState` leaves no persisted `state.plan`, so the plain
 * interception above misses it — yet the durable `depth oversize` verdict
 * plus the promoted sidecar carry everything the interrupted settle needs.
 */
export function isInterruptedPlanBranchResume(state: RunState): boolean {
  if (state.plan !== undefined || (state.status !== 'running' && state.status !== 'stopped')) return false
  if (!existsSync(path.join(state.runDir, 'sidecars', 'plan.json'))) return false
  const logPath = logPathFor(state)
  return existsSync(logPath) && readEvents(logPath).some((event) => event.type === 'depth' && event.oversize === true)
}

/**
 * D5 fail-closed resume: children may run only after the event log records a
 * plan-gate answer for the persisted plan. A crash between `runPlanBranch`'s
 * `state.plan` persist and the `state.gate` persist inside `presentGateAt`
 * leaves `{plan, pending children, running, gate: null}` — exactly the
 * plan-parent resume shape — so the durable log, not the gate field, decides.
 * `presentedVersion` carries an appended-but-unpersisted presentation so the
 * re-present overwrites that same gate file instead of forking versions.
 */
function planGateApprovalOf(state: RunState): { answered: boolean; presentedVersion: number | null } {
  const logPath = logPathFor(state)
  if (!existsSync(logPath)) return { answered: false, presentedVersion: null }
  let planAt = -1
  let answered = false
  let presentedVersion: number | null = null
  readEvents(logPath).forEach((event, index) => {
    if (event.type === 'plan' && event.digest === state.plan?.digest) {
      planAt = index
      answered = false
      presentedVersion = null
      return
    }
    if (planAt === -1 || event.type !== 'gate' || event.mode !== 'plan') return
    if (event.action === 'presented') presentedVersion = event.version
    if (event.action === 'answered') answered = true
  })
  return { answered, presentedVersion }
}

/**
 * Parent resume interception (D9): a plan parent never reaches
 * `resumeFromPoint` (which would misroute its children-pending decision into
 * the single-run tail) — it drives `runChildren` instead, with the default
 * nested-run seam: the supplied starter (the orchestrator's `runStart`) over
 * the materialized child task file. A plan whose gate was never answered
 * (crash before the presentation settled) is re-presented instead — the plan
 * gate is human-only (D5), so no resume may convert 'never approved' into
 * 'approved'.
 */
export async function resumePlanParent(
  deps: OrchestratorDeps,
  state: RunState,
  emit: (event: EventInput) => void,
  autonomy: AutonomyConfig,
  startChildRun: StartChildRun,
): Promise<PlanResumeResult> {
  const stop = createStopMarkerSeam(state.runDir)
  writeHolder(state.runDir)
  deps.mountRunScreen?.({ runDir: state.runDir, logPath: logPathFor(state) })
  try {
    const resolved: OrchestratorDeps = { ...deps, autonomy }
    const ctx: StageContext = {
      cwd: resolved.config.repoRoot,
      changeDir: path.join(resolved.config.repoRoot, 'openspec', 'changes', state.changeName),
      sidecarDir: path.join(state.runDir, 'sidecars'),
      emit,
    }
    if (state.plan === undefined) {
      // Finish the interrupted `runPlanBranch` settle from the sidecar (D3):
      // topo-sort, re-materialize, digest, persist `state.plan`/children —
      // then present the plan gate. No gate answer can predate a plan
      // persist, so the presentation starts the gate fresh at version 1.
      await runPlanBranch(resolved, state, ctx, await planChildrenOf(ctx))
      return { runId: state.runId, halted: 'gate-pending' }
    }
    const approval = planGateApprovalOf(state)
    if (!approval.answered) {
      await presentGateAt(resolved, state, ctx, PLAN_REVIEW_SURROGATE, approval.presentedVersion ?? 1, 'plan', {
        children: await planGateRows(ctx.sidecarDir, state),
      })
      return { runId: state.runId, halted: 'gate-pending' }
    }
    const runChildRun: RunChildRun = (child, taskFile, spendBaselineUsd, onRunDirReady) =>
      startChildRun(resolved, { child, taskFile, spendBaselineUsd, onRunDirReady })
    const result = await runChildren(resolved, state, ctx, { runChildRun, stop })
    return {
      runId: state.runId,
      halted: result.halted,
      ...(result.halted === 'gate-pending' ? { childRunId: result.childRunId } : {}),
    }
  } finally {
    removeHolder(state.runDir)
    deps.unmountRunScreen?.()
  }
}
