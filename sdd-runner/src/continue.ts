// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { runGateResume } from './extend-round.js'
import type { OrchestratorDeps } from './gate-digest.js'
import { runResume } from './orchestrator.js'
import type { AutonomyOverrides, RunContinueResult } from './orchestrator.js'
import { listPendingGates, resolveRunId } from './run-index.js'
import { loadRunState } from './run-state.js'

/**
 * `continue` is a pure router (Decision 4): gate-pending → the gate flow
 * (`runGateResume` with no flags — interactive session on a TTY, hand-edited
 * file otherwise); interrupted mid-stage → `runResume`; completed → a pointer
 * to the report. Without an id, discovery picks the single gate-pending run,
 * or lists the candidates when several exist.
 */
export async function runContinue(
  deps: OrchestratorDeps,
  runId: string | null,
  overrides: AutonomyOverrides = {},
): Promise<RunContinueResult> {
  if (runId === null) {
    const picked = await pickContinueRun(deps)
    if (picked === null) return { runId: null, routed: 'list' }
    return runContinue(deps, picked, overrides)
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
    deps.stdout?.(`run ${resolved} is completed — report via: sdd ${resolved}`)
    return { runId: resolved, routed: 'report' }
  }
  const resumed = await runResume(deps, resolved, overrides)
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
      deps.stdout?.(`  sdd ${entry.runId}  (${entry.changeName}, gate v${entry.gateVersion})`)
    }
    return null
  }
  throw new Error('no gate-pending runs found — pass a run id, or run sdd with no target to list candidates')
}
