// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  classifyProviderError,
  classifyStatusClass,
  createProviderRequestClock,
  createProviderRequestObserver,
} from '../../src/analytics/provider-observer.js'
import type { AnalyticsRequestContext, ProviderRequestObservation } from '../../src/analytics/provider-observer.js'
import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../../src/analytics/source-facts.js'

const makeSource = (): AnalyticsSourceContext => ({
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
})

const makeRequestContext = (): AnalyticsRequestContext => ({
  source: makeSource(),
  sourceEventId: 'turn-1:scope',
})

const makeObservation = (overrides: Partial<ProviderRequestObservation> = {}): ProviderRequestObservation => ({
  provider: 'kaneo',
  operation: 'read',
  durationMs: 12.6,
  outcome: 'success',
  statusClass: '2xx',
  retryable: null,
  ...overrides,
})

const OBSERVATION_KEYS = ['provider', 'operation', 'durationMs', 'outcome', 'statusClass', 'retryable'] as const

describe('classifyStatusClass', () => {
  test('maps 2xx and 3xx bands', () => {
    expect(classifyStatusClass(200)).toBe('2xx')
    expect(classifyStatusClass(204)).toBe('2xx')
    expect(classifyStatusClass(301)).toBe('3xx')
    expect(classifyStatusClass(399)).toBe('3xx')
  })

  test('maps 4xx and 5xx bands', () => {
    expect(classifyStatusClass(400)).toBe('4xx')
    expect(classifyStatusClass(404)).toBe('4xx')
    expect(classifyStatusClass(429)).toBe('4xx')
    expect(classifyStatusClass(500)).toBe('5xx')
    expect(classifyStatusClass(503)).toBe('5xx')
  })

  test('maps auth statuses to the auth class', () => {
    expect(classifyStatusClass(401)).toBe('auth')
    expect(classifyStatusClass(403)).toBe('auth')
  })

  test('maps out-of-band statuses to other', () => {
    expect(classifyStatusClass(0)).toBe('other')
    expect(classifyStatusClass(99)).toBe('other')
    expect(classifyStatusClass(600)).toBe('other')
    expect(classifyStatusClass(-1)).toBe('other')
  })
})

describe('classifyProviderError', () => {
  test('classifies status-bearing errors with retryable for 5xx and 429', () => {
    expect(classifyProviderError(Object.assign(new Error('boom'), { statusCode: 503 }))).toEqual({
      statusClass: '5xx',
      retryable: true,
    })
    expect(classifyProviderError(Object.assign(new Error('boom'), { status: 429 }))).toEqual({
      statusClass: '4xx',
      retryable: true,
    })
  })

  test('classifies 4xx statuses as non-retryable and auth statuses distinctly', () => {
    expect(classifyProviderError(Object.assign(new Error('nope'), { statusCode: 404 }))).toEqual({
      statusClass: '4xx',
      retryable: false,
    })
    expect(classifyProviderError(Object.assign(new Error('denied'), { status: 403 }))).toEqual({
      statusClass: 'auth',
      retryable: false,
    })
  })

  test('classifies timeout-style errors as timeout and retryable', () => {
    const timeoutError = new Error('The operation timed out')
    timeoutError.name = 'TimeoutError'
    expect(classifyProviderError(timeoutError)).toEqual({ statusClass: 'timeout', retryable: true })

    const abortError = new Error('This operation was aborted')
    abortError.name = 'AbortError'
    expect(classifyProviderError(abortError)).toEqual({ statusClass: 'timeout', retryable: true })

    expect(classifyProviderError(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }))).toEqual({
      statusClass: 'timeout',
      retryable: true,
    })
  })

  test('classifies network failures as network and retryable', () => {
    expect(classifyProviderError(new TypeError('fetch failed'))).toEqual({ statusClass: 'network', retryable: true })
    expect(classifyProviderError(Object.assign(new Error('dns'), { code: 'ENOTFOUND' }))).toEqual({
      statusClass: 'network',
      retryable: true,
    })
    expect(classifyProviderError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toEqual({
      statusClass: 'network',
      retryable: true,
    })
  })

  test('returns controlled values for non-Error throws', () => {
    expect(classifyProviderError('plain string failure')).toEqual({ statusClass: 'other', retryable: null })
    expect(classifyProviderError(42)).toEqual({ statusClass: 'other', retryable: null })
    expect(classifyProviderError(null)).toEqual({ statusClass: 'other', retryable: null })
    expect(classifyProviderError(undefined)).toEqual({ statusClass: 'other', retryable: null })
  })

  test('returns controlled values for plain errors without a status', () => {
    expect(classifyProviderError(new Error('unclassified'))).toEqual({ statusClass: 'other', retryable: null })
  })

  test('never leaks URLs, bodies, or tokens into the classification', () => {
    const leaky = Object.assign(new Error('request failed'), {
      statusCode: 502,
      url: 'https://secret-host.example/path?token=abc123',
      responseBody: '{"secret":"d0-N0t-Leak"}',
      requestBody: 'super-secret-payload',
    })
    const classification = classifyProviderError(leaky)
    const serialized = JSON.stringify(classification)
    expect(serialized).not.toContain('secret-host.example')
    expect(serialized).not.toContain('abc123')
    expect(serialized).not.toContain('d0-N0t-Leak')
    expect(serialized).not.toContain('super-secret-payload')
    expect(Object.keys(classification).toSorted()).toEqual(['retryable', 'statusClass'])
  })
})

describe('createProviderRequestClock', () => {
  test('measures elapsed time from the injected monotonic clock', () => {
    let now = 1000
    const clock = createProviderRequestClock(() => now)
    now = 1012
    expect(clock.elapsedMs()).toBe(12)
  })

  test('clamps negative drift to zero', () => {
    let now = 1000
    const clock = createProviderRequestClock(() => now)
    now = 999
    expect(clock.elapsedMs()).toBe(0)
  })

  test('uses a monotonic default clock', () => {
    const clock = createProviderRequestClock()
    expect(clock.elapsedMs()).toBeGreaterThanOrEqual(0)
  })
})

describe('createProviderRequestObserver', () => {
  const requireCompletedFact = (
    fact: AnalyticsSourceFact,
  ): Extract<AnalyticsSourceFact, { type: 'provider_request_completed' }> => {
    if (fact.type !== 'provider_request_completed') throw new Error('unexpected fact type')
    return fact
  }

  const recordFacts = (): { observer: AnalyticsObserver; facts: AnalyticsSourceFact[] } => {
    const facts: AnalyticsSourceFact[] = []
    return {
      facts,
      observer: {
        observe: (fact) => {
          facts.push(fact)
        },
        flush: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      },
    }
  }

  test('emits a provider_request_completed fact with metadata only', () => {
    const { observer, facts } = recordFacts()
    const observe = createProviderRequestObserver(observer)
    const requestContext = makeRequestContext()

    observe(requestContext, makeObservation())

    expect(facts).toHaveLength(1)
    const fact = facts[0]!
    expect(fact.type).toBe('provider_request_completed')
    expect(fact.source).toEqual(makeSource())
    expect(fact.sourceEventId.startsWith('turn-1:scope')).toBe(true)
    const completed = requireCompletedFact(fact)
    expect(completed.provider).toBe('kaneo')
    expect(completed.operation).toBe('read')
    expect(completed.durationMs).toBe(13)
    expect(completed.outcome).toBe('success')
    expect(completed.statusClass).toBe('2xx')
    expect(completed.retryable).toBeNull()
  })

  test('clamps negative durations and keeps failure outcomes', () => {
    const { observer, facts } = recordFacts()
    const observe = createProviderRequestObserver(observer)

    observe(
      makeRequestContext(),
      makeObservation({ durationMs: -5, outcome: 'failure', statusClass: 'network', retryable: true }),
    )

    const fact = facts[0]!
    const completed = requireCompletedFact(fact)
    expect(completed.durationMs).toBe(0)
    expect(completed.outcome).toBe('failure')
    expect(completed.statusClass).toBe('network')
    expect(completed.retryable).toBe(true)
  })

  test('observation carries exactly the approved metadata keys', () => {
    const observation = makeObservation()
    expect(Object.keys(observation).toSorted()).toEqual([...OBSERVATION_KEYS].toSorted())
    const serialized = JSON.stringify(observation)
    expect(serialized).not.toContain('url')
    expect(serialized).not.toContain('body')
    expect(serialized).not.toContain('token')
  })

  test('emits unique source event ids per request', () => {
    const { observer, facts } = recordFacts()
    const observe = createProviderRequestObserver(observer)
    const requestContext = makeRequestContext()

    observe(requestContext, makeObservation())
    observe(requestContext, makeObservation())

    expect(facts).toHaveLength(2)
    expect(facts[0]!.sourceEventId).not.toBe(facts[1]!.sourceEventId)
  })

  test('never throws even when the observer itself throws', () => {
    const throwingObserver: AnalyticsObserver = {
      observe: () => {
        throw new Error('observer exploded')
      },
      flush: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    }
    const observe = createProviderRequestObserver(throwingObserver)
    expect(() => observe(makeRequestContext(), makeObservation())).not.toThrow()
  })
})
