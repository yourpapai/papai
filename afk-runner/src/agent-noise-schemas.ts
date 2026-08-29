// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

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

/** The L0/L1 agent-noise event schemas (telemetry the fold tolerates, never drives on). */

export const ToolUseEvent = z.object({
  altitude: z.literal('L0'),
  type: z.literal('tool_use'),
  agent: z.string().min(1),
  tool: z.string().min(1),
  arg: z.string().optional(),
})

export const StepFinishEvent = z.object({
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

export const SpawnedEvent = z.object({
  altitude: z.literal('L1'),
  type: z.literal('spawned'),
  agent: z.string().min(1),
  role: z.string().min(1),
  model: z.string().min(1),
})

export const RetryingEvent = z.object({
  altitude: z.literal('L1'),
  type: z.literal('retrying'),
  agent: z.string().min(1),
  reason: z.enum(['stall', 'validation']),
  attempt: z.number().int().positive(),
})

export const KilledEvent = z.object({
  altitude: z.literal('L1'),
  type: z.literal('killed'),
  agent: z.string().min(1),
  cause: z.enum(['timeout', 'inactivity', 'abort']),
})

export const AgentDoneEvent = z.object({
  altitude: z.literal('L1'),
  type: z.literal('done'),
  agent: z.string().min(1),
  model: z.string().min(1).optional(),
  usage: AgentUsageSchema,
})
