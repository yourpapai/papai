// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { LLM_TRACE_CAPACITY, type LlmTrace } from '../../src/debug/llm-trace-collector.js'
import { makeReadLlmTracesTool, type ReadLlmTracesDeps } from '../../src/tools/diagnostics-llm-traces.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'

const ADMIN = 'admin-1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const trace = (overrides: Partial<LlmTrace> = {}): LlmTrace => ({
  timestamp: Date.UTC(2026, 7, 23, 0, 0, 0),
  userId: 'internal-1',
  chatUserId: undefined,
  model: 'gpt-main',
  steps: 2,
  totalTokens: { inputTokens: 100, outputTokens: 50 },
  duration: 1500,
  toolCalls: [
    {
      toolName: 'list_tasks',
      durationMs: 200,
      success: true,
      toolCallId: 'call-1',
      args: { projectId: 'p-1' },
      result: { tasks: [] },
      error: undefined,
    },
  ],
  error: undefined,
  responseId: 'resp-1',
  actualModel: 'gpt-main-2026-08',
  finishReason: 'stop',
  messageCount: 4,
  toolCount: 3,
  exposedToolCount: 3,
  fullToolCount: 3,
  toolSchemaBytes: 2048,
  routingIntent: 'task_lookup',
  routingConfidence: 0.9,
  routingReason: 'lexical',
  generatedText: 'Here are your tasks.',
  stepsDetail: [
    {
      stepNumber: 1,
      text: 'thinking about tasks',
      finishReason: 'tool-calls',
      toolCalls: [{ toolName: 'list_tasks', toolCallId: 'call-1', args: { projectId: 'p-1' }, result: { tasks: [] } }],
      usage: { inputTokens: 60, outputTokens: 20 },
    },
  ],
  ...overrides,
})

const makeDeps = (traces: LlmTrace[]): ReadLlmTracesDeps => ({ traces: () => traces })

const run = (
  chatUserId: string | undefined,
  deps: ReadLlmTracesDeps,
  input: Record<string, unknown> = {},
): Promise<unknown> => getToolExecutor(makeReadLlmTracesTool(chatUserId, deps))(input)

const listed = (result: unknown): Array<Record<string, unknown>> => {
  assert(isRecord(result), 'result must be an object')
  const traces = result['traces']
  assert(Array.isArray(traces), 'traces must be an array')
  return traces.map((t) => {
    assert(isRecord(t), 'trace must be an object')
    return t
  })
}

const firstTrace = (result: unknown): Record<string, unknown> => {
  const first = listed(result)[0]
  assert(first !== undefined, 'expected at least one trace')
  return first
}

const timestamps = (result: unknown): unknown[] => listed(result).map((t) => t['timestamp'])

describe('read_llm_traces', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('attribution shaping', () => {
    test('returns own traces verbatim on a chatUserId match', async () => {
      const own = trace({ chatUserId: ADMIN })

      const result = await run(ADMIN, makeDeps([own]))

      expect(listed(result)).toEqual([own])
    })

    test('strips foreign traces of content and identity, keeping operational counters', async () => {
      const foreign = trace({ chatUserId: 'user-2', error: 'provider 429' })

      const shaped = firstTrace(await run(ADMIN, makeDeps([foreign])))

      expect(shaped['generatedText']).toBeUndefined()
      expect(shaped['stepsDetail']).toBeUndefined()
      expect(shaped['userId']).toBeUndefined()
      expect(shaped['chatUserId']).toBeUndefined()
      expect(shaped['toolCalls']).toEqual([
        {
          toolName: 'list_tasks',
          durationMs: 200,
          success: true,
          toolCallId: 'call-1',
          args: undefined,
          result: undefined,
          error: undefined,
        },
      ])
      expect(shaped['model']).toBe('gpt-main')
      expect(shaped['actualModel']).toBe('gpt-main-2026-08')
      expect(shaped['duration']).toBe(1500)
      expect(shaped['steps']).toBe(2)
      expect(shaped['totalTokens']).toEqual({ inputTokens: 100, outputTokens: 50 })
      expect(shaped['error']).toBe('provider 429')
      expect(JSON.stringify(shaped)).not.toContain('Here are your tasks.')
      expect(JSON.stringify(shaped)).not.toContain('projectId')
      expect(JSON.stringify(shaped)).not.toContain('user-2')
    })

    test('strips unattributed traces exactly like foreign ones', async () => {
      const unattributed = trace({ chatUserId: undefined })

      const shaped = firstTrace(await run(ADMIN, makeDeps([unattributed])))

      expect(shaped['generatedText']).toBeUndefined()
      expect(shaped['stepsDetail']).toBeUndefined()
      expect(shaped['userId']).toBeUndefined()
      expect(shaped['chatUserId']).toBeUndefined()
      const toolCalls = shaped['toolCalls']
      assert(Array.isArray(toolCalls), 'expected tool calls array')
      const firstCall: unknown = toolCalls[0]
      assert(isRecord(firstCall), 'expected a tool call')
      expect(firstCall['args']).toBeUndefined()
      expect(shaped['model']).toBe('gpt-main')
    })

    test('a missing chatUserId principal shapes everything (fail closed)', async () => {
      const ownLooking = trace({ chatUserId: ADMIN })

      const shaped = firstTrace(await run(undefined, makeDeps([ownLooking])))

      expect(shaped['generatedText']).toBeUndefined()
      expect(shaped['stepsDetail']).toBeUndefined()
      expect(shaped['chatUserId']).toBeUndefined()
    })
  })

  describe('filters', () => {
    test('errors_only keeps only traces that carry an error', async () => {
      const buffer = [
        trace({ chatUserId: ADMIN, timestamp: 1 }),
        trace({ chatUserId: ADMIN, timestamp: 2, error: 'provider 500', responseId: undefined }),
      ]

      const result = await run(ADMIN, makeDeps(buffer), { errors_only: true })

      expect(listed(result)).toHaveLength(1)
      expect(firstTrace(result)['error']).toBe('provider 500')
    })

    test('model keeps only traces for that model id', async () => {
      const buffer = [
        trace({ chatUserId: ADMIN, model: 'gpt-main', timestamp: 1 }),
        trace({ chatUserId: ADMIN, model: 'gpt-small', timestamp: 2 }),
      ]

      const result = await run(ADMIN, makeDeps(buffer), { model: 'gpt-small' })

      expect(listed(result)).toHaveLength(1)
      expect(firstTrace(result)['model']).toBe('gpt-small')
    })
  })

  describe('limits', () => {
    test('defaults to the 25 most recent traces from the tail', async () => {
      const buffer = Array.from({ length: 30 }, (_, i) => trace({ chatUserId: ADMIN, timestamp: i }))

      const result = await run(ADMIN, makeDeps(buffer))

      const stamps = timestamps(result)
      expect(stamps).toHaveLength(25)
      expect(stamps[0]).toBe(5)
      expect(stamps[24]).toBe(29)
    })

    test('caps an oversized limit at 100 without error', async () => {
      const buffer = Array.from({ length: 120 }, (_, i) => trace({ chatUserId: ADMIN, timestamp: i }))

      const result = await run(ADMIN, makeDeps(buffer), { limit: 999 })

      const stamps = timestamps(result)
      expect(stamps).toHaveLength(100)
      expect(stamps[0]).toBe(20)
      expect(stamps[99]).toBe(119)
    })
  })

  describe('shaping cost', () => {
    test('shapes only the returned tail, not every buffered trace', async () => {
      let toolCallsReads = 0
      const countingTrace = (timestamp: number): LlmTrace => {
        const base = trace({ chatUserId: 'user-2', timestamp })
        const calls = base.toolCalls
        return {
          ...base,
          get toolCalls() {
            toolCallsReads++
            return calls
          },
        }
      }
      const buffer = Array.from({ length: 60 }, (_, i) => countingTrace(i))

      const result = await run(ADMIN, makeDeps(buffer), { limit: 10 })

      expect(listed(result)).toHaveLength(10)
      expect(toolCallsReads).toBeLessThanOrEqual(30)
    })
  })

  describe('volatility stats', () => {
    test('derives count/capacity/oldest/newest from the trace buffer', async () => {
      const buffer = [trace({ timestamp: 100 }), trace({ timestamp: 300 })]

      const result = await run(ADMIN, makeDeps(buffer))

      assert(isRecord(result))
      expect(result['stats']).toEqual({
        count: 2,
        capacity: LLM_TRACE_CAPACITY,
        oldest: 100,
        newest: 300,
      })
    })

    test('an empty buffer returns an empty result with zero-count stats, not an error', async () => {
      const result = await run(ADMIN, makeDeps([]))

      assert(isRecord(result))
      expect(result['traces']).toEqual([])
      expect(result['stats']).toEqual({ count: 0, capacity: LLM_TRACE_CAPACITY, oldest: null, newest: null })
    })
  })

  describe('probe degradation', () => {
    test('a throwing traces probe degrades to probe_error without throwing', async () => {
      const deps: ReadLlmTracesDeps = {
        traces: () => {
          throw new Error('traces probe boom')
        },
      }

      const result = await run(ADMIN, deps)

      assert(isRecord(result))
      expect(result['traces']).toBe('probe_error')
      expect(JSON.stringify(result)).not.toContain('boom')
    })
  })

  describe('immutability', () => {
    test('leaves the trace buffer byte-identical after a filtered invocation', async () => {
      const buffer = [
        trace({ chatUserId: ADMIN, generatedText: 'own reply' }),
        trace({ chatUserId: 'user-2', generatedText: 'foreign reply' }),
      ]
      const before = JSON.stringify(buffer)

      await run(ADMIN, makeDeps(buffer), { errors_only: false, limit: 2 })

      expect(JSON.stringify(buffer)).toBe(before)
    })
  })

  describe('input schema', () => {
    test('accepts the supported filter and limit inputs', () => {
      const tool = makeReadLlmTracesTool(ADMIN, makeDeps([]))

      expect(schemaValidates(tool, {})).toBe(true)
      expect(schemaValidates(tool, { errors_only: true })).toBe(true)
      expect(schemaValidates(tool, { model: 'gpt-main' })).toBe(true)
      expect(schemaValidates(tool, { limit: 1 })).toBe(true)
      expect(schemaValidates(tool, { limit: 500 })).toBe(true)
    })

    test('rejects malformed inputs', () => {
      const tool = makeReadLlmTracesTool(ADMIN, makeDeps([]))

      expect(schemaValidates(tool, { errors_only: 'yes' })).toBe(false)
      expect(schemaValidates(tool, { model: 42 })).toBe(false)
      expect(schemaValidates(tool, { limit: 0 })).toBe(false)
      expect(schemaValidates(tool, { limit: -1 })).toBe(false)
      expect(schemaValidates(tool, { limit: 2.5 })).toBe(false)
    })
  })
})
