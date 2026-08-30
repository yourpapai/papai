// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CliHarness } from './cli.js'
import type { OrchestratorDeps } from './gate-digest.js'
import { runStart } from './orchestrator.js'
import type { StartOptions } from './orchestrator.js'
import { removeRun } from './remove-run.js'
import { executeSessionTarget } from './session-flow.js'
import type { SessionFlowDeps } from './session-flow.js'
import { runSessionPicker } from './tui-session-picker.js'

export type DepthOverride = NonNullable<Parameters<typeof runStart>[1]['depthOverride']>

/** Adapt a CLI harness member set into the session-flow dependency surface. */
export function sessionFlowDepsOf(members: CliHarness): SessionFlowDeps {
  return {
    runGateResume: (runId) => members.runGateResume(runId),
    runResume: (runId) => members.runResume(runId),
    buildReport: (runId) => members.buildReport(runId, false),
    requestCalmStop: (runId) => members.requestCalmStop(runId),
    reopenGate: async (runId) => {
      const version = await members.latestSettledGateVersion?.(runId)
      if (version === undefined || version === null) throw new Error(`run ${runId} has no settled gate to reopen`)
      await members.runGateReopen(runId, version)
    },
    removeRun: (runId) => removeRun(members.workDir, runId),
    stdout: members.stdout,
  }
}

/** The interactive session loop wiring: picker + create-run threading of --depth/--plan. */
export function sessionLoopOf(
  config: { readonly workDir: string; readonly repoRoot: string },
  orchestratorDeps: OrchestratorDeps,
  members: CliHarness,
): (options: {
  readonly initial: 'list' | 'create'
  readonly depth?: DepthOverride
  readonly plan?: true
}) => Promise<void> {
  return async (options): Promise<void> => {
    await runSessionPicker({
      workDir: config.workDir,
      ...(options.initial === 'list' ? {} : { initial: options.initial }),
      execute: (action) => executeSessionTarget(action, sessionFlowDepsOf(members)),
      buildReport: (runId) => members.buildReport(runId, false),
      createRun: async (taskText): Promise<void> => {
        const start: StartOptions = {
          taskText,
          ...(options.depth === undefined ? {} : { depthOverride: options.depth }),
          ...(options.plan === undefined ? {} : { forcePlan: true }),
        }
        const started = await runStart(orchestratorDeps, start)
        members.stdout(`started ${started.runId}`)
      },
      removeRun: (runId) => removeRun(config.workDir, runId),
    })
  }
}
