// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { tool } from 'ai'
import { z } from 'zod'

import { alertConditionSchema } from '../src/deferred-prompts/types.js'
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
  listener: (event: { type: string; data: unknown; scope: unknown }) => void
} {
  let capturedData: unknown = null
  let capturedScope: unknown = null
  return {
    capture: () => capturedData,
    captureScope: () => capturedScope,
    listener: (event: { type: string; data: unknown; scope: unknown }): void => {
      if (event.type === eventType) {
        capturedData = event.data
        capturedScope = event.scope
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
        const tools = await makeTools(provider, { storageContextId: 'ctx-1', chatUserId: 'user-1' })
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
        expect(capturedEvent['exposedToolCount']).toBeUndefined()
        expect(capturedEvent['fullToolCount']).toBeUndefined()
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
          response: {
            messages: [{ role: 'assistant' as const, content: 'Done!' }],
            id: 'resp-1',
            modelId: 'gpt-4',
          },
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: 'stop',
        }
        const provider = createMockProvider()
        const tools = await makeTools(provider, { storageContextId: 'ctx-1', chatUserId: 'user-1' })
        const startTime = Date.now() - 1000

        emitLlmEnd(
          'ctx-1',
          'user-1',
          'dm',
          'gpt-4',
          result,
          startTime,
          [{ role: 'user', content: 'hi' }],
          tools,
          'turn-1',
        )

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
        expect(capturedEvent['exposedToolCount']).toBeUndefined()
        expect(capturedEvent['fullToolCount']).toBeUndefined()
        expect(typeof capturedEvent['toolSchemaBytes']).toBe('number')
        expect(capturedEvent['generatedText']).toBe('Done!')
        expect(Array.isArray(capturedEvent['stepsDetail'])).toBe(true)
        expect(typeof capturedEvent['totalDuration']).toBe('number')
        expect(capturedEvent['chatUserId']).toBe('user-1')
        expect(capturedEvent['contextType']).toBe('dm')
      } finally {
        unsubscribe(listener)
      }
    })

    test('emits llm:end event with chatUserId and contextType for groups', async () => {
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      const { capture, listener } = makeEventCapture('llm:end')
      subscribe(listener)

      try {
        const result: ResolvedStreamTextResult = {
          text: 'Hi',
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [], id: 'resp-2', modelId: 'gpt-4' },
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: 'stop',
        }
        const provider = createMockProvider()
        const tools = await makeTools(provider, { storageContextId: 'ctx-grp', chatUserId: 'user-2' })
        emitLlmEnd(
          'ctx-grp',
          'user-2',
          'group',
          'gpt-4',
          result,
          Date.now() - 10,
          [{ role: 'user', content: 'hi' }],
          tools,
          'turn-2',
        )

        const captured = capture()
        assert.ok(isRecord(captured))
        expect(captured['chatUserId']).toBe('user-2')
        expect(captured['contextType']).toBe('group')
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

  describe('schema serialization with recursive zod schemas', () => {
    test('emitLlmStart: toolSchemaBytes includes schema bytes after toJSONSchema materializes cycles', async () => {
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      const { capture, listener } = makeEventCapture('llm:start')
      subscribe(listener)

      try {
        // z.lazy + toJSONSchema creates internal _cachedInner references that form object cycles.
        // With an empty description the total should come from the schema string alone.
        const cyclicAlertSchema = alertConditionSchema
        cyclicAlertSchema.toJSONSchema()

        const cyclicTool = tool({
          description: '',
          inputSchema: z.object({ condition: cyclicAlertSchema.optional() }),
          execute: (input) => input,
        })

        emitLlmStart('ctx-1', 'gpt-4', [{ role: 'user', content: 'hi' }], { x: cyclicTool })

        const capturedEvent = capture()
        assert.ok(isRecord(capturedEvent))
        // If the cycle guard is missing, stringify returns '' and toolSchemaBytes would be 0.
        expect(capturedEvent['toolSchemaBytes']).toBeGreaterThan(50)
      } finally {
        unsubscribe(listener)
      }
    })

    test('emitLlmEnd: toolSchemaBytes includes schema bytes after toJSONSchema materializes cycles', async () => {
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      const { capture, listener } = makeEventCapture('llm:end')
      subscribe(listener)

      try {
        const cyclicAlertSchema = alertConditionSchema
        cyclicAlertSchema.toJSONSchema()

        const cyclicTool = tool({
          description: '',
          inputSchema: z.object({ condition: cyclicAlertSchema.optional() }),
          execute: (input) => input,
        })

        const result: ResolvedStreamTextResult = {
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [], id: 'resp-1', modelId: 'gpt-4' },
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'stop',
        }

        emitLlmEnd(
          'ctx-1',
          'user-1',
          'dm',
          'gpt-4',
          result,
          Date.now() - 1000,
          [{ role: 'user', content: 'hi' }],
          { x: cyclicTool },
          'turn-cyclic',
        )

        const capturedEvent = capture()
        assert.ok(isRecord(capturedEvent))
        expect(capturedEvent['toolSchemaBytes']).toBeGreaterThan(50)
      } finally {
        unsubscribe(listener)
      }
    })
  })
})
