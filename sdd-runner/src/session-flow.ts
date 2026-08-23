// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SessionRow } from './session-list.js'
import { stopRunMessage } from './stop-controller.js'
import type { StopRunResult } from './stop-controller.js'

/**
 * Execution seam for the session screen's decisions (D2): every verb routes
 * through the same orchestrator entry the explicit-id CLI path uses — no new
 * pipeline verbs are introduced here.
 */

export type SessionTargetAction =
  | { readonly kind: 'gate'; readonly runId: string }
  | { readonly kind: 'resume'; readonly runId: string }
  | { readonly kind: 'report'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }
  | { readonly kind: 'reopen'; readonly runId: string }

export interface SessionFlowDeps {
  readonly runGateResume: (runId: string) => Promise<unknown>
  readonly runResume: (runId: string) => Promise<unknown>
  readonly buildReport: (runId: string) => Promise<string>
  readonly requestCalmStop: (runId: string) => Promise<StopRunResult>
  /** Re-presents the latest settled gate as pending at a fresh version. */
  readonly reopenGate: (runId: string) => Promise<void>
  readonly stdout: (line: string) => void
}

/** The routing verdict a row's persisted state implies on Enter. */
export function routeOfRow(row: SessionRow): 'gate' | 'resume' | 'report' {
  if (row.pendingDecision?.kind === 'gate') return 'gate'
  if (row.status === 'completed' || row.status === 'aborted' || row.status === 'failed') return 'report'
  return 'resume'
}

export async function executeSessionTarget(action: SessionTargetAction, deps: SessionFlowDeps): Promise<void> {
  const { runId } = action
  switch (action.kind) {
    case 'gate':
      await deps.runGateResume(runId)
      return
    case 'resume':
      await deps.runResume(runId)
      return
    case 'report': {
      const body = await deps.buildReport(runId)
      deps.stdout(body)
      return
    }
    case 'stop': {
      const result = await deps.requestCalmStop(runId)
      deps.stdout(stopRunMessage(result))
      return
    }
    case 'reopen':
      await deps.reopenGate(runId)
      await deps.runGateResume(runId)
  }
}
