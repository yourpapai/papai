// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { z } from 'zod'

import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { AgentLayerDeps } from '../agent-layer.js'
import { runStageAgent } from '../agent-layer.js'
import { StageHaltError } from '../errors.js'
import type { DepthProfile } from '../events.js'
import type { OpenSpecDriver } from '../openspec-driver.js'

export const DecomposeReportSchema = z.object({ tasks_file: z.string().min(1) })

export function runsAtomicity(depth: DepthProfile): boolean {
  return depth !== 'S'
}

export function countTaskSections(tasksMd: string): number {
  return tasksMd.split('\n').filter((line) => line.startsWith('## ')).length
}

export interface StageDeps {
  readonly driver: OpenSpecDriver
  readonly agent: AgentLayerDeps
  readonly runDir: string
  readonly sidecarDir: string
  readonly cwd: string
}

export type DecomposeDeps = StageDeps

export function buildDecomposerPrompt(tasksFile: string, instr: string, cwd: string, lastError: string | null): string {
  const report = agentWritePath(cwd, 'decompose-tasks.json')
  const parts = [
    'You are the decomposer. Break the change into atomic, independently verifiable tasks.',
    '',
    'Instruction:',
    instr,
    '',
    `Write tasks.md to: ${tasksFile}`,
    `Then write a JSON report to ${report}: {"tasks_file": "<path relative to the repo root>"}`,
  ]
  if (lastError !== null) parts.push('', 'Previous attempt failed:', lastError)
  return parts.join('\n')
}

async function attemptDecompose(
  deps: StageDeps,
  changeName: string,
  instr: string,
  tasksFile: string,
  attempt: number,
  lastError: string | null,
): Promise<void> {
  await runStageAgent(deps.agent, {
    role: 'decomposer',
    changeName,
    cwd: deps.cwd,
    prompt: buildDecomposerPrompt(tasksFile, instr, deps.cwd, lastError),
    outputPath: 'decompose-tasks.json',
    outputSchema: DecomposeReportSchema,
    label: 'decomposer',
    runDir: deps.runDir,
    round: 0,
    sidecarDir: deps.sidecarDir,
  })
  const validation = await deps.driver.validateStrict(changeName)
  if (validation.ok) return
  const problem = `openspec validate --strict failed: ${validation.output}`
  if (attempt >= 2)
    throw new StageHaltError(`decompose failed after 2 attempts: ${problem}`, 'resume the run', 'exhausted')
  await attemptDecompose(deps, changeName, instr, tasksFile, attempt + 1, problem)
}

export async function runDecompose(deps: StageDeps, options: { readonly changeName: string }): Promise<void> {
  const instr = await deps.driver.instructions('tasks', options.changeName)
  const tasksFile = path.join(deps.cwd, 'openspec', 'changes', options.changeName, 'tasks.md')
  await attemptDecompose(deps, options.changeName, instr.instruction, tasksFile, 1, null)
}
