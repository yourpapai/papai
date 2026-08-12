// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { DepthProfileSchema, StageIdSchema } from './events.js'
import type { StageId } from './events.js'
import type { ReplayState } from './replay.js'

export const PersistedRunStateSchema = z.object({
  runId: z.string().min(1),
  repoRoot: z.string().min(1),
  workDir: z.string().min(1),
  changeName: z.string().min(1),
  stage: StageIdSchema,
  depth: DepthProfileSchema.nullable(),
  round: z.number().int().nonnegative(),
  gate: z.object({ mode: z.enum(['early', 'final']), version: z.number().int().positive() }).nullable(),
  status: z.enum(['running', 'completed', 'aborted', 'failed']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export type PersistedRunState = z.infer<typeof PersistedRunStateSchema>

export interface RunState extends PersistedRunState {
  readonly runDir: string
  readonly statePath: string
}

export interface ResumePoint {
  readonly stage: StageId
  readonly round: number
  readonly reason: string
}

export interface CreateRunStateInput {
  readonly workDir: string
  readonly repoRoot: string
  readonly changeName: string
  readonly runId?: string
}

function makeRunId(now: Date): string {
  return `${now.toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
}

export async function createRunState(input: CreateRunStateInput, now: Date = new Date()): Promise<RunState> {
  const runId = input.runId ?? makeRunId(now)
  const runDir = path.join(input.workDir, 'runs', runId)
  await mkdir(runDir, { recursive: true })
  const state: RunState = {
    runId,
    repoRoot: input.repoRoot,
    workDir: input.workDir,
    changeName: input.changeName,
    stage: 'intake',
    depth: null,
    round: 0,
    gate: null,
    status: 'running',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    runDir,
    statePath: path.join(runDir, 'state.json'),
  }
  await writeFile(state.statePath, `${JSON.stringify(state, null, 2)}\n`)
  return state
}

function toRunState(persisted: PersistedRunState, runDir: string): RunState {
  return { ...persisted, runDir, statePath: path.join(runDir, 'state.json') }
}

export async function loadRunState(workDir: string, runId: string): Promise<RunState> {
  const runDir = path.join(workDir, 'runs', runId)
  const statePath = path.join(runDir, 'state.json')
  try {
    const raw = await readFile(statePath, 'utf8')
    return toRunState(PersistedRunStateSchema.parse(JSON.parse(raw)), runDir)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`state.json for run ${runId}: ${detail}`, { cause: error })
  }
}

export async function saveRunState(state: RunState, now: Date = new Date()): Promise<RunState> {
  const next: RunState = { ...state, updatedAt: now.toISOString() }
  await mkdir(next.runDir, { recursive: true })
  await writeFile(next.statePath, `${JSON.stringify(PersistedRunStateSchema.parse(next), null, 2)}\n`)
  return next
}

function isDone(artifacts: Record<string, string>, id: string): boolean {
  return artifacts[id] === 'done'
}

function draftComplete(state: PersistedRunState, artifacts: Record<string, string>): boolean {
  if (!isDone(artifacts, 'proposal') || !isDone(artifacts, 'specs')) return false
  return state.depth === 'S' || isDone(artifacts, 'design')
}

export function deriveResumePoint(
  state: PersistedRunState,
  artifacts: Record<string, string>,
  replay: ReplayState,
): ResumePoint {
  if (state.gate !== null) return { stage: 'gate', round: state.round, reason: 'gate-pending' }
  if (state.depth === null) return { stage: 'intake', round: 0, reason: 'depth not classified' }
  if (!draftComplete(state, artifacts)) return { stage: 'draft', round: 0, reason: 'draft artifacts incomplete' }
  if (replay.lastVerdict?.verdict !== 'converged') {
    const round = Math.max(state.round, replay.round?.current ?? 0, 1)
    return { stage: 'review', round, reason: 'review loop not converged' }
  }
  if (!isDone(artifacts, 'tasks')) return { stage: 'decompose', round: state.round, reason: 'tasks.md missing' }
  if (state.depth !== 'S' && replay.stages.atomicity !== 'done') {
    return { stage: 'atomicity', round: state.round, reason: 'atomicity check not recorded' }
  }
  return { stage: 'gate', round: state.round, reason: 'all stages complete' }
}
