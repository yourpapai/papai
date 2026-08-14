// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { DepthProfileSchema, StageIdSchema } from './events.js'
import type { DepthProfile, StageId } from './events.js'
import type { ReplayState } from './replay.js'
import { ROUND_CAPS } from './review-model.js'

export const PersistedRunStateSchema = z.object({
  runId: z.string().min(1),
  repoRoot: z.string().min(1),
  workDir: z.string().min(1),
  changeName: z.string().min(1),
  stage: StageIdSchema,
  depth: DepthProfileSchema.nullable(),
  round: z.number().int().nonnegative(),
  roundCap: z.number().int().positive().optional(),
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

/**
 * Resolve the effective round cap for a run state. An explicit `roundCap`
 * (set by an extend directive) wins; otherwise the depth profile's static
 * `ROUND_CAPS` entry is used. A null depth defaults to `S` (matching the
 * pre-classification intake stage), preserving prior behavior.
 */
export function resolveRoundCap(state: { depth: DepthProfile | null; roundCap?: number }): number {
  if (state.roundCap !== undefined) return state.roundCap
  return ROUND_CAPS[state.depth ?? 'S']
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
  const depth = null
  const round = 0
  const state: RunState = {
    runId,
    repoRoot: input.repoRoot,
    workDir: input.workDir,
    changeName: input.changeName,
    stage: 'intake',
    depth,
    round,
    roundCap: ROUND_CAPS.S,
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
  const roundCap = resolveRoundCap(persisted)
  return { ...persisted, roundCap, runDir, statePath: path.join(runDir, 'state.json') }
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

/**
 * The review loop counts as settled when a converged verdict is recorded, a
 * cap-hit verdict was accepted by a human at an early gate (approve =
 * human-decree convergence, possibly via extend rounds whose last verdict
 * stays `open`), or the pipeline already moved past review into decompose
 * (severity-based convergence — nitpick-only cap-hit — flows through without
 * any gate). A presented-but-unanswered gate cannot reach the later clauses:
 * `state.gate !== null` short-circuits earlier.
 */
function reviewSettled(replay: ReplayState): boolean {
  if (replay.lastVerdict?.verdict === 'converged') return true
  if (replay.gate?.mode === 'early' && replay.gate.answered) return true
  return replay.stages.decompose !== 'pending'
}

export function deriveResumePoint(
  state: PersistedRunState,
  artifacts: Record<string, string>,
  replay: ReplayState,
): ResumePoint {
  if (state.gate !== null) return { stage: 'gate', round: state.round, reason: 'gate-pending' }
  if (state.depth === null) return { stage: 'intake', round: 0, reason: 'depth not classified' }
  if (!draftComplete(state, artifacts)) return { stage: 'draft', round: 0, reason: 'draft artifacts incomplete' }
  if (!reviewSettled(replay)) {
    const round = Math.max(state.round, replay.round?.current ?? 0, 1)
    return { stage: 'review', round, reason: 'review loop not converged' }
  }
  if (!isDone(artifacts, 'tasks')) return { stage: 'decompose', round: state.round, reason: 'tasks.md missing' }
  if (state.depth !== 'S' && replay.stages.atomicity !== 'done') {
    return { stage: 'atomicity', round: state.round, reason: 'atomicity check not recorded' }
  }
  return { stage: 'gate', round: state.round, reason: 'all stages complete' }
}
