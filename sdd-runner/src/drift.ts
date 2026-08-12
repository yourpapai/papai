// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { z } from 'zod'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps } from './agent-layer.js'
import type { RunState } from './run-state.js'

export const DriftReportSchema = z.object({ tasks_file: z.string().min(1) })

export function buildDriftPrompt(files: readonly string[], tasksFile: string, cwd: string): string {
  const report = agentWritePath(cwd, 'drift.json')
  return [
    'You are the drift-check resolver. The human edited these agent-authored artifacts at the gate:',
    ...files.map((f) => `- ${f}`),
    '',
    `Reconcile tasks.md at ${tasksFile} so it stays consistent with the edited artifacts.`,
    `Write JSON to ${report}: {"tasks_file": "<path relative to repo root>"}`,
  ].join('\n')
}

export function buildDriftCheck(
  agent: AgentLayerDeps,
  state: RunState,
  changeDir: string,
  sidecarDir: string,
  repoRoot: string,
): (files: readonly string[]) => Promise<void> {
  return async (files) => {
    await runStageAgent(agent, {
      role: 'resolver',
      changeName: state.changeName,
      cwd: repoRoot,
      prompt: buildDriftPrompt(files, path.join(changeDir, 'tasks.md'), repoRoot),
      outputPath: 'drift.json',
      outputSchema: DriftReportSchema,
      label: 'drift',
      logPath: path.join(sidecarDir, 'logs', 'drift.log'),
      sidecarDir,
    })
  }
}
