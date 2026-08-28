// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { awaitGateDeadline, shouldEnterWaiter } from './deadline-waiter.js'
import { runEarlyFinalGateResume } from './extend-round.js'
import type { GateResumeOptions, RunGateResumeResult } from './extend-round.js'
import { buildBus, logPathFor } from './gate-digest.js'
import type { OrchestratorDeps } from './gate-digest.js'
import { runStart } from './orchestrator.js'
import { runPlanGateResume } from './plan-gate-resume.js'
import { loadRunState } from './run-state.js'

/**
 * Gate-resume entry (D7/D12): loads the pending run, decides the D11 deadline
 * waiter, then dispatches — plan gates to `runPlanGateResume` with the
 * orchestrator-supplied `runStart` default, early/final gates to
 * `runEarlyFinalGateResume`. The entry sits above `orchestrator.ts` so every
 * dependency arrow stays one-way (here → orchestrator/extend-round/
 * plan-gate-resume → children) and the wiring holds with static imports
 * only — no dynamic import is needed to keep the module graph acyclic.
 */
export async function runGateResume(
  deps: OrchestratorDeps,
  runId: string,
  options: GateResumeOptions,
): Promise<RunGateResumeResult> {
  const state = await loadRunState(deps.config.workDir, runId)
  if (state.gate === null) throw new Error(`run ${runId} is not gate-pending`)
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
  if (wait || options.waitDeadline === true) return awaitGateDeadline(deps, state.runId, runGateResume)
  const emit = buildBus(deps, logPathFor(state))
  if (state.gate.mode === 'plan') {
    return runPlanGateResume(deps, state, options, emit, {
      startChildRun: (child, taskFile, spendBaselineUsd, onRunDirReady) =>
        runStart(deps, { child, taskFile, spendBaselineUsd, onRunDirReady }),
    })
  }
  return runEarlyFinalGateResume(deps, state, options, emit)
}
