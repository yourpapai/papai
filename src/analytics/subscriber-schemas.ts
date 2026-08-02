// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Event-data schemas and pure identity/base helpers for the analytics
 * subscriber. Every inbound debug-event payload is validated here before any
 * fact is built; unbounded or dynamic values fail closed.
 */

import { z } from 'zod'

import type { DebugEvent } from '../debug/event-bus.js'
import { ErrorClassSchema, StatusClassSchema } from './controlled-types.js'
import type { AnalyticsSourceContext } from './source-facts.js'

export const NonNegativeInt = z.number().int().nonnegative()
export const DurationMs = z
  .number()
  .nonnegative()
  .transform((value) => Math.round(value))
export const ModelRoleSchema = z.enum(['main', 'small'])
export const ProviderBindingSchema = z.enum(['global', 'byok', 'mixed'])

/**
 * Controlled attempt fields emitted by the invoke boundary. Legacy emitters may omit
 * them; the defaults keep one attempt per turn (ordinal 0, main role) and an explicit
 * unmapped binding instead of dropping the event.
 */
export const AttemptFieldsSchema = {
  attemptOrdinal: NonNegativeInt.optional(),
  modelRole: ModelRoleSchema.optional(),
  providerBinding: ProviderBindingSchema.optional(),
}

export type AttemptFields = {
  attemptOrdinal?: number | undefined
  modelRole?: 'main' | 'small' | undefined
  providerBinding?: 'global' | 'byok' | 'mixed' | undefined
}

export type AttemptIdentity = Readonly<{
  rawAttemptId: string
  providerBinding: string
  modelRole: string
}>

export const attemptIdentityOf = (turnId: string, data: AttemptFields): AttemptIdentity => {
  const modelRole = data.modelRole ?? 'main'
  const ordinal = data.attemptOrdinal ?? 0
  return {
    rawAttemptId: `${turnId}:${modelRole}:${ordinal}`,
    providerBinding: data.providerBinding ?? 'unmapped',
    modelRole,
  }
}

export const LlmStartDataSchema = z.looseObject({
  model: z.string().min(1),
  messageCount: NonNegativeInt,
  toolCount: NonNegativeInt,
  ...AttemptFieldsSchema,
})

export const FINISH_REASONS = ['stop', 'length', 'tool_calls', 'content_filter', 'error', 'other', 'unknown'] as const

export const LlmEndDataSchema = z.looseObject({
  model: z.string().min(1),
  actualModel: z.string().optional(),
  steps: NonNegativeInt,
  totalDuration: z.number().nonnegative(),
  finishReason: z.enum(FINISH_REASONS).catch('unknown'),
  tokenUsage: z
    .looseObject({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })
    .nullable()
    .optional(),
  timeToFirstTokenMs: NonNegativeInt.nullable().optional(),
  ...AttemptFieldsSchema,
})

export const LlmErrorDataSchema = z.looseObject({
  model: z.string().min(1),
  durationMs: DurationMs,
  phase: z.enum(['resolution', 'request', 'stream']).optional(),
  errorClass: ErrorClassSchema.optional(),
  retryable: z.boolean().nullable().optional(),
  ...AttemptFieldsSchema,
})

export const ToolIdentitySchema = z.looseObject({
  toolName: z.string().min(1).max(128),
  toolCallId: z.string().min(1),
  argsBytes: NonNegativeInt,
  modelRole: ModelRoleSchema.optional(),
  analyticsSourceId: z.string().min(1).max(256).optional(),
})

export const ToolCompletedDataSchema = ToolIdentitySchema.extend({
  durationMs: DurationMs,
  executionOutcome: z.enum(['semantic_success', 'structured_failure', 'thrown_failure', 'permission_denied']),
  resultBytes: NonNegativeInt,
  errorClass: ErrorClassSchema.nullable(),
  statusClass: StatusClassSchema,
  retryable: z.boolean().nullable(),
  recoveredSameTurn: z.boolean(),
})

export const DisclosureFallbackDataSchema = z.looseObject({
  stepNumber: NonNegativeInt,
  reason: z.enum(['no_real_load', 'meta_tool_churn']).optional(),
})

export type FactBase = Readonly<{
  version: 1
  sourceEventId: string
  occurredAtMs: number
  source: AnalyticsSourceContext
}>

export const baseOf = (event: DebugEvent, source: AnalyticsSourceContext, suffix?: string): FactBase => ({
  version: 1,
  sourceEventId: `${event.turnId ?? 'unknown'}:${event.type}${suffix === undefined ? '' : `:${suffix}`}`,
  occurredAtMs: event.timestamp,
  source,
})

export const llmBaseOf = (event: DebugEvent, source: AnalyticsSourceContext, rawAttemptId: string): FactBase => ({
  version: 1,
  sourceEventId: `${rawAttemptId}:${event.type}`,
  occurredAtMs: event.timestamp,
  source,
})

/** Tool facts adopt the lifecycle-stable analyticsSourceId verbatim when the emitter provides one. */
export const toolBaseOf = (
  event: DebugEvent,
  source: AnalyticsSourceContext,
  analyticsSourceId: string | undefined,
): FactBase => {
  if (analyticsSourceId !== undefined) {
    return { version: 1, sourceEventId: analyticsSourceId, occurredAtMs: event.timestamp, source }
  }
  return baseOf(event, source)
}
