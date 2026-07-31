// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ObserveProviderRequest } from '../../src/analytics/provider-observer.js'
import {
  isProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  type ActorProviderRequestScope,
  type ProviderRequestScope,
} from '../../src/analytics/provider-request-scope.js'
import {
  buildProactiveProviderRequestScope,
  resolveNormalTurnProviderScope,
  resolveProactiveProviderRequestScope,
  type ProactiveScopeInput,
} from '../../src/analytics/provider-scope-factory.js'
import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import { createTurnContextRegistry } from '../../src/analytics/turn-context.js'
import { dmTarget } from '../../src/chat/deferred-target.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const scopedDmTarget = (nativeUserId: string): ProactiveScopeInput['deliveryTarget'] => ({
  ...dmTarget(toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: nativeUserId })),
  createdByUserId: nativeUserId,
})

const requireActorScope = (scope: ProviderRequestScope): ActorProviderRequestScope => {
  if (scope.kind !== 'actor') throw new Error('expected an actor scope')
  return scope
}

const normalSource = (turnId: string): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: 'telegram-default',
  chatUserId: 'user-1',
  nativeContextId: 'chat-1',
  storageContextId: 'telegram-default:chat-1',
  configContextId: 'telegram-default:chat-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: turnId,
})

const makeObserver = (): { observer: AnalyticsObserver; seen: unknown[] } => {
  const seen: unknown[] = []
  return {
    seen,
    observer: {
      observe: (fact: unknown) => {
        seen.push(fact)
      },
      flush: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    } satisfies AnalyticsObserver,
  }
}

describe('resolveNormalTurnProviderScope', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolves an actor scope from the registered turn source', () => {
    const registry = createTurnContextRegistry()
    registry.register({ turnId: 'turn-1', source: normalSource('turn-1') })
    const { observer, seen } = makeObserver()

    const scope = resolveNormalTurnProviderScope('turn-1', {
      registry: { resolve: (turnId: string) => registry.resolve(turnId) },
      observer,
    })

    expect(scope.kind).toBe('actor')
    const actorScope = requireActorScope(scope)
    expect(actorScope.requestContext.source.rawTurnId).toBe('turn-1')
    expect(actorScope.requestContext.source.invocationMode).toBe('normal')
    expect(Object.isFrozen(scope)).toBe(true)

    actorScope.observeProviderRequest(actorScope.requestContext, {
      provider: 'kaneo',
      operation: 'read',
      durationMs: 5,
      outcome: 'success',
      statusClass: '2xx',
      retryable: null,
    })
    expect(seen).toHaveLength(1)
  })

  test('falls back to NO_ANALYTICS_SCOPE when the turn is not registered', () => {
    const registry = createTurnContextRegistry()
    const { observer } = makeObserver()

    const scope = resolveNormalTurnProviderScope('turn-unknown', {
      registry: { resolve: (turnId: string) => registry.resolve(turnId) },
      observer,
    })

    expect(scope).toBe(NO_ANALYTICS_SCOPE)
  })

  test('falls back to NO_ANALYTICS_SCOPE when the runtime is absent', () => {
    expect(resolveNormalTurnProviderScope('turn-1', null)).toBe(NO_ANALYTICS_SCOPE)
  })
})

describe('buildProactiveProviderRequestScope', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
  })

  test('builds an immutable proactive actor scope from owner and delivery target', () => {
    const observeProviderRequest: ObserveProviderRequest = mock(() => {})

    const scope = buildProactiveProviderRequestScope(
      { createdByUserId: 'user-1', deliveryTarget: scopedDmTarget('user-1') },
      observeProviderRequest,
    )

    expect(isProviderRequestScope(scope)).toBe(true)
    expect(scope.kind).toBe('actor')
    const actorScope = requireActorScope(scope)
    expect(actorScope.requestContext.source.platform).toBe('telegram')
    expect(actorScope.requestContext.source.platformInstanceId).toBe('telegram-default')
    expect(actorScope.requestContext.source.chatUserId).toBe('user-1')
    expect(actorScope.requestContext.source.invocationMode).toBe('proactive')
    expect(actorScope.requestContext.source.rawTurnId).toBeNull()
    expect(actorScope.requestContext.source.actorRole).toBe('member')
    expect(Object.isFrozen(scope)).toBe(true)
  })

  test('builds independent scopes for consecutive owners', () => {
    const observeProviderRequest: ObserveProviderRequest = mock(() => {})

    const scopeA = buildProactiveProviderRequestScope(
      { createdByUserId: 'user-a', deliveryTarget: scopedDmTarget('user-a') },
      observeProviderRequest,
    )
    const scopeB = buildProactiveProviderRequestScope(
      { createdByUserId: 'user-b', deliveryTarget: scopedDmTarget('user-b') },
      observeProviderRequest,
    )

    expect(scopeA).not.toBe(scopeB)
    const actorA = requireActorScope(scopeA)
    const actorB = requireActorScope(scopeB)
    expect(actorA.requestContext.source.chatUserId).toBe('user-a')
    expect(actorB.requestContext.source.chatUserId).toBe('user-b')
    expect(actorA.requestContext.sourceEventId).not.toBe(actorB.requestContext.sourceEventId)
  })

  test('falls back to NO_ANALYTICS_SCOPE when the platform instance cannot be resolved', () => {
    const observeProviderRequest: ObserveProviderRequest = mock(() => {})

    const scope = buildProactiveProviderRequestScope(
      {
        createdByUserId: 'user-1',
        deliveryTarget: { ...dmTarget('unknown-instance:user-1'), createdByUserId: 'user-1' },
      },
      observeProviderRequest,
    )

    expect(scope).toBe(NO_ANALYTICS_SCOPE)
  })
})

describe('resolveProactiveProviderRequestScope', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
  })

  test('falls back to NO_ANALYTICS_SCOPE when the runtime is absent', () => {
    const scope = resolveProactiveProviderRequestScope(
      { createdByUserId: 'user-1', deliveryTarget: scopedDmTarget('user-1') },
      null,
    )
    expect(scope).toBe(NO_ANALYTICS_SCOPE)
  })

  test('resolves an actor scope wired to the runtime observer', () => {
    const { observer, seen } = makeObserver()

    const scope = resolveProactiveProviderRequestScope(
      { createdByUserId: 'user-1', deliveryTarget: scopedDmTarget('user-1') },
      { observer },
    )

    expect(scope.kind).toBe('actor')
    const actorScope = requireActorScope(scope)
    actorScope.observeProviderRequest(actorScope.requestContext, {
      provider: 'youtrack',
      operation: 'search',
      durationMs: 3,
      outcome: 'failure',
      statusClass: '5xx',
      retryable: true,
    })
    expect(seen).toHaveLength(1)
  })
})
