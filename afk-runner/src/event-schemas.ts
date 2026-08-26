// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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
  cachedReadTokens: z.number().nonnegative().default(0),
  cachedWriteTokens: z.number().nonnegative().default(0),
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
    cacheRead: z.number().nonnegative().default(0),
    cacheWrite: z.number().nonnegative().default(0),
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
  model: z.string().min(1).optional(),
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
  mode: z.enum(['early', 'final', 'plan']),
  version: z.number().int().positive(),
})

const PlanEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('plan'),
  childCount: z.number().int().positive(),
  digest: z.string().min(1),
})

const ChildSpawnedEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('child_spawned'),
  child: z.string().min(1),
})

const ChildDoneEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('child_done'),
  child: z.string().min(1),
  outcome: z.enum(['done', 'failed']),
})

const HumanEditsEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('human_edits'),
  action: z.literal('detected'),
  files: z.array(z.string().min(1)).min(1),
})

const ResumeEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('resume'),
  path: z.enum(['artifact-skip', 'session-continuation', 'stage-rebuild']),
  stage: StageIdSchema,
  session: z.string().min(1).optional(),
})

export const AutoDecisionRuleSchema = z.enum(['R1', 'R2', 'R3', 'R4', 'R5', 'none'])
export type AutoDecisionRule = z.infer<typeof AutoDecisionRuleSchema>

export const AutoDecisionKindSchema = z.enum(['preview', 'approve', 'extend', 'accept-items', 'gate'])
export type AutoDecisionKind = z.infer<typeof AutoDecisionKindSchema>

const AutoDecisionEvent = z.object({
  altitude: z.literal('L2'),
  type: z.literal('auto_decision'),
  rule: AutoDecisionRuleSchema,
  decision: AutoDecisionKindSchema,
  evidenceDigest: z.string(),
  gateVersion: z.number().int().positive(),
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
  PlanEvent,
  ChildSpawnedEvent,
  ChildDoneEvent,
  HumanEditsEvent,
  ResumeEvent,
  AutoDecisionEvent,
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
  PlanEvent.extend(StampShape),
  ChildSpawnedEvent.extend(StampShape),
  ChildDoneEvent.extend(StampShape),
  HumanEditsEvent.extend(StampShape),
  ResumeEvent.extend(StampShape),
  AutoDecisionEvent.extend(StampShape),
])
export type SddEvent = z.infer<typeof SddEventSchema>

export type DoneEvent = Extract<SddEvent, { type: 'done' }>
