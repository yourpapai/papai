// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { AnalyticsRequestContext } from '../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  isProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  ProviderScopeMissingError,
  requireProviderRequestScope,
  runWithoutProviderRequestScope,
  runWithProviderRequestScope,
  type ActorProviderRequestScope,
  type ProviderRequestScope,
} from '../../src/analytics/provider-request-scope.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'

const makeSource = (overrides: Partial<AnalyticsSourceContext> = {}): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-1',
  nativeContextId: 'chat-1',
  storageContextId: 'pi-1:chat-1',
  configContextId: 'pi-1:chat-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: 'ti-1',
  taskProvider: 'kaneo',
  invocationMode: 'normal',
  rawTurnId: 'turn-1',
  ...overrides,
})

const makeRequestContext = (source: AnalyticsSourceContext = makeSource()): AnalyticsRequestContext => ({
  source,
  sourceEventId: 'turn-1:scope',
})

const makeActorScope = (source: AnalyticsSourceContext = makeSource()): ActorProviderRequestScope =>
  createActorProviderRequestScope({
    requestContext: makeRequestContext(source),
    observeProviderRequest: () => {},
  })

// Spread-laundering keeps the declared type while injecting runtime-malformed
// fields, so fail-closed paths can be exercised without unsafe assertions.
const malformedScope = (overrides: object): ProviderRequestScope => ({ ...NO_ANALYTICS_SCOPE, ...overrides })

const malformedScopeInput = (overrides: object): Parameters<typeof createActorProviderRequestScope>[0] => ({
  requestContext: makeRequestContext(),
  observeProviderRequest: (): void => {},
  ...overrides,
})

const asError = (error: unknown): Error => {
  if (!(error instanceof Error)) throw new Error('expected an Error instance')
  return error
}

const asScopeMissing = (error: unknown): ProviderScopeMissingError => {
  if (!(error instanceof ProviderScopeMissingError)) throw new Error('expected ProviderScopeMissingError')
  return error
}

const expectScopeMissing = (error: unknown): void => {
  expect(error).toBeInstanceOf(ProviderScopeMissingError)
  expect(asScopeMissing(error).code).toBe('provider_scope_missing')
}

describe('createActorProviderRequestScope', () => {
  test('returns an immutable actor scope with frozen nested fields', () => {
    const scope = makeActorScope()
    expect(scope.kind).toBe('actor')
    expect(Object.isFrozen(scope)).toBe(true)
    expect(Object.isFrozen(scope.requestContext)).toBe(true)
    expect(Object.isFrozen(scope.requestContext.source)).toBe(true)
  })

  test('runtime-copies the approved fields so later caller mutation cannot leak in', () => {
    const source: { -readonly [K in keyof AnalyticsSourceContext]: AnalyticsSourceContext[K] } = makeSource()
    const requestContext: { -readonly [K in keyof AnalyticsRequestContext]: AnalyticsRequestContext[K] } =
      makeRequestContext(source)
    const scope = createActorProviderRequestScope({ requestContext, observeProviderRequest: () => {} })

    source.chatUserId = 'mutated-user'
    requestContext.sourceEventId = 'mutated-event'

    expect(scope.requestContext.source.chatUserId).toBe('user-1')
    expect(scope.requestContext.sourceEventId).toBe('turn-1:scope')
    expect(scope.requestContext.source).not.toBe(source)
  })

  test('rejects malformed request contexts', () => {
    expect(() =>
      createActorProviderRequestScope(
        malformedScopeInput({ requestContext: { source: { platform: 'telegram' }, sourceEventId: 'x' } }),
      ),
    ).toThrow()
    expect(() =>
      createActorProviderRequestScope({
        requestContext: { source: makeSource(), sourceEventId: '' },
        observeProviderRequest: () => {},
      }),
    ).toThrow()
    expect(() => createActorProviderRequestScope(malformedScopeInput({ observeProviderRequest: undefined }))).toThrow()
  })

  test('stores only the approved fields (no raw input, URL, payload, token, client, or provider)', () => {
    const scope = makeActorScope()
    expect(Object.keys(scope).toSorted()).toEqual(['kind', 'observeProviderRequest', 'requestContext'])
    expect(Object.keys(scope.requestContext).toSorted()).toEqual(['source', 'sourceEventId'])
  })
})

describe('NO_ANALYTICS_SCOPE', () => {
  test('is an explicit frozen sentinel', () => {
    expect(Object.isFrozen(NO_ANALYTICS_SCOPE)).toBe(true)
    expect(NO_ANALYTICS_SCOPE.kind).toBe('no_analytics')
  })

  test('permits the operation without observation', async () => {
    const result = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () => {
      expect(requireProviderRequestScope()).toBe(NO_ANALYTICS_SCOPE)
      return 'ran'
    })
    expect(result).toBe('ran')
  })
})

describe('runWithProviderRequestScope', () => {
  test('makes the active scope available to awaited work and returns the callback result', async () => {
    const scope = makeActorScope()
    const result = await runWithProviderRequestScope(scope, async () => {
      await Promise.resolve()
      expect(requireProviderRequestScope()).toBe(scope)
      return 42
    })
    expect(result).toBe(42)
  })

  test('throws the controlled provider_scope_missing failure for a missing or malformed scope', async () => {
    expect(isProviderRequestScope(undefined)).toBe(false)
    expect(isProviderRequestScope({ kind: 'actor' })).toBe(false)
    const malformed = await runWithProviderRequestScope(malformedScope({ kind: 'actor' }), () => 'never').catch(
      (e: unknown) => e,
    )
    expectScopeMissing(malformed)
    const wrongKind = await runWithProviderRequestScope(malformedScope({ kind: 'bogus' }), () => 'never').catch(
      (e: unknown) => e,
    )
    expectScopeMissing(wrongKind)
  })

  test('propagates callback rejections and still closes the lease', async () => {
    const scope = makeActorScope()
    let detached: (() => unknown) | undefined
    const error = await runWithProviderRequestScope(scope, () => {
      detached = (): unknown => requireProviderRequestScope()
      return Promise.reject(new Error('callback failed'))
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(asError(error).message).toBe('callback failed')
    expect(detached).toBeDefined()
    // Outside the frame (and outside any ambient test scope) the lease is closed.
    runWithoutProviderRequestScope(() => {
      expect(() => detached!()).toThrow(ProviderScopeMissingError)
    })
  })

  test('supports nested awaited work with independent scopes', async () => {
    const outer = makeActorScope(makeSource({ chatUserId: 'outer-user' }))
    const inner = makeActorScope(makeSource({ chatUserId: 'inner-user' }))

    const seen = await runWithProviderRequestScope(outer, async () => {
      const beforeInner = requireProviderRequestScope()
      const innerResult = await runWithProviderRequestScope(inner, async () => {
        await Promise.resolve()
        return requireProviderRequestScope()
      })
      const afterInner = requireProviderRequestScope()
      return { beforeInner, innerResult, afterInner }
    })

    expect(seen.beforeInner).toBe(outer)
    expect(seen.innerResult).toBe(inner)
    expect(seen.afterInner).toBe(outer)
  })

  test('overlapping scopes complete in reverse order without cross-talk', async () => {
    const scopeA = makeActorScope(makeSource({ chatUserId: 'user-a', rawTurnId: 'turn-a' }))
    const scopeB = makeActorScope(makeSource({ chatUserId: 'user-b', rawTurnId: 'turn-b' }))
    const seenByA: unknown[] = []
    const seenByB: unknown[] = []

    let releaseB!: () => void
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve
    })

    const runA = runWithProviderRequestScope(scopeA, async () => {
      seenByA.push(requireProviderRequestScope())
      await gateB
      seenByA.push(requireProviderRequestScope())
      return 'a-done'
    })
    const runB = runWithProviderRequestScope(scopeB, async () => {
      await Promise.resolve()
      seenByB.push(requireProviderRequestScope())
      releaseB()
      return 'b-done'
    })

    expect(await runB).toBe('b-done')
    expect(await runA).toBe('a-done')
    expect(seenByA).toEqual([scopeA, scopeA])
    expect(seenByB).toEqual([scopeB])
  })

  test('an operation intentionally detached past its root callback sees a closed lease, not stale actor state', async () => {
    const scope = makeActorScope()
    const lateOutcomes: unknown[] = []

    await runWithProviderRequestScope(scope, async () => {
      // Schedule work inside the live frame but let the root callback settle first.
      setTimeout(() => {
        try {
          lateOutcomes.push(requireProviderRequestScope())
        } catch (error) {
          lateOutcomes.push(error)
        }
      }, 0)
      await Promise.resolve()
    })

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })

    expect(lateOutcomes).toHaveLength(1)
    expectScopeMissing(lateOutcomes[0])
  })
})

describe('requireProviderRequestScope', () => {
  test('fails closed when no scope is active', () => {
    runWithoutProviderRequestScope(() => {
      try {
        requireProviderRequestScope()
        throw new Error('should have thrown')
      } catch (error) {
        expectScopeMissing(error)
      }
    })
  })

  test('never silently degrades a missing scope to NO_ANALYTICS_SCOPE', () => {
    runWithoutProviderRequestScope(() => {
      expect(() => requireProviderRequestScope()).toThrow(ProviderScopeMissingError)
    })
  })
})
