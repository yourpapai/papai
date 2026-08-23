// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { DepthProfileSchema, StageIdSchema } from './events.js'
import type { DepthProfile } from './events.js'
import { ROUND_CAPS } from './review-model.js'
import { readLiteRecord } from './run-lite.js'
import type { PersistedLite } from './run-lite.js'
import { slugifySessionId } from './session-id.js'

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
  status: z.enum(['running', 'completed', 'aborted', 'failed', 'stopped']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  autoExtendsUsed: z.number().int().nonnegative().default(0),
  gateDeadlineAt: z.string().min(1).nullable().default(null),
  gateDeadlineReArmed: z.boolean().default(false),
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

/**
 * Build the standard round-boundary steering seam (D6): warn lines flow to
 * the caller's sink; the cap re-read consults the persisted `state.roundCap`
 * so a steered `extend` takes effect at the next boundary without consuming
 * `autoExtendsUsed`.
 */
export function steerSeamFor(
  state: { readonly runDir: string; readonly depth: DepthProfile | null; readonly roundCap?: number },
  onWarning: (line: string) => void,
): { readonly runDir: string; readonly onWarning: (line: string) => void; readonly readRoundCap: () => number } {
  return {
    runDir: state.runDir,
    onWarning,
    readRoundCap: () => resolveRoundCap(state),
  }
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

const TERMINAL_STATUSES = new Set(['completed', 'aborted', 'failed'])
const MAX_SUFFIX = 1000

/**
 * Allocate a task-name session id (D1): the slugified change name when free;
 * a refusal naming the holder while a non-terminal run owns it; otherwise the
 * next `<slug>-<n>` suffix past terminal holders. Legacy datetime ids stay
 * valid through the explicit `runId` input.
 */
export async function allocateSessionId(workDir: string, name: string): Promise<string> {
  if (name === '') throw new Error('cannot derive a session id from an empty change name')
  const states = await readAllRunStates(workDir)
  const byId = new Map(states.map((state) => [state.runId, state]))
  const liveHolder = (id: string): PersistedLite | undefined => {
    const found = byId.get(id)
    return found !== undefined && !TERMINAL_STATUSES.has(found.status) ? found : undefined
  }
  const holder = liveHolder(name)
  if (holder !== undefined) {
    throw new Error(
      `session id '${name}' is held by non-terminal run ${holder.runId} (status ${holder.status}) — pick another name or settle that run`,
    )
  }
  if (!byId.has(name)) return name
  for (let i = 2; i < MAX_SUFFIX; i += 1) {
    const candidate = `${name}-${String(i)}`
    const candidateHolder = liveHolder(candidate)
    if (candidateHolder !== undefined) {
      throw new Error(
        `session id '${candidate}' is held by non-terminal run ${candidateHolder.runId} (status ${candidateHolder.status})`,
      )
    }
    if (!byId.has(candidate)) return candidate
  }
  throw new Error(`no free session id derived from '${name}' (${String(MAX_SUFFIX)} suffixes exhausted)`)
}

export async function createRunState(input: CreateRunStateInput, now: Date = new Date()): Promise<RunState> {
  const slug = slugifySessionId(input.changeName)
  const runId = input.runId ?? (await allocateSessionId(input.workDir, slug === '' ? makeRunId(now) : slug))
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
    autoExtendsUsed: 0,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
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

export interface PendingGateEntry {
  readonly runId: string
  readonly changeName: string
  readonly gateMode: 'early' | 'final'
  readonly gateVersion: number
  readonly updatedAt: string
}

/**
 * Scan each run's `state.json` under `runs/` and keep only gate-pending runs
 * (a non-null `gate` field), most recently updated first. Unreadable or
 * corrupt entries are skipped — a listing must not fail because one run dir
 * is mid-write.
 */
export async function listPendingGates(workDir: string): Promise<PendingGateEntry[]> {
  let entries: string[]
  try {
    entries = await readdir(path.join(workDir, 'runs'))
  } catch {
    return []
  }
  const perRun = await Promise.all(
    entries.map(async (runId): Promise<PendingGateEntry | null> => {
      try {
        const raw = await readFile(path.join(workDir, 'runs', runId, 'state.json'), 'utf8')
        const persisted = PersistedRunStateSchema.parse(JSON.parse(raw))
        if (persisted.gate === null) return null
        return {
          runId,
          changeName: persisted.changeName,
          gateMode: persisted.gate.mode,
          gateVersion: persisted.gate.version,
          updatedAt: persisted.updatedAt,
        }
      } catch {
        return null
      }
    }),
  )
  return perRun
    .filter((entry): entry is PendingGateEntry => entry !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Every persisted run state under the work dir, newest-first. */
export async function readAllRunStates(workDir: string): Promise<PersistedLite[]> {
  let entries: string[]
  try {
    entries = await readdir(path.join(workDir, 'runs'))
  } catch {
    return []
  }
  const perRun = await Promise.all(
    entries.map(async (runId): Promise<PersistedLite | null> => {
      try {
        const raw = await readFile(path.join(workDir, 'runs', runId, 'state.json'), 'utf8')
        const record = readLiteRecord(raw)
        if (record === null) return null
        return { runId, ...record }
      } catch {
        return null
      }
    }),
  )
  return perRun
    .filter((entry): entry is PersistedLite => entry !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Resolve a run-id argument: exact directory match wins; otherwise a unique
 * prefix among known runs; unknown ids and ambiguous prefixes fail loudly
 * with the candidate ids listed (prefixes are an interactive convenience —
 * scripts should use full ids).
 */
export async function resolveRunId(workDir: string, arg: string): Promise<string> {
  let entries: string[]
  try {
    entries = await readdir(path.join(workDir, 'runs'))
  } catch {
    throw new Error(`no runs found under ${path.join(workDir, 'runs')} (unknown run id: ${arg})`)
  }
  if (entries.includes(arg)) return arg
  const prefixed = entries.filter((runId) => runId.startsWith(arg))
  if (prefixed.length === 1) return prefixed[0] ?? arg
  if (prefixed.length > 1) {
    throw new Error(`ambiguous run id: ${arg} — candidates:\n${prefixed.map((id) => `  ${id}`).join('\n')}`)
  }
  throw new Error(`unknown run id: ${arg}`)
}

export async function saveRunState(state: RunState, now: Date = new Date()): Promise<RunState> {
  const next: RunState = { ...state, updatedAt: now.toISOString() }
  await mkdir(next.runDir, { recursive: true })
  await writeFile(next.statePath, `${JSON.stringify(PersistedRunStateSchema.parse(next), null, 2)}\n`)
  return next
}
