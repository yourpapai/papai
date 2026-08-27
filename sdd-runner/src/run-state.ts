// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { DepthProfileSchema, StageIdSchema } from './events.js'
import type { DepthProfile } from './events.js'
import { ROUND_CAPS } from './review-model.js'
import { readAllRunStates } from './run-index.js'
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
  gate: z.object({ mode: z.enum(['early', 'final', 'plan']), version: z.number().int().positive() }).nullable(),
  status: z.enum(['running', 'completed', 'aborted', 'failed', 'stopped']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  autoExtendsUsed: z.number().int().nonnegative().default(0),
  /** Tree budget baseline (D10): ancestor spend a nested run adds before its single-ceiling compare. */
  spendBaselineUsd: z.number().nonnegative().optional(),
  gateDeadlineAt: z.string().min(1).nullable().default(null),
  gateDeadlineReArmed: z.boolean().default(false),
  plan: z.object({ childIds: z.array(z.string().min(1)).min(1), digest: z.string().min(1) }).optional(),
  children: z.record(z.string(), z.object({ status: z.enum(['pending', 'running', 'done', 'failed']) })).optional(),
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
  readonly spendBaselineUsd?: number
}

function makeRunId(now: Date): string {
  return `${now.toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
}

/** Statuses a run never leaves; `running` and `stopped` stay resumable. */
export const TERMINAL_STATUSES = new Set(['completed', 'aborted', 'failed'])
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
    ...(input.spendBaselineUsd === undefined ? {} : { spendBaselineUsd: input.spendBaselineUsd }),
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

/** Layout rule (D8): a run's directory under `workDir` — derivable from its runId alone. */
export function runDirOf(workDir: string, runId: string): string {
  return path.join(workDir, 'runs', runId)
}

export async function loadRunState(workDir: string, runId: string): Promise<RunState> {
  const runDir = runDirOf(workDir, runId)
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

/**
 * Narrow a gate mode for early/final consumers. Plan gates are produced and
 * resumed since the plan-gate wiring: `gate-resume-entry.ts` dispatches them
 * to `runPlanGateResume` ahead of every call site here, so a 'plan' value
 * reaching this function means that dispatch invariant broke — throw rather
 * than mis-drive an early/final path.
 */
export function narrowGateMode(mode: 'early' | 'final' | 'plan'): 'early' | 'final' {
  if (mode === 'plan')
    throw new Error("gate mode 'plan' must not reach early/final narrowing — plan gates resume via runPlanGateResume")
  return mode
}
