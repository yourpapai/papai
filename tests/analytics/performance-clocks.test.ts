// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider'

import {
  createTtftClock,
  createFirstVisibleFeedbackTracker,
  wrapModelForTtft,
} from '../../src/analytics/performance-clocks.js'

type FakeClock = { now: () => number; advance: (ms: number) => void }

const makeFakeClock = (): FakeClock => {
  let current = 1_000_000
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

const streamOf = (parts: readonly LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> =>
  new ReadableStream<LanguageModelV4StreamPart>({
    start(controller): void {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })

const textDelta = (text: string): LanguageModelV4StreamPart => ({ type: 'text-delta', id: 't1', delta: text })

const toolCallPart = (): LanguageModelV4StreamPart => ({
  type: 'tool-call',
  toolCallId: 'tc1',
  toolName: 'get_task',
  input: '{"id":"t1"}',
})

const makeModel = (parts: readonly LanguageModelV4StreamPart[]): LanguageModelV4 => ({
  specificationVersion: 'v4',
  provider: 'test-provider',
  modelId: 'test-model',
  supportedUrls: {},
  doGenerate: (): ReturnType<LanguageModelV4['doGenerate']> =>
    Promise.resolve({
      content: [{ type: 'text' as const, text: 'full text' }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  doStream: (): ReturnType<LanguageModelV4['doStream']> => Promise.resolve({ stream: streamOf(parts) }),
})

const callOptions: Parameters<LanguageModelV4['doStream']>[0] = { prompt: [] }

const drain = async (stream: ReadableStream<LanguageModelV4StreamPart>): Promise<void> => {
  const reader = stream.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) return
  }
}

describe('TTFT clock', () => {
  test('records a monotonic TTFT on the first streamed text delta', async () => {
    const clock = makeFakeClock()
    const ttft = createTtftClock({ now: clock.now })
    ttft.start()
    clock.advance(120)
    const model = wrapModelForTtft(makeModel([textDelta('Hel'), textDelta('lo')]), ttft)
    const { stream } = await model.doStream(callOptions)
    clock.advance(80)
    await drain(stream)
    expect(ttft.read()).toBe(200)
  })

  test('returns null for a no-token tool-only call', async () => {
    const clock = makeFakeClock()
    const ttft = createTtftClock({ now: clock.now })
    ttft.start()
    clock.advance(50)
    const model = wrapModelForTtft(makeModel([toolCallPart()]), ttft)
    const { stream } = await model.doStream(callOptions)
    await drain(stream)
    expect(ttft.read()).toBeNull()
  })

  test('returns null for a non-streaming response', async () => {
    const clock = makeFakeClock()
    const ttft = createTtftClock({ now: clock.now })
    ttft.start()
    clock.advance(75)
    const model = wrapModelForTtft(makeModel([]), ttft)
    await model.doGenerate(callOptions)
    expect(ttft.read()).toBeNull()
  })

  test('rejects a negative elapsed clock', () => {
    let current = 5000
    const ttft = createTtftClock({ now: () => current })
    ttft.start()
    current = 4000
    ttft.recordTextDelta()
    expect(ttft.read()).toBeNull()
  })

  test('rejects an implausible elapsed clock', () => {
    let current = 5000
    const ttft = createTtftClock({ now: () => current, maxPlausibleMs: 10_000 })
    ttft.start()
    current = 5000 + 10_001
    ttft.recordTextDelta()
    expect(ttft.read()).toBeNull()
  })

  test('only the first text delta counts', () => {
    let current = 100
    const ttft = createTtftClock({ now: () => current })
    ttft.start()
    current = 150
    ttft.recordTextDelta()
    current = 900
    ttft.recordTextDelta()
    expect(ttft.read()).toBe(50)
  })
})

describe('first visible feedback', () => {
  const makeClock = (): { now: () => number; advance: (ms: number) => void } => {
    let current = 1000
    return {
      now: (): number => current,
      advance: (ms: number): void => {
        current += ms
      },
    }
  }

  test('the earliest successful kind wins with turn-relative latency', () => {
    const clock = makeClock()
    const tracker = createFirstVisibleFeedbackTracker({ now: clock.now, startedAtMs: 1000 })
    clock.advance(120)
    tracker.record('typing', 'success')
    clock.advance(80)
    tracker.record('live_status', 'success')
    expect(tracker.close()).toEqual({ kind: 'typing', outcome: 'success', latencyMs: 120 })
  })

  test('a failed attempt does not block a later success of another kind', () => {
    const clock = makeClock()
    const tracker = createFirstVisibleFeedbackTracker({ now: clock.now, startedAtMs: 1000 })
    clock.advance(50)
    tracker.record('typing', 'failed')
    clock.advance(200)
    tracker.record('live_status', 'success')
    expect(tracker.close()).toEqual({ kind: 'live_status', outcome: 'success', latencyMs: 250 })
  })

  test('steer acknowledgement is a valid winning kind', () => {
    const clock = makeClock()
    const tracker = createFirstVisibleFeedbackTracker({ now: clock.now, startedAtMs: 1000 })
    clock.advance(30)
    tracker.record('steer_ack', 'success')
    expect(tracker.close()).toEqual({ kind: 'steer_ack', outcome: 'success', latencyMs: 30 })
  })

  test('closing with only failed attempts reports failed with none kind and null latency', () => {
    const clock = makeClock()
    const tracker = createFirstVisibleFeedbackTracker({ now: clock.now, startedAtMs: 1000 })
    tracker.record('typing', 'failed')
    tracker.record('live_status', 'failed')
    expect(tracker.close()).toEqual({ kind: 'none', outcome: 'failed', latencyMs: null })
  })

  test('closing with no attempts while supported and enabled reports missing', () => {
    const tracker = createFirstVisibleFeedbackTracker({
      startedAtMs: 1000,
      capabilitySupported: true,
      settingEnabled: true,
    })
    expect(tracker.close()).toEqual({ kind: 'none', outcome: 'missing', latencyMs: null })
  })

  test('closing with no attempts while unsupported or disabled reports not_applicable', () => {
    const unsupported = createFirstVisibleFeedbackTracker({
      startedAtMs: 1000,
      capabilitySupported: false,
      settingEnabled: true,
    })
    expect(unsupported.close()).toEqual({ kind: 'none', outcome: 'not_applicable', latencyMs: null })
    const disabled = createFirstVisibleFeedbackTracker({
      startedAtMs: 1000,
      capabilitySupported: true,
      settingEnabled: false,
    })
    expect(disabled.close()).toEqual({ kind: 'none', outcome: 'not_applicable', latencyMs: null })
  })

  test('close is idempotent and records after close are ignored', () => {
    const clock = makeClock()
    const tracker = createFirstVisibleFeedbackTracker({ now: clock.now, startedAtMs: 1000 })
    clock.advance(40)
    tracker.record('typing', 'success')
    const first = tracker.close()
    tracker.record('live_status', 'success')
    expect(tracker.close()).toEqual(first)
  })

  test('a failure recorded after a success never downgrades the result', () => {
    const clock = makeClock()
    const tracker = createFirstVisibleFeedbackTracker({ now: clock.now, startedAtMs: 1000 })
    clock.advance(60)
    tracker.record('typing', 'success')
    clock.advance(10)
    tracker.record('live_status', 'failed')
    expect(tracker.close()).toEqual({ kind: 'typing', outcome: 'success', latencyMs: 60 })
  })
})
