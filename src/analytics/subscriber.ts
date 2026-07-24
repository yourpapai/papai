// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { subscribe as busSubscribe, unsubscribe as busUnsubscribe } from '../debug/event-bus.js'
import type { DebugEvent } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { AnalyticsObserver } from './runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from './source-facts.js'
import {
  attemptIdentityOf,
  baseOf,
  DisclosureFallbackDataSchema,
  LlmEndDataSchema,
  LlmErrorDataSchema,
  LlmStartDataSchema,
  llmBaseOf,
  ToolCompletedDataSchema,
  ToolIdentitySchema,
  toolBaseOf,
} from './subscriber-schemas.js'
import { classifyAnalyticsTool } from './tool-classification.js'
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

export type AnalyticsSubscriberDeps = Readonly<{
  observer: AnalyticsObserver
  registry: AuthorizedTurnContextRegistry
  subscribe?: (fn: (event: DebugEvent) => void) => void
  unsubscribe?: (fn: (event: DebugEvent) => void) => void
}>

const mapEvent = (event: DebugEvent, source: AnalyticsSourceContext): AnalyticsSourceFact | null => {
  if (event.type === 'llm:start') {
    const data = LlmStartDataSchema.safeParse(event.data)
    if (!data.success) return null
    const turnId = event.turnId
    if (turnId === undefined) return null
    const attempt = attemptIdentityOf(turnId, data.data)
    return {
      ...llmBaseOf(event, source, attempt.rawAttemptId),
      type: 'llm_started',
      rawAttemptId: attempt.rawAttemptId,
      modelId: data.data.model,
      providerBinding: attempt.providerBinding,
      modelRole: attempt.modelRole,
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
    const turnId = event.turnId
    if (turnId === undefined) return null
    const attempt = attemptIdentityOf(turnId, data.data)
    return {
      ...llmBaseOf(event, source, attempt.rawAttemptId),
      type: 'llm_completed',
      rawAttemptId: attempt.rawAttemptId,
      modelId: data.data.actualModel ?? data.data.model,
      providerBinding: attempt.providerBinding,
      modelRole: attempt.modelRole,
      durationMs: data.data.totalDuration,
      timeToFirstTokenMs: data.data.timeToFirstTokenMs ?? null,
      inputTokens: data.data.tokenUsage?.inputTokens ?? null,
      outputTokens: data.data.tokenUsage?.outputTokens ?? null,
      stepCount: data.data.steps,
      finishReason: data.data.finishReason,
    }
  }
  if (event.type === 'llm:error') {
    const data = LlmErrorDataSchema.safeParse(event.data)
    if (!data.success) return null
    const turnId = event.turnId
    if (turnId === undefined) return null
    const attempt = attemptIdentityOf(turnId, data.data)
    return {
      ...llmBaseOf(event, source, attempt.rawAttemptId),
      type: 'llm_failed',
      rawAttemptId: attempt.rawAttemptId,
      modelId: data.data.model,
      providerBinding: attempt.providerBinding,
      modelRole: attempt.modelRole,
      phase: data.data.phase ?? 'request',
      errorClass: data.data.errorClass ?? 'llm_provider',
      retryable: data.data.retryable ?? null,
      durationMs: data.data.durationMs,
    }
  }
  return mapToolEvent(event, source)
}

const mapToolEvent = (event: DebugEvent, source: AnalyticsSourceContext): AnalyticsSourceFact | null => {
  if (event.type === 'tool:request') {
    const data = ToolIdentitySchema.safeParse(event.data)
    if (!data.success) return null
    const tool = classifyAnalyticsTool(data.data.toolName)
    return {
      ...toolBaseOf(event, source, data.data.analyticsSourceId),
      type: 'tool_started',
      toolSlug: tool.toolSlug,
      toolOrigin: tool.toolOrigin,
      toolDomain: tool.toolDomain,
      risk: tool.risk,
      modelRole: data.data.modelRole ?? 'main',
      argsBytes: data.data.argsBytes,
    }
  }
  if (event.type === 'tool:analytics_completed') {
    const data = ToolCompletedDataSchema.safeParse(event.data)
    if (!data.success) return null
    const tool = classifyAnalyticsTool(data.data.toolName)
    return {
      ...toolBaseOf(event, source, data.data.analyticsSourceId),
      type: 'tool_completed',
      toolSlug: tool.toolSlug,
      toolOrigin: tool.toolOrigin,
      toolDomain: tool.toolDomain,
      risk: tool.risk,
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
