// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import {
  actorBasisOf,
  FEATURE_OPPORTUNITY_REFERENCE_DOMAIN,
  featureOpportunitySourceReference,
  utcDayOf,
} from './feature-opportunity.js'
import type { FeatureOpportunityInput, FeatureV1 } from './feature-opportunity.js'
import type { AnalyticsRequestContext } from './provider-observer.js'
import { getProviderRequestScope } from './provider-request-scope.js'
import type { AnalyticsObserver } from './runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from './source-facts.js'
import { getActiveAnalyticsRuntime } from './start-analytics.js'

export {
  FEATURE_OPPORTUNITY_REFERENCE_DOMAIN,
  FEATURE_PRODUCERS,
  FEATURE_V1,
  featureOpportunitySnapshot,
  featureOpportunitySourceReference,
} from './feature-opportunity.js'
export type {
  FeatureOpportunityInput,
  FeatureOpportunityReason,
  FeatureOpportunitySurface,
  FeatureV1,
} from './feature-opportunity.js'

export type FeatureUsedOperation =
  | 'create'
  | 'read'
  | 'search'
  | 'update'
  | 'delete'
  | 'start'
  | 'continue'
  | 'monitor'
  | 'review'
  | 'finish'
  | 'enable'

export type FeatureOutcome = 'success' | 'failure' | 'blocked'

export type McpAvailabilityOrigin = 'user_endpoint' | 'plugin_endpoint' | 'coding_broker'
export type McpAvailabilityOutcome = 'available' | 'connection_failed' | 'timeout' | 'auth_failed' | 'policy_blocked'
export type ConfigLinkIssuedResult = 'issued' | 'not_configured' | 'rate_limited'
export type SettingsOpenedEntry = 'config_link' | 'existing_session'
export type SettingsOpenedResult = 'success' | 'expired' | 'invalid'
export type TaskProviderName = 'kaneo' | 'youtrack' | 'none' | 'other'
export type RateLimitName = 'web_fetch' | 'settings_link' | 'provider' | 'other'
export type UnconfiguredMissing =
  | 'central_llm'
  | 'task_instance'
  | 'settings_base_url'
  | 'provider_credentials'
  | 'coding_credentials'
  | 'forge_credentials'
  | 'other'
export type UnconfiguredSurface = 'chat' | 'settings' | 'coding'

export type FeatureUsedInput = Readonly<{
  feature: FeatureV1
  operation: FeatureUsedOperation
  outcome: FeatureOutcome
  codingProjectRawId?: string
  codingSessionRawId?: string
}>

export type FeatureObserver = Readonly<{
  featureUsed: (requestContext: AnalyticsRequestContext, input: FeatureUsedInput) => void
  featureOpportunity: (requestContext: AnalyticsRequestContext, input: FeatureOpportunityInput) => void
  mcpAvailability: (
    requestContext: AnalyticsRequestContext,
    input: Readonly<{ origin: McpAvailabilityOrigin; serverRawId: string; outcome: McpAvailabilityOutcome }>,
  ) => void
  configLinkIssued: (requestContext: AnalyticsRequestContext, result: ConfigLinkIssuedResult) => void
  settingsOpened: (
    requestContext: AnalyticsRequestContext,
    input: Readonly<{ entry: SettingsOpenedEntry; result: SettingsOpenedResult }>,
  ) => void
  taskInstanceAssigned: (
    requestContext: AnalyticsRequestContext,
    input: Readonly<{
      change: 'first_assignment' | 'changed'
      fromProvider: TaskProviderName
      toProvider: Exclude<TaskProviderName, 'none'>
    }>,
  ) => void
  rateLimitBlocked: (requestContext: AnalyticsRequestContext, limit: RateLimitName) => void
  unconfiguredReply: (
    requestContext: AnalyticsRequestContext,
    input: Readonly<{ missing: UnconfiguredMissing; surface: UnconfiguredSurface }>,
  ) => void
}>

type FactBase = Readonly<{
  version: 1
  sourceEventId: string
  occurredAtMs: number
  source: AnalyticsSourceContext
}>

type FactBaseBuilder = (requestContext: AnalyticsRequestContext, kind: string) => FactBase
type FactEmitter = (fact: AnalyticsSourceFact) => void

const createFeatureEmitters = (
  base: FactBaseBuilder,
  emit: FactEmitter,
): Pick<FeatureObserver, 'featureUsed' | 'featureOpportunity'> => ({
  featureUsed: (requestContext, input): void => {
    emit({
      ...base(requestContext, 'feature_used'),
      type: 'feature_used',
      feature: input.feature,
      operation: input.operation,
      outcome: input.outcome,
      codingProjectRawId: input.codingProjectRawId ?? null,
      codingSessionRawId: input.codingSessionRawId ?? null,
    })
  },
  featureOpportunity: (requestContext, input): void => {
    const occurredAtMs = input.nowMs ?? Date.now()
    const reference = featureOpportunitySourceReference({
      actorBasis: actorBasisOf(requestContext),
      feature: input.feature,
      utcDay: utcDayOf(occurredAtMs),
    })
    emit({
      version: 1,
      sourceEventId: `${FEATURE_OPPORTUNITY_REFERENCE_DOMAIN}:${reference}`,
      occurredAtMs,
      source: requestContext.source,
      type: 'feature_opportunity',
      feature: input.feature,
      available: input.available,
      reason: input.reason,
      sampling: 'first_eligible_actor_day',
    })
  },
})

const createConfigMilestoneEmitters = (
  base: FactBaseBuilder,
  emit: FactEmitter,
): Pick<FeatureObserver, 'mcpAvailability' | 'configLinkIssued' | 'settingsOpened'> => ({
  mcpAvailability: (requestContext, input): void => {
    emit({
      ...base(requestContext, 'mcp_availability'),
      type: 'mcp_availability',
      origin: input.origin,
      serverRawId: input.serverRawId,
      outcome: input.outcome,
    })
  },
  configLinkIssued: (requestContext, result): void => {
    emit({ ...base(requestContext, 'config_link_issued'), type: 'config_link_issued', result })
  },
  settingsOpened: (requestContext, input): void => {
    emit({
      ...base(requestContext, 'settings_opened'),
      type: 'settings_opened',
      entry: input.entry,
      result: input.result,
    })
  },
})

const createTaskMilestoneEmitters = (
  base: FactBaseBuilder,
  emit: FactEmitter,
): Pick<FeatureObserver, 'taskInstanceAssigned' | 'rateLimitBlocked' | 'unconfiguredReply'> => ({
  taskInstanceAssigned: (requestContext, input): void => {
    emit({
      ...base(requestContext, 'task_instance_assigned'),
      type: 'task_instance_assigned',
      change: input.change,
      fromProvider: input.fromProvider,
      toProvider: input.toProvider,
    })
  },
  rateLimitBlocked: (requestContext, limit): void => {
    emit({ ...base(requestContext, 'rate_limit_blocked'), type: 'rate_limit_blocked', limit })
  },
  unconfiguredReply: (requestContext, input): void => {
    emit({
      ...base(requestContext, 'unconfigured_reply'),
      type: 'unconfigured_reply',
      missing: input.missing,
      surface: input.surface,
    })
  },
})

/**
 * Binds an `AnalyticsObserver` into metadata-only feature/milestone emitters.
 * Every emitter is stable and non-throwing: an observation failure must never
 * change product behavior. Only controlled enum/metadata fields cross the
 * boundary — never URLs, names, filenames, keys, tokens, or payload text.
 */
export const createFeatureObserver = (observer: AnalyticsObserver): FeatureObserver => {
  const emit: FactEmitter = (fact) => {
    try {
      observer.observe(fact)
    } catch {
      // Observation must never change product behavior.
    }
  }

  const base: FactBaseBuilder = (requestContext, kind) => ({
    version: 1,
    sourceEventId: `${requestContext.sourceEventId}:${kind}:${randomUUID()}`,
    occurredAtMs: Date.now(),
    source: requestContext.source,
  })

  return {
    ...createFeatureEmitters(base, emit),
    ...createConfigMilestoneEmitters(base, emit),
    ...createTaskMilestoneEmitters(base, emit),
  }
}

/** The feature observer bound to the active analytics runtime, or null when analytics is not running. */
export const resolveActiveFeatureObserver = (): FeatureObserver | null => {
  const runtime = getActiveAnalyticsRuntime()
  if (runtime === null) return null
  return createFeatureObserver(runtime.observer)
}

let testingObserver: FeatureObserver | null = null

/** Test-only seam: pins the observer boundaries resolve, bypassing the global runtime. */
export const setFeatureObserverForTesting = (observer: FeatureObserver | null): void => {
  testingObserver = observer
}

/** The observer feature boundaries emit through; null when analytics is off (facts are skipped). */
export const getFeatureObserver = (): FeatureObserver | null => testingObserver ?? resolveActiveFeatureObserver()

/** The actor request context of the active provider request scope, or null for operational/no scopes. */
export const activeActorRequestContext = (): AnalyticsRequestContext | null => {
  const scope = getProviderRequestScope()
  if (scope === null || scope.kind !== 'actor') return null
  return scope.requestContext
}

/**
 * Emits a `feature_used` fact against the active actor scope. Skips silently
 * when analytics is off, the scope is operational, or no actor is active —
 * feature attribution is never inferred.
 */
export const observeActiveFeatureUsed = (input: FeatureUsedInput): void => {
  const requestContext = activeActorRequestContext()
  const observer = getFeatureObserver()
  if (requestContext === null || observer === null) return
  observer.featureUsed(requestContext, input)
}
