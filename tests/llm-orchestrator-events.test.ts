// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { emitLlmStart, emitLlmEnd, type ResolvedStreamTextResult } from '../src/llm-orchestrator-events.js'
import { makeTools } from '../src/tools/index.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function makeEventCapture(eventType: string): {
  capture: () => unknown
  captureScope: () => unknown
  listener: (event: { type: string; data: unknown; __scope: unknown }) => void
} {
  let capturedData: unknown = null
  let capturedScope: unknown = null
  return {
    capture: () => capturedData,
    captureScope: () => capturedScope,
    listener: (event: { type: string; data: unknown; __scope: unknown }): void => {
      if (event.type === eventType) {
        capturedData = event.data
        capturedScope = event.__scope
      }
    },
  }
}

describe('llm-orchestrator-events', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('emitLlmStart', () => {
    test('emits llm:start event with correct payload', async () => {
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      const { capture, captureScope, listener } = makeEventCapture('llm:start')
      subscribe(listener)

      try {
        const provider = createMockProvider()
        const tools = makeTools(provider, { storageContextId: 'ctx-1', chatUserId: 'user-1' })
        emitLlmStart('ctx-1', 'gpt-4', [{ role: 'user', content: 'hi' }], tools)

        const capturedEvent = capture()
        const capturedScope = captureScope()
        assert.ok(isRecord(capturedEvent))
        assert.ok(isRecord(capturedScope))
        expect(capturedScope['kind']).toBe('user')
        expect(capturedScope['userId']).toBe('ctx-1')
        expect(capturedEvent['model']).toBe('gpt-4')
        expect(capturedEvent['messageCount']).toBe(1)
        expect(capturedEvent['toolCount']).toBe(Object.keys(tools).length)
        expect(capturedEvent['exposedToolCount']).toBe(Object.keys(tools).length)
        expect(capturedEvent['fullToolCount']).toBe(Object.keys(tools).length)
        expect(typeof capturedEvent['toolSchemaBytes']).toBe('number')
      } finally {
        unsubscribe(listener)
      }
    })
  })

  describe('emitLlmEnd', () => {
    test('emits llm:end event with steps detail', async () => {
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      const { capture, captureScope, listener } = makeEventCapture('llm:end')
      subscribe(listener)

      try {
        const result: ResolvedStreamTextResult = {
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [
            {
              text: 'Step 1',
              finishReason: 'stop',
              toolCalls: [],
              toolResults: [],
              usage: { inputTokens: 10, outputTokens: 5 },
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }], id: 'resp-1', modelId: 'gpt-4' },
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: 'stop',
        }
        const provider = createMockProvider()
        const tools = makeTools(provider, { storageContextId: 'ctx-1', chatUserId: 'user-1' })
        const startTime = Date.now() - 1000

        emitLlmEnd('ctx-1', 'gpt-4', result, startTime, [{ role: 'user', content: 'hi' }], tools)

        const capturedEvent = capture()
        const capturedScope = captureScope()
        assert.ok(isRecord(capturedEvent))
        assert.ok(isRecord(capturedScope))
        expect(capturedScope['kind']).toBe('user')
        expect(capturedScope['userId']).toBe('ctx-1')
        expect(capturedEvent['model']).toBe('gpt-4')
        expect(capturedEvent['steps']).toBe(1)
        expect(capturedEvent['finishReason']).toBe('stop')
        expect(capturedEvent['messageCount']).toBe(1)
        expect(capturedEvent['toolCount']).toBe(Object.keys(tools).length)
        expect(capturedEvent['exposedToolCount']).toBe(Object.keys(tools).length)
        expect(capturedEvent['fullToolCount']).toBe(Object.keys(tools).length)
        expect(typeof capturedEvent['toolSchemaBytes']).toBe('number')
        expect(capturedEvent['generatedText']).toBe('Done!')
        expect(Array.isArray(capturedEvent['stepsDetail'])).toBe(true)
        expect(typeof capturedEvent['totalDuration']).toBe('number')
      } finally {
        unsubscribe(listener)
      }
    })
  })

  describe('ResolvedStreamTextResult type', () => {
    test('type exists and can be used', () => {
      const result: ResolvedStreamTextResult = {
        text: 'Test',
        toolCalls: [{ toolName: 'test', toolCallId: '1', input: {} }],
        toolResults: [{ toolCallId: '1', output: {} }],
        steps: [],
        response: { messages: [] },
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: 'stop',
      }

      expect(result.text).toBe('Test')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolResults).toHaveLength(1)
      expect(result.finishReason).toBe('stop')
    })

    test('optional fields can be undefined', () => {
      const result: ResolvedStreamTextResult = {
        text: 'Test',
        toolCalls: [],
        toolResults: [],
        steps: [],
        response: { messages: [] },
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: 'stop',
        warnings: undefined,
        request: undefined,
        providerMetadata: undefined,
      }

      expect(result.warnings).toBeUndefined()
      expect(result.request).toBeUndefined()
      expect(result.providerMetadata).toBeUndefined()
    })
  })
})
