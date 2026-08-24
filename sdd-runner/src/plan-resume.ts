// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { runChildren } from './children.js'
import type { RunChildRun } from './children.js'
import type { AutonomyConfig } from './config.js'
import type { EventInput } from './events.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { logPathFor } from './gate-digest.js'
import type { RunState } from './run-state.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'

/** The orchestrator-supplied nested-run starter (D7): `runStart` by default. */
export type StartChildRun = (
  deps: OrchestratorDeps,
  options: { readonly taskFile: string },
) => Promise<{ readonly runId: string }>

export interface PlanResumeResult {
  readonly runId: string
  readonly halted: 'gate-pending' | 'stopped' | 'completed'
}

/** A plan parent (D9): `state.plan` present, resumable while running or stopped. */
export function isPlanParentResume(state: RunState): boolean {
  return state.plan !== undefined && (state.status === 'running' || state.status === 'stopped')
}

/**
 * Parent resume interception (D9): a plan parent never reaches
 * `resumeFromPoint` (which would misroute its children-pending decision into
 * the single-run tail) — it drives `runChildren` instead, with the default
 * nested-run seam: the supplied starter (the orchestrator's `runStart`) over
 * the materialized child task file.
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
    const runChildRun: RunChildRun = (_child, taskFile) => startChildRun(resolved, { taskFile })
    const result = await runChildren(resolved, state, ctx, { runChildRun, stop })
    return { runId: state.runId, halted: result.halted }
  } finally {
    removeHolder(state.runDir)
    deps.unmountRunScreen?.()
  }
}
