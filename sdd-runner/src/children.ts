// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'

import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { presentGateAt } from './gate-digest.js'
import { PLAN_REVIEW_SURROGATE } from './gate-prelude.js'
import { materializeChildFiles, planDigest, topoSortChildren } from './plan.js'
import type { PlanChild, PlanFsDeps } from './plan.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'

export interface PlanBranchOptions {
  /** Injected fs seam (D7): hermetic materialization under test. */
  readonly fs?: PlanFsDeps
}

const DEFAULT_FS: PlanFsDeps = { mkdir, writeFile, readdir, unlink }

/** D4 row text: `<child-id> — <instruction first line>` plus deps/capabilities. */
function gateRowText(child: PlanChild): string {
  const firstLine = child.instruction.split('\n')[0] ?? child.instruction
  const deps = child.deps.length > 0 ? ` · deps: ${child.deps.join(', ')}` : ''
  const capabilities =
    child.capabilities === undefined || child.capabilities.length === 0
      ? ''
      : ` · capabilities: ${child.capabilities.join(', ')}`
  return `${child.id} — ${firstLine}${deps}${capabilities}`
}

/**
 * Plan branch entry (D7): materialize child task files → emit the `plan` event
 * → record `state.plan` (topo childIds + digest) and seed `state.children` →
 * persist → present the plan gate (R4-only prelude, D5). The parent never
 * creates a change folder.
 */
export async function runPlanBranch(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  children: readonly PlanChild[],
  options: PlanBranchOptions = {},
): Promise<RunStartResult> {
  const ordered = topoSortChildren({ children: [...children] })
  await materializeChildFiles({ children: ordered }, state.runDir, options.fs ?? DEFAULT_FS)
  const digest = planDigest(ordered)
  ctx.emit({ altitude: 'L2', type: 'plan', childCount: ordered.length, digest })
  state.plan = { childIds: ordered.map((child) => child.id), digest }
  const seeded: Record<string, { status: 'pending' }> = {}
  for (const child of ordered) seeded[child.id] = { status: 'pending' }
  state.children = seeded
  await saveRunState(state, deps.now?.() ?? new Date())
  return presentGateAt(deps, state, ctx, PLAN_REVIEW_SURROGATE, 1, 'plan', {
    children: ordered.map((child, index) => ({ id: `C${index + 1}`, text: gateRowText(child) })),
  })
}
