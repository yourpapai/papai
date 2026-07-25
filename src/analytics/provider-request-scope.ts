// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { AsyncLocalStorage } from 'node:async_hooks'

import type { AnalyticsRequestContext, ObserveProviderRequest } from './provider-observer.js'
import type { AnalyticsSourceContext } from './source-facts.js'

export const PROVIDER_SCOPE_MISSING_MESSAGE = 'provider request scope is missing, malformed, or closed'

/** Controlled failure raised before fetch/SDK I/O when no live provider request scope is available. */
export class ProviderScopeMissingError extends Error {
  readonly code = 'provider_scope_missing' as const

  constructor(message: string = PROVIDER_SCOPE_MISSING_MESSAGE) {
    super(message)
    this.name = 'ProviderScopeMissingError'
  }
}

export type ActorProviderRequestScope = Readonly<{
  kind: 'actor'
  requestContext: AnalyticsRequestContext
  observeProviderRequest: ObserveProviderRequest
}>

export type NoAnalyticsScope = Readonly<{
  kind: 'no_analytics'
}>

/**
 * Explicit sentinel for intentionally operational/bootstrap paths: permits the
 * operation WITHOUT observation. Absence of a scope never silently degrades to
 * this sentinel — it must be passed deliberately at the call site.
 */
export const NO_ANALYTICS_SCOPE: NoAnalyticsScope = Object.freeze({ kind: 'no_analytics' })

export type ProviderRequestScope = ActorProviderRequestScope | NoAnalyticsScope

const PLATFORM_VALUES: ReadonlySet<string> = new Set(['telegram', 'mattermost', 'discord', 'kontur-talk'])
const CONTEXT_TYPE_VALUES: ReadonlySet<string> = new Set(['dm', 'group'])
const ACTOR_ROLE_VALUES: ReadonlySet<string> = new Set(['admin', 'member', 'guest', 'system'])
const TASK_PROVIDER_VALUES: ReadonlySet<string> = new Set(['kaneo', 'youtrack', 'none', 'other'])
const INVOCATION_MODE_VALUES: ReadonlySet<string> = new Set(['normal', 'command', 'settings', 'proactive', 'scheduler'])

const isNullableString = (value: unknown): boolean => value === null || typeof value === 'string'
const isEnumValue = (value: unknown, allowed: ReadonlySet<string>): boolean =>
  typeof value === 'string' && allowed.has(value)

const isAnalyticsSourceContext = (value: unknown): value is AnalyticsSourceContext => {
  if (typeof value !== 'object' || value === null) return false
  return (
    isEnumValue(Reflect.get(value, 'platform'), PLATFORM_VALUES) &&
    typeof Reflect.get(value, 'platformInstanceId') === 'string' &&
    isNullableString(Reflect.get(value, 'chatUserId')) &&
    typeof Reflect.get(value, 'nativeContextId') === 'string' &&
    typeof Reflect.get(value, 'storageContextId') === 'string' &&
    typeof Reflect.get(value, 'configContextId') === 'string' &&
    isEnumValue(Reflect.get(value, 'contextType'), CONTEXT_TYPE_VALUES) &&
    isEnumValue(Reflect.get(value, 'actorRole'), ACTOR_ROLE_VALUES) &&
    isNullableString(Reflect.get(value, 'taskInstanceId')) &&
    isEnumValue(Reflect.get(value, 'taskProvider'), TASK_PROVIDER_VALUES) &&
    isEnumValue(Reflect.get(value, 'invocationMode'), INVOCATION_MODE_VALUES) &&
    isNullableString(Reflect.get(value, 'rawTurnId'))
  )
}

const isAnalyticsRequestContext = (value: unknown): value is AnalyticsRequestContext => {
  if (typeof value !== 'object' || value === null) return false
  const sourceEventId: unknown = Reflect.get(value, 'sourceEventId')
  return (
    isAnalyticsSourceContext(Reflect.get(value, 'source')) && typeof sourceEventId === 'string' && sourceEventId !== ''
  )
}

const isActorProviderRequestScope = (value: unknown): value is ActorProviderRequestScope => {
  if (typeof value !== 'object' || value === null) return false
  return (
    Reflect.get(value, 'kind') === 'actor' &&
    isAnalyticsRequestContext(Reflect.get(value, 'requestContext')) &&
    typeof Reflect.get(value, 'observeProviderRequest') === 'function'
  )
}

export const isProviderRequestScope = (value: unknown): value is ProviderRequestScope =>
  isActorProviderRequestScope(value) || value === NO_ANALYTICS_SCOPE

/**
 * Validating scope constructor. Runtime-copies and freezes the approved fields
 * so later caller-side mutation cannot leak into the immutable scope. Never
 * stores raw input, URLs, payloads, tokens, clients, or provider objects.
 */
export const createActorProviderRequestScope = (
  input: Readonly<{
    requestContext: AnalyticsRequestContext
    observeProviderRequest: ObserveProviderRequest
  }>,
): ActorProviderRequestScope => {
  if (!isAnalyticsRequestContext(input.requestContext)) {
    throw new TypeError('malformed analytics request context for provider request scope')
  }
  if (typeof input.observeProviderRequest !== 'function') {
    throw new TypeError('provider request scope requires an observeProviderRequest callback')
  }
  const source: AnalyticsSourceContext = Object.freeze({ ...input.requestContext.source })
  const requestContext: AnalyticsRequestContext = Object.freeze({
    source,
    sourceEventId: input.requestContext.sourceEventId,
  })
  return Object.freeze({
    kind: 'actor',
    requestContext,
    observeProviderRequest: input.observeProviderRequest,
  })
}

/**
 * Internal frame: the immutable public scope plus a private lifetime lease.
 * The lease is only a detached-work guard — it never mutates the public scope.
 */
type InternalProviderRequestFrame = Readonly<{
  scope: ProviderRequestScope
  lease: { closed: boolean }
}>

const storage = new AsyncLocalStorage<InternalProviderRequestFrame>()

const resolveScope = (scope: unknown): ProviderRequestScope => {
  if (isProviderRequestScope(scope)) return scope
  throw new ProviderScopeMissingError()
}

/**
 * Runs the callback with the given scope active, awaiting it fully and closing
 * the internal lifetime lease in `finally`. Work intentionally detached past
 * the root callback observes a closed lease rather than stale actor state.
 */
export const runWithProviderRequestScope = async <T>(
  scope: ProviderRequestScope,
  callback: () => T | Promise<T>,
): Promise<T> => {
  const resolved = resolveScope(scope)
  const lease = { closed: false }
  try {
    return await storage.run({ scope: resolved, lease }, callback)
  } finally {
    lease.closed = true
  }
}

/**
 * Fail-closed boundary accessor. Raises the controlled `provider_scope_missing`
 * failure when no frame is active, the frame is malformed, or its lease closed.
 */
export const requireProviderRequestScope = (): ProviderRequestScope => {
  const frame = storage.getStore()
  if (frame === undefined || frame.lease === null || typeof frame.lease !== 'object') {
    throw new ProviderScopeMissingError()
  }
  if (frame.lease.closed) {
    throw new ProviderScopeMissingError('provider request scope lease is closed')
  }
  return resolveScope(frame.scope)
}
