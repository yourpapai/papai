// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
import { initAnalyticsRuntime, stopAnalyticsRuntime } from '../../src/analytics/subscriber.js'
import { createTurnContextRegistry } from '../../src/analytics/turn-context.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import type { DebugEvent } from '../../src/debug/event-bus.js'

const T0 = 1_700_000_000_000

const memberSource: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-42',
  nativeContextId: 'user-42',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

type Listener = (event: DebugEvent) => void

type FakeBus = Readonly<{
  emit: (event: DebugEvent) => void
  listeners: () => number
  failNextSubscribe: () => void
  subscribe: (fn: Listener) => void
  unsubscribe: (fn: Listener) => void
}>

const createFakeBus = (): FakeBus => {
  const listeners = new Set<Listener>()
  let failNext = false
  return {
    emit: (event) => {
      listeners.forEach((listener) => {
        listener(event)
      })
    },
    listeners: () => listeners.size,
    failNextSubscribe: () => {
      failNext = true
    },
    subscribe: (fn) => {
      if (failNext) {
        failNext = false
        throw new Error('bus unavailable')
      }
      listeners.add(fn)
    },
    unsubscribe: (fn) => {
      listeners.delete(fn)
    },
  }
}

const createRecordingObserver = (): AnalyticsObserver & { facts: AnalyticsSourceFact[] } => {
  const facts: AnalyticsSourceFact[] = []
  return {
    facts,
    observe: (fact) => {
      facts.push(fact)
    },
    flush: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  }
}

const busEvent = (type: string, data: Record<string, unknown>, turnId?: string): DebugEvent => ({
  type,
  timestamp: T0,
  data,
  scope: { kind: 'user', userId: 'debug-scope-user-42' },
  ...(turnId === undefined ? {} : { turnId }),
})

const setup = (): {
  bus: FakeBus
  observer: ReturnType<typeof createRecordingObserver>
  registry: ReturnType<typeof createTurnContextRegistry>
} => {
  const bus = createFakeBus()
  const observer = createRecordingObserver()
  const registry = createTurnContextRegistry({ nowMs: () => T0 })
  initAnalyticsRuntime({
    observer,
    registry,
    subscribe: bus.subscribe,
    unsubscribe: bus.unsubscribe,
  })
  return { bus, observer, registry }
}

const firstFactOfType = <T extends AnalyticsSourceFact['type']>(
  facts: readonly AnalyticsSourceFact[],
  type: T,
): Extract<AnalyticsSourceFact, { type: T }> => {
  const matches = facts.filter((fact): fact is Extract<AnalyticsSourceFact, { type: T }> => fact.type === type)
  const first = matches[0]
  if (first === undefined) throw new Error(`expected fact of type ${type}`)
  return first
}

describe('analytics subscriber', () => {
  beforeEach(() => {
    stopAnalyticsRuntime()
  })

  test('init subscribes once and repeated init is a no-op', () => {
    const { bus, observer, registry } = setup()
    initAnalyticsRuntime({ observer, registry, subscribe: bus.subscribe, unsubscribe: bus.unsubscribe })
    expect(bus.listeners()).toBe(1)
  })

  test('stop unsubscribes and a later init resubscribes', () => {
    const { bus, observer, registry } = setup()
    stopAnalyticsRuntime()
    expect(bus.listeners()).toBe(0)
    initAnalyticsRuntime({ observer, registry, subscribe: bus.subscribe, unsubscribe: bus.unsubscribe })
    expect(bus.listeners()).toBe(1)
  })

  test('a subscribe failure rolls back and a later init succeeds', () => {
    const bus = createFakeBus()
    bus.failNextSubscribe()
    const observer = createRecordingObserver()
    const registry = createTurnContextRegistry({ nowMs: () => T0 })
    expect(() => {
      initAnalyticsRuntime({
        observer,
        registry,
        subscribe: bus.subscribe,
        unsubscribe: bus.unsubscribe,
      })
    }).toThrow()
    expect(bus.listeners()).toBe(0)
    initAnalyticsRuntime({ observer, registry, subscribe: bus.subscribe, unsubscribe: bus.unsubscribe })
    expect(bus.listeners()).toBe(1)
  })

  test('maps an approved llm:start event to an llm_started fact with registry identity', () => {
    const { bus, observer, registry } = setup()
    registry.register({ turnId: 'turn-1', source: memberSource })
    bus.emit(busEvent('llm:start', { model: 'gpt-x', messageCount: 5, toolCount: 10 }, 'turn-1'))
    expect(observer.facts).toHaveLength(1)
    const fact = firstFactOfType(observer.facts, 'llm_started')
    expect(fact.source).toEqual(memberSource)
    expect(fact.occurredAtMs).toBe(T0)
    expect(fact.modelId).toBe('gpt-x')
    expect(fact.messageCount).toBe(5)
    expect(fact.availableToolCount).toBe(10)
  })

  test('maps approved llm:end, llm:error, tool, and disclosure events', () => {
    const { bus, observer, registry } = setup()
    registry.register({ turnId: 'turn-1', source: memberSource })
    bus.emit(
      busEvent(
        'llm:end',
        {
          model: 'gpt-x',
          actualModel: 'gpt-x-1',
          steps: 2,
          totalDuration: 900,
          finishReason: 'stop',
          tokenUsage: null,
        },
        'turn-1',
      ),
    )
    bus.emit(busEvent('llm:error', { model: 'gpt-x', durationMs: 100 }, 'turn-1'))
    bus.emit(
      busEvent(
        'tool:request',
        { toolName: 'core_task_create', toolCallId: 'tc-1', argsBytes: 42, modelRole: 'main' },
        'turn-1',
      ),
    )
    bus.emit(
      busEvent(
        'tool:analytics_completed',
        {
          toolName: 'core_task_create',
          toolCallId: 'tc-1',
          argsBytes: 42,
          durationMs: 55,
          executionOutcome: 'semantic_success',
          resultBytes: 120,
          errorClass: null,
          statusClass: '2xx',
          retryable: null,
          recoveredSameTurn: false,
          modelRole: 'main',
        },
        'turn-1',
      ),
    )
    bus.emit(busEvent('disclosure:fallback', { stepNumber: 3, reason: 'no_real_load' }, 'turn-1'))
    expect(observer.facts.map((fact) => fact.type)).toEqual([
      'llm_completed',
      'llm_failed',
      'tool_started',
      'tool_completed',
      'disclosure_fallback',
    ])
  })

  test('ignores the five categorically excluded sources', () => {
    const { bus, observer, registry } = setup()
    registry.register({ turnId: 'turn-1', source: memberSource })
    const excluded = ['llm:tool_result', 'log:entry', 'message:received', 'turn:summary', 'llm:full']
    excluded.forEach((type) => {
      bus.emit(busEvent(type, { model: 'gpt-x' }, 'turn-1'))
    })
    expect(observer.facts).toHaveLength(0)
  })

  test('drops an approved event without an authoritative turn context and never uses debug scope', () => {
    const { bus, observer } = setup()
    bus.emit(busEvent('llm:start', { model: 'gpt-x', messageCount: 5, toolCount: 10 }, 'turn-unknown'))
    bus.emit(busEvent('llm:start', { model: 'gpt-x', messageCount: 5, toolCount: 10 }))
    expect(observer.facts).toHaveLength(0)
  })

  test('a late child event inside the terminal grace still resolves; after grace it drops', () => {
    const now = { value: T0 }
    const bus = createFakeBus()
    const observer = createRecordingObserver()
    const registry = createTurnContextRegistry({ nowMs: () => now.value })
    initAnalyticsRuntime({ observer, registry, subscribe: bus.subscribe, unsubscribe: bus.unsubscribe })
    registry.register({ turnId: 'turn-1', source: memberSource })
    registry.complete('turn-1')
    now.value = T0 + 60 * 1000
    bus.emit(busEvent('disclosure:fallback', { stepNumber: 1, reason: 'no_real_load' }, 'turn-1'))
    expect(observer.facts).toHaveLength(1)
    now.value = T0 + 3 * 60 * 1000
    bus.emit(busEvent('disclosure:fallback', { stepNumber: 2, reason: 'no_real_load' }, 'turn-1'))
    expect(observer.facts).toHaveLength(1)
  })

  test('the subscriber never throws into the bus even when the observer throws', () => {
    const bus = createFakeBus()
    const registry = createTurnContextRegistry({ nowMs: () => T0 })
    const throwingObserver: AnalyticsObserver = {
      observe: () => {
        throw new Error('observer exploded for user-42')
      },
      flush: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    }
    initAnalyticsRuntime({
      observer: throwingObserver,
      registry,
      subscribe: bus.subscribe,
      unsubscribe: bus.unsubscribe,
    })
    registry.register({ turnId: 'turn-1', source: memberSource })
    expect(() => {
      bus.emit(busEvent('llm:start', { model: 'gpt-x', messageCount: 5, toolCount: 10 }, 'turn-1'))
    }).not.toThrow()
  })
})
