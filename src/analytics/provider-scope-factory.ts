// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { resolveDeliveryPlatformInstanceId } from '../chat/delivery-routing.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { getStorageContextId } from '../deferred-prompts/proactive-llm-helpers.js'
import { getContextSettings } from '../instances/context-store.js'
import { getPlatformInstance } from '../instances/platform-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import { createProviderRequestObserver } from './provider-observer.js'
import type { ObserveProviderRequest } from './provider-observer.js'
import { createActorProviderRequestScope, NO_ANALYTICS_SCOPE } from './provider-request-scope.js'
import type { ProviderRequestScope } from './provider-request-scope.js'
import type { AnalyticsObserver } from './runtime.js'
import type { AnalyticsSourceContext } from './source-facts.js'
import { getActiveAnalyticsRuntime } from './start-analytics.js'

/** Minimal runtime view the scope resolvers need; tests inject fakes, production reads the active runtime. */
export type ProviderScopeRuntime = Readonly<{
  observer: AnalyticsObserver
  registry?: Readonly<{ resolve: (turnId: string) => AnalyticsSourceContext | null }>
}>

const taskProviderOf = (taskInstanceId: string | null): AnalyticsSourceContext['taskProvider'] => {
  if (taskInstanceId === null) return 'none'
  const type = getTaskInstance(taskInstanceId)?.type
  if (type === 'kaneo') return 'kaneo'
  if (type === 'youtrack') return 'youtrack'
  return 'other'
}

/**
 * Resolves the per-turn actor scope from the authorized-turn registry. Falls
 * back to the explicit `NO_ANALYTICS_SCOPE` sentinel when analytics is not
 * running or the turn was never registered (e.g. guest turns) — never throws.
 */
export const resolveNormalTurnProviderScope = (
  turnId: string,
  runtime: ProviderScopeRuntime | null = getActiveAnalyticsRuntime(),
): ProviderRequestScope => {
  const source = runtime?.registry?.resolve(turnId) ?? null
  if (runtime === null || source === null) return NO_ANALYTICS_SCOPE
  return createActorProviderRequestScope({
    requestContext: { source, sourceEventId: `${turnId}:provider_scope` },
    observeProviderRequest: createProviderRequestObserver(runtime.observer),
  })
}

export type ProactiveScopeInput = Readonly<{
  createdByUserId: string
  deliveryTarget: DeferredDeliveryTarget
}>

/**
 * Builds an independent immutable proactive scope from the prompt owner and
 * delivery target. Pure apart from platform/task instance lookups; the
 * observation callback is injected so tests can assert wiring without a
 * runtime. Returns `NO_ANALYTICS_SCOPE` when the platform is unresolvable.
 */
export const buildProactiveProviderRequestScope = (
  input: ProactiveScopeInput,
  observeProviderRequest: ObserveProviderRequest,
): ProviderRequestScope => {
  const platformInstanceId = resolveDeliveryPlatformInstanceId(input.deliveryTarget)
  if (platformInstanceId === null) return NO_ANALYTICS_SCOPE
  const instance = getPlatformInstance(platformInstanceId)
  if (instance === null) return NO_ANALYTICS_SCOPE
  const storageContextId = getStorageContextId(input.deliveryTarget)
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  const taskInstanceId = getContextSettings(configContextId)?.taskInstanceId ?? null
  const source: AnalyticsSourceContext = {
    platform: instance.type,
    platformInstanceId,
    chatUserId: input.createdByUserId,
    nativeContextId: input.deliveryTarget.contextId,
    storageContextId,
    configContextId,
    contextType: input.deliveryTarget.contextType,
    actorRole: 'member',
    taskInstanceId,
    taskProvider: taskProviderOf(taskInstanceId),
    invocationMode: 'proactive',
    rawTurnId: null,
  }
  return createActorProviderRequestScope({
    requestContext: { source, sourceEventId: `proactive:${storageContextId}:${randomUUID()}` },
    observeProviderRequest,
  })
}

/**
 * Resolves a proactive scope wired to the active analytics runtime. Falls back
 * to `NO_ANALYTICS_SCOPE` when analytics is not running or the platform is
 * unresolvable — never reuses a normal-turn or prior-owner scope.
 */
export const resolveProactiveProviderRequestScope = (
  input: ProactiveScopeInput,
  runtime: Pick<ProviderScopeRuntime, 'observer'> | null = getActiveAnalyticsRuntime(),
): ProviderRequestScope => {
  if (runtime === null) return NO_ANALYTICS_SCOPE
  return buildProactiveProviderRequestScope(input, createProviderRequestObserver(runtime.observer))
}
