// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { subscribe as busSubscribe, unsubscribe as busUnsubscribe } from '../debug/event-bus.js'
import type { DebugEvent } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import { ErrorClassSchema, StatusClassSchema } from './controlled-types.js'
import type { AnalyticsObserver } from './runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from './source-facts.js'
import type { AuthorizedTurnContextRegistry } from './turn-context.js'

const log = logger.child({ scope: 'analytics:subscriber' })

const APPROVED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'llm:start',
  'llm:end',
  'llm:error',
  'tool:request',
  'tool:analytics_completed',
  'disclosure:fallback',
])

const NonNegativeInt = z.number().int().nonnegative()
const ModelRoleSchema = z.enum(['main', 'small'])

const LlmStartDataSchema = z.looseObject({
  model: z.string().min(1),
  messageCount: NonNegativeInt,
  toolCount: NonNegativeInt,
})

const FINISH_REASONS = ['stop', 'length', 'tool_calls', 'content_filter', 'error', 'other', 'unknown'] as const

const LlmEndDataSchema = z.looseObject({
  model: z.string().min(1),
  actualModel: z.string().optional(),
  steps: NonNegativeInt,
  totalDuration: z.number().nonnegative(),
  finishReason: z.enum(FINISH_REASONS).catch('unknown'),
  tokenUsage: z
    .looseObject({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })
    .nullable()
    .optional(),
})

const LlmErrorDataSchema = z.looseObject({
  model: z.string().min(1),
  durationMs: z.number().nonnegative(),
})

const ToolIdentitySchema = z.looseObject({
  toolName: z.string().min(1).max(128),
  toolCallId: z.string().min(1),
  argsBytes: NonNegativeInt,
  modelRole: ModelRoleSchema.optional(),
  origin: z.enum(['core', 'first_party_plugin', 'external_plugin', 'user_mcp']).optional(),
  domain: z
    .enum(['task', 'memo', 'schedule', 'attachment', 'web', 'identity', 'coding', 'config', 'meta', 'other'])
    .optional(),
  risk: z.enum(['read', 'write', 'destructive', 'open_world']).optional(),
})

const ToolCompletedDataSchema = ToolIdentitySchema.extend({
  durationMs: z.number().nonnegative(),
  executionOutcome: z.enum(['semantic_success', 'structured_failure', 'thrown_failure', 'permission_denied']),
  resultBytes: NonNegativeInt,
  errorClass: ErrorClassSchema.nullable(),
  statusClass: StatusClassSchema,
  retryable: z.boolean().nullable(),
  recoveredSameTurn: z.boolean(),
})

const DisclosureFallbackDataSchema = z.looseObject({
  stepNumber: NonNegativeInt,
  reason: z.enum(['no_real_load', 'meta_tool_churn']).optional(),
})

export type AnalyticsSubscriberDeps = Readonly<{
  observer: AnalyticsObserver
  registry: AuthorizedTurnContextRegistry
  subscribe?: (fn: (event: DebugEvent) => void) => void
  unsubscribe?: (fn: (event: DebugEvent) => void) => void
}>

type FactBase = Readonly<{
  version: 1
  sourceEventId: string
  occurredAtMs: number
  source: AnalyticsSourceContext
}>

const baseOf = (event: DebugEvent, source: AnalyticsSourceContext, suffix?: string): FactBase => ({
  version: 1,
  sourceEventId: `${event.turnId ?? 'unknown'}:${event.type}${suffix === undefined ? '' : `:${suffix}`}`,
  occurredAtMs: event.timestamp,
  source,
})

const mapEvent = (event: DebugEvent, source: AnalyticsSourceContext): AnalyticsSourceFact | null => {
  if (event.type === 'llm:start') {
    const data = LlmStartDataSchema.safeParse(event.data)
    if (!data.success) return null
    return {
      ...baseOf(event, source),
      type: 'llm_started',
      rawAttemptId: event.turnId ?? 'unknown',
      modelId: data.data.model,
      providerBinding: 'unmapped',
      modelRole: 'main',
      phase: 'generation',
      messageCount: data.data.messageCount,
      availableToolCount: data.data.toolCount,
    }
  }
  return mapTerminalEvent(event, source)
}

const mapTerminalEvent = (event: DebugEvent, source: AnalyticsSourceContext): AnalyticsSourceFact | null => {
  if (event.type === 'llm:end') {
    const data = LlmEndDataSchema.safeParse(event.data)
    if (!data.success) return null
    return {
      ...baseOf(event, source),
      type: 'llm_completed',
      rawAttemptId: event.turnId ?? 'unknown',
      modelId: data.data.actualModel ?? data.data.model,
      providerBinding: 'unmapped',
      modelRole: 'main',
      durationMs: data.data.totalDuration,
      timeToFirstTokenMs: null,
      inputTokens: data.data.tokenUsage?.inputTokens ?? null,
      outputTokens: data.data.tokenUsage?.outputTokens ?? null,
      stepCount: data.data.steps,
      finishReason: data.data.finishReason,
    }
  }
  if (event.type === 'llm:error') {
    const data = LlmErrorDataSchema.safeParse(event.data)
    if (!data.success) return null
    return {
      ...baseOf(event, source),
      type: 'llm_failed',
      rawAttemptId: event.turnId ?? 'unknown',
      modelId: data.data.model,
      providerBinding: 'unmapped',
      modelRole: 'main',
      phase: 'request',
      errorClass: 'llm_provider',
      retryable: null,
      durationMs: data.data.durationMs,
    }
  }
  return mapToolEvent(event, source)
}

const mapToolEvent = (event: DebugEvent, source: AnalyticsSourceContext): AnalyticsSourceFact | null => {
  if (event.type === 'tool:request') {
    const data = ToolIdentitySchema.safeParse(event.data)
    if (!data.success) return null
    return {
      ...baseOf(event, source, data.data.toolCallId),
      type: 'tool_started',
      toolSlug: data.data.toolName,
      toolOrigin: data.data.origin ?? 'core',
      toolDomain: data.data.domain ?? 'other',
      risk: data.data.risk ?? 'read',
      modelRole: data.data.modelRole ?? 'main',
      argsBytes: data.data.argsBytes,
    }
  }
  if (event.type === 'tool:analytics_completed') {
    const data = ToolCompletedDataSchema.safeParse(event.data)
    if (!data.success) return null
    return {
      ...baseOf(event, source, data.data.toolCallId),
      type: 'tool_completed',
      toolSlug: data.data.toolName,
      toolOrigin: data.data.origin ?? 'core',
      toolDomain: data.data.domain ?? 'other',
      risk: data.data.risk ?? 'read',
      modelRole: data.data.modelRole ?? 'main',
      argsBytes: data.data.argsBytes,
      durationMs: data.data.durationMs,
      executionOutcome: data.data.executionOutcome,
      resultBytes: data.data.resultBytes,
      errorClass: data.data.errorClass,
      statusClass: data.data.statusClass,
      retryable: data.data.retryable,
      recoveredSameTurn: data.data.recoveredSameTurn,
    }
  }
  if (event.type === 'disclosure:fallback') {
    const data = DisclosureFallbackDataSchema.safeParse(event.data)
    if (!data.success) return null
    return {
      ...baseOf(event, source),
      type: 'disclosure_fallback',
      reason: data.data.reason ?? 'no_real_load',
      stepCount: data.data.stepNumber,
    }
  }
  return null
}

const routeEvent = (observer: AnalyticsObserver, registry: AuthorizedTurnContextRegistry, event: DebugEvent): void => {
  if (!APPROVED_EVENT_TYPES.has(event.type)) return
  if (event.turnId === undefined) return
  const source = registry.resolve(event.turnId)
  if (source === null) return
  const fact = mapEvent(event, source)
  if (fact === null) return
  observer.observe(fact)
}

type ActiveSubscription = Readonly<{
  listener: (event: DebugEvent) => void
  unsubscribe: (fn: (event: DebugEvent) => void) => void
}>

let active: ActiveSubscription | null = null

export const initAnalyticsRuntime = (deps: AnalyticsSubscriberDeps): void => {
  if (active !== null) return
  const subscribeFn = deps.subscribe ?? busSubscribe
  const unsubscribeFn = deps.unsubscribe ?? busUnsubscribe
  const listener = (event: DebugEvent): void => {
    try {
      routeEvent(deps.observer, deps.registry, event)
    } catch (error) {
      log.warn(
        { eventType: event.type, errorClass: error instanceof Error ? error.constructor.name : 'non_error' },
        'analytics subscriber dropped event',
      )
    }
  }
  subscribeFn(listener)
  active = { listener, unsubscribe: unsubscribeFn }
  log.debug('analytics runtime subscribed')
}

export const stopAnalyticsRuntime = (): void => {
  if (active === null) return
  const current = active
  active = null
  current.unsubscribe(current.listener)
  log.debug('analytics runtime unsubscribed')
}
