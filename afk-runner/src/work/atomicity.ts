// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import { runStageAgent } from '../agent-layer.js'
import { StageHaltError } from '../errors.js'
import type { DepthProfile } from '../events.js'
import { runsAtomicity } from './decompose.js'
import type { StageDeps } from './decompose.js'

export const AtomicityReportSchema = z.object({
  split: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
})

export function buildAtomicityPrompt(tasksFile: string, cwd: string, lastError: string | null): string {
  const report = agentWritePath(cwd, 'atomicity.json')
  const parts = [
    'You are the atomicity checker. Read tasks.md and split any task that bundles multiple atomic',
    'changes; merge trivially coupled tasks that cannot be verified independently. Every task must',
    'end with its verification command.',
    '',
    `Rewrite tasks.md in place at: ${tasksFile}`,
    `Then write a JSON report to ${report}: {"split": <count>, "merged": <count>}`,
  ]
  if (lastError !== null) parts.push('', 'Previous attempt failed:', lastError)
  return parts.join('\n')
}

async function attemptAtomicity(
  deps: StageDeps,
  changeName: string,
  tasksFile: string,
  attempt: number,
  lastError: string | null,
): Promise<z.infer<typeof AtomicityReportSchema>> {
  const report = await runStageAgent(deps.agent, {
    role: 'atomicity',
    changeName,
    cwd: deps.cwd,
    prompt: buildAtomicityPrompt(tasksFile, deps.cwd, lastError),
    outputPath: 'atomicity.json',
    outputSchema: AtomicityReportSchema,
    label: 'atomicity',
    runDir: deps.runDir,
    round: 0,
    sidecarDir: deps.sidecarDir,
  })
  const validation = await deps.driver.validateStrict(changeName)
  if (validation.ok) return report.value
  const problem = `openspec validate --strict failed: ${validation.output}`
  if (attempt >= 2)
    throw new StageHaltError(`atomicity failed after 2 attempts: ${problem}`, 'resume the run', 'exhausted')
  return attemptAtomicity(deps, changeName, tasksFile, attempt + 1, problem)
}

export async function runAtomicity(
  deps: StageDeps,
  options: { readonly changeName: string; readonly depth: DepthProfile },
): Promise<{ readonly skipped: boolean; readonly split?: number; readonly merged?: number }> {
  if (!runsAtomicity(options.depth)) return { skipped: true }
  const tasksFile = path.join(deps.cwd, 'openspec', 'changes', options.changeName, 'tasks.md')
  if (!fs.existsSync(tasksFile))
    throw new StageHaltError(
      `atomicity cannot run: tasks.md missing at ${tasksFile}`,
      'resume after decomposition',
      'precondition',
    )
  const result = await attemptAtomicity(deps, options.changeName, tasksFile, 1, null)
  return { skipped: false, split: result.split, merged: result.merged }
}
