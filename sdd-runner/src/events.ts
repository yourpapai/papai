// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

export const StageIdSchema = z.enum(['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'])
export type StageId = z.infer<typeof StageIdSchema>

export const STAGE_ORDER: readonly StageId[] = ['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate']

export const DepthProfileSchema = z.enum(['S', 'M', 'L'])
export type DepthProfile = z.infer<typeof DepthProfileSchema>

export const AgentUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  reasoningTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  wallMs: z.number().nonnegative(),
})
export type AgentUsage = z.infer<typeof AgentUsageSchema>

export const FindingClassSchema = z.enum(['BLOCKER', 'MATERIAL', 'NITPICK'])
export type FindingClass = z.infer<typeof FindingClassSchema>

export const FindingCountsSchema = z.object({
  blocker: z.number().int().nonnegative(),
  material: z.number().int().nonnegative(),
  nitpick: z.number().int().nonnegative(),
})
export type FindingCounts = z.infer<typeof FindingCountsSchema>

const ToolUseEvent = z.object({
  altitude: z.literal('L0'),
  type: z.literal('tool_use'),
  agent: z.string().min(1),
  tool: z.string().min(1),
  arg: z.string().optional(),
})

const StepFinishEvent = z.object({
  altitude: z.literal('L0'),
  type: z.literal('step_finish'),
  agent: z.string().min(1),
  tokens: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    reasoning: z.number().nonnegative(),
  }),
  costUsd: z.number().nonnegative(),
})

const SpawnedEvent = z.object({
  altitude: z.literal('L1'),
  type: z.literal('spawned'),
  agent: z.string().min(1),
  role: z.string().min(1),
  model: z.string().min(1),
})

const RetryingEvent = z.object({
  altitude: z.literal('L1'),
  type: z.literal('retrying'),
  agent: z.string().min(1),
  reason: z.enum(['stall', 'validation']),
  attempt: z.number().int().positive(),
})

const KilledEvent = z.object({
  altitude: z.literal('L1'),
  type: z.literal('killed'),
  agent: z.string().min(1),
  cause: z.enum(['timeout', 'inactivity', 'abort']),
})

const DoneEvent = z.object({
  altitude: z.literal('L1'),
  type: z.literal('done'),
  agent: z.string().min(1),
  usage: AgentUsageSchema,
})

const StageEnterEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('stage_enter'),
  stage: StageIdSchema,
})

const StageExitEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('stage_exit'),
  stage: StageIdSchema,
})

const RoundOpenEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('round_open'),
  round: z.number().int().positive(),
  cap: z.number().int().positive(),
})

const RoundCloseEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('round_close'),
  round: z.number().int().positive(),
  cap: z.number().int().positive(),
})

const FindingEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('finding'),
  action: z.enum(['filed', 'classified', 'resolved', 'dismissed']),
  id: z.string().min(1),
  round: z.number().int().positive(),
  class: FindingClassSchema.optional(),
  detail: z.string().optional(),
})

const AssumptionEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('assumption'),
  action: z.enum(['logged', 'confirmed', 'vetoed', 'applied']),
  id: z.string().min(1),
  detail: z.string().optional(),
})

const ConvergenceEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('convergence'),
  round: z.number().int().positive(),
  verdict: z.enum(['converged', 'open']),
  counts: FindingCountsSchema,
})

const ArtifactEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('artifact'),
  action: z.literal('materialized'),
  path: z.string().min(1),
})

const DepthEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('depth'),
  profile: DepthProfileSchema,
  rationale: z.string().min(1),
  source: z.enum(['override', 'estimator', 'prescreen']),
  disagreement: z.boolean().optional(),
})

const GateEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('gate'),
  action: z.enum(['presented', 'answered']),
  mode: z.enum(['early', 'final']),
  version: z.number().int().positive(),
})

const HumanEditsEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('human_edits'),
  action: z.literal('detected'),
  files: z.array(z.string().min(1)).min(1),
})

const EVENT_VARIANTS = [
  ToolUseEvent,
  StepFinishEvent,
  SpawnedEvent,
  RetryingEvent,
  KilledEvent,
  DoneEvent,
  StageEnterEvent,
  StageExitEvent,
  RoundOpenEvent,
  RoundCloseEvent,
  FindingEvent,
  AssumptionEvent,
  ConvergenceEvent,
  ArtifactEvent,
  DepthEvent,
  GateEvent,
  HumanEditsEvent,
] as const

export const EventInputSchema = z.discriminatedUnion('type', [...EVENT_VARIANTS])
export type EventInput = z.input<typeof EventInputSchema>

const StampShape = { seq: z.number().int().positive(), ts: z.string().min(1) }

export const SddEventSchema = z.discriminatedUnion('type', [
  ToolUseEvent.extend(StampShape),
  StepFinishEvent.extend(StampShape),
  SpawnedEvent.extend(StampShape),
  RetryingEvent.extend(StampShape),
  KilledEvent.extend(StampShape),
  DoneEvent.extend(StampShape),
  StageEnterEvent.extend(StampShape),
  StageExitEvent.extend(StampShape),
  RoundOpenEvent.extend(StampShape),
  RoundCloseEvent.extend(StampShape),
  FindingEvent.extend(StampShape),
  AssumptionEvent.extend(StampShape),
  ConvergenceEvent.extend(StampShape),
  ArtifactEvent.extend(StampShape),
  DepthEvent.extend(StampShape),
  GateEvent.extend(StampShape),
  HumanEditsEvent.extend(StampShape),
])
export type SddEvent = z.infer<typeof SddEventSchema>

export interface ReplayState {
  readonly stages: Record<StageId, 'done' | 'active' | 'pending'>
  readonly depth: DepthProfile | null
  readonly round: { readonly current: number; readonly cap: number } | null
  readonly lastVerdict: {
    readonly round: number
    readonly verdict: 'converged' | 'open'
    readonly counts: FindingCounts
  } | null
  readonly gate: { readonly mode: 'early' | 'final'; readonly version: number; readonly answered: boolean } | null
}

function nextSeq(logPath: string): number {
  if (!fs.existsSync(logPath)) return 1
  const lines = fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
  return lines.length + 1
}

export function appendEvent(logPath: string, event: unknown, now: Date = new Date()): SddEvent {
  const parsedInput = EventInputSchema.parse(event)
  const stamped = { ...parsedInput, seq: nextSeq(logPath), ts: now.toISOString() }
  const parsed = SddEventSchema.parse(stamped)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, `${JSON.stringify(parsed)}\n`)
  return parsed
}

export function readEvents(logPath: string): SddEvent[] {
  const lines = fs.readFileSync(logPath, 'utf8').split('\n')
  const events: SddEvent[] = []
  lines.forEach((line, index) => {
    if (line.length === 0) return
    try {
      events.push(SddEventSchema.parse(JSON.parse(line)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`events.ndjson line ${index + 1}: ${detail}`, { cause: error })
    }
  })
  return events
}

function initialStages(): Record<StageId, 'done' | 'active' | 'pending'> {
  return {
    intake: 'pending',
    draft: 'pending',
    review: 'pending',
    decompose: 'pending',
    atomicity: 'pending',
    gate: 'pending',
  }
}

function foldEvent(state: ReplayState, event: SddEvent): ReplayState {
  if (event.type === 'stage_enter') {
    const stages = { ...state.stages }
    for (const id of STAGE_ORDER) if (stages[id] === 'active') stages[id] = 'done'
    stages[event.stage] = 'active'
    return { ...state, stages }
  }
  if (event.type === 'stage_exit') return { ...state, stages: { ...state.stages, [event.stage]: 'done' } }
  if (event.type === 'depth') return { ...state, depth: event.profile }
  if (event.type === 'round_open') return { ...state, round: { current: event.round, cap: event.cap } }
  if (event.type === 'convergence') {
    return { ...state, lastVerdict: { round: event.round, verdict: event.verdict, counts: event.counts } }
  }
  if (event.type === 'gate') {
    if (event.action === 'presented')
      return { ...state, gate: { mode: event.mode, version: event.version, answered: false } }
    return state.gate === null ? state : { ...state, gate: { ...state.gate, answered: true } }
  }
  return state
}

export function replayEvents(logPath: string): ReplayState {
  const initial: ReplayState = { stages: initialStages(), depth: null, round: null, lastVerdict: null, gate: null }
  return readEvents(logPath).reduce(foldEvent, initial)
}
