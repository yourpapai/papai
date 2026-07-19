// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { ReviewLoopConfig } from './config.js'

const PersistedRunStateSchema = z.object({
  runId: z.string(),
  repoRoot: z.string(),
  planPath: z.string(),
  currentRound: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
})

export type PersistedRunState = z.infer<typeof PersistedRunStateSchema>

export interface RunState extends PersistedRunState {
  runDir: string
  worktreePath: string
  ledgerPath: string
  issuesPath: string
  resultPath: string
  matchesPath: string
  logPath: string
  tracePath: string
  statePath: string
  inspectPath: string
}

function makeRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
}

export async function createRunState(config: ReviewLoopConfig, planPath: string): Promise<RunState> {
  const runId = makeRunId()
  const runDir = path.join(config.workDir, 'runs', runId)

  await mkdir(runDir, { recursive: true })

  const state: RunState = {
    runId,
    runDir,
    worktreePath: path.join(config.workDir, 'worktrees', runId),
    ledgerPath: path.join(runDir, 'ledger.json'),
    issuesPath: path.join(runDir, 'issues.json'),
    resultPath: path.join(runDir, 'result.json'),
    matchesPath: path.join(runDir, 'matches.json'),
    logPath: path.join(runDir, 'agent-output.log'),
    tracePath: path.join(runDir, 'trace.jsonl'),
    statePath: path.join(runDir, 'state.json'),
    inspectPath: path.join(runDir, 'inspect.json'),
    repoRoot: config.repoRoot,
    planPath: path.resolve(planPath),
    currentRound: 0,
    noProgressRounds: 0,
  }

  await saveRunState(state)
  return state
}

export async function loadRunState(workDir: string, runId: string): Promise<RunState> {
  const statePath = path.join(workDir, 'runs', runId, 'state.json')
  const runDir = path.dirname(statePath)
  const persisted = PersistedRunStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))

  return {
    ...persisted,
    runDir,
    worktreePath: path.join(workDir, 'worktrees', runId),
    ledgerPath: path.join(runDir, 'ledger.json'),
    issuesPath: path.join(runDir, 'issues.json'),
    resultPath: path.join(runDir, 'result.json'),
    matchesPath: path.join(runDir, 'matches.json'),
    logPath: path.join(runDir, 'agent-output.log'),
    tracePath: path.join(runDir, 'trace.jsonl'),
    statePath,
    inspectPath: path.join(runDir, 'inspect.json'),
  }
}

export async function saveRunState(state: RunState): Promise<void> {
  const persisted = PersistedRunStateSchema.parse(state)
  await writeFile(state.statePath, JSON.stringify(persisted, null, 2))
}
