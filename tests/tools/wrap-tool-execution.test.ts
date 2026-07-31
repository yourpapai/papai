// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import type { AnalyticsRequestContext } from '../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  requireProviderRequestScope,
  type ActorProviderRequestScope,
} from '../../src/analytics/provider-request-scope.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import { isToolFailureResult } from '../../src/tool-failure.js'
import {
  buildToolsContextRecord,
  finalizeProviderScopedTools,
  wrapToolExecution,
} from '../../src/tools/wrap-tool-execution.js'

// Interface matching the error result structure
interface ToolErrorResult {
  success: false
  error: string
  toolName: string
  toolCallId: string
  timestamp: string
}

// Type guard for validating ToolErrorResult in tests
function isToolErrorResult(value: unknown): value is ToolErrorResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === false &&
    'error' in value &&
    typeof value.error === 'string' &&
    'toolName' in value &&
    typeof value.toolName === 'string' &&
    'toolCallId' in value &&
    typeof value.toolCallId === 'string' &&
    'timestamp' in value &&
    typeof value.timestamp === 'string'
  )
}

const makeSource = (): AnalyticsSourceContext => ({
  platform: 'mattermost',
  platformInstanceId: 'pi-9',
  chatUserId: 'user-9',
  nativeContextId: 'chat-9',
  storageContextId: 'pi-9:chat-9',
  configContextId: 'pi-9:chat-9',
  contextType: 'group',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-9',
})

const makeActorScope = (): ActorProviderRequestScope =>
  createActorProviderRequestScope({
    requestContext: { source: makeSource(), sourceEventId: 'turn-9:scope' } satisfies AnalyticsRequestContext,
    observeProviderRequest: () => {},
  })

const execOptions = (context: unknown): { toolCallId: string; messages: never[]; context: unknown } => ({
  toolCallId: 'call-1',
  messages: [],
  context,
})

describe('isToolErrorResult', () => {
  test('returns true for valid ToolErrorResult', () => {
    const result = {
      success: false as const,
      error: 'Something failed',
      toolName: 'test_tool',
      toolCallId: 'call-1',
      timestamp: '2024-01-01T00:00:00.000Z',
    }
    expect(isToolErrorResult(result)).toBe(true)
  })

  test('returns false for non-error result', () => {
    const result = { success: true, data: 'ok' }
    expect(isToolErrorResult(result)).toBe(false)
  })

  test('returns false for null', () => {
    expect(isToolErrorResult(null)).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(isToolErrorResult(undefined)).toBe(false)
  })

  test('returns false for missing required fields', () => {
    expect(isToolErrorResult({ success: false })).toBe(false)
    expect(isToolErrorResult({ success: false, error: 'fail' })).toBe(false)
    expect(isToolErrorResult({ success: false, error: 'fail', toolName: 'test' })).toBe(false)
  })
})

describe('wrapToolExecution', () => {
  test('returns result when execution succeeds inside a valid actor scope', async () => {
    const scope = makeActorScope()
    const execute = (): Promise<{ success: boolean; data: string }> =>
      Promise.resolve({ success: true, data: 'result' })
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, execOptions(scope))

    expect(result).toEqual({ success: true, data: 'result' })
  })

  test('exposes the call scope to the running execution via requireProviderRequestScope', async () => {
    const scope = makeActorScope()
    const seen: unknown[] = []
    const execute = (): Promise<unknown> => {
      seen.push(requireProviderRequestScope())
      return Promise.resolve('ok')
    }
    const wrapped = wrapToolExecution(execute, 'test_tool')

    await wrapped({}, execOptions(scope))

    expect(seen).toEqual([scope])
  })

  test('permits the explicit NO_ANALYTICS_SCOPE sentinel without observation', async () => {
    const seen: unknown[] = []
    const execute = (): Promise<unknown> => {
      seen.push(requireProviderRequestScope())
      return Promise.resolve('ok')
    }
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, execOptions(NO_ANALYTICS_SCOPE))

    expect(result).toBe('ok')
    expect(seen).toEqual([NO_ANALYTICS_SCOPE])
  })

  test('maps an absent context to provider_scope_missing without calling the provider stub', async () => {
    let calls = 0
    const execute = (): Promise<unknown> => {
      calls += 1
      return Promise.resolve('ok')
    }
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, execOptions(undefined))

    expect(calls).toBe(0)
    assert.ok(isToolFailureResult(result))
    expect(result.errorCode).toBe('provider_scope_missing')
  })

  test('maps an invalid context to provider_scope_missing without calling the provider stub', async () => {
    let calls = 0
    const execute = (): Promise<unknown> => {
      calls += 1
      return Promise.resolve('ok')
    }
    const wrapped = wrapToolExecution(execute, 'test_tool')

    for (const bad of [{}, { kind: 'actor' }, null, 42, 'scope']) {
      const result = await wrapped({}, execOptions(bad))
      assert.ok(isToolFailureResult(result))
      expect(result.errorCode).toBe('provider_scope_missing')
    }
    expect(calls).toBe(0)
  })

  test('returns structured error when execution throws inside a valid scope', async () => {
    const scope = makeActorScope()
    const execute = (): Promise<never> => Promise.reject(new Error('Something went wrong'))
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, execOptions(scope))

    assert.ok(isToolErrorResult(result))
    expect(result.success).toBe(false)
    expect(result.error).toBe('Something went wrong')
    expect(result.toolName).toBe('test_tool')
    expect(result.toolCallId).toBe('call-1')
    expect(typeof result.timestamp).toBe('string')
  })
})

describe('finalizeProviderScopedTools', () => {
  const d = (value: unknown): ToolSet[string] =>
    tool({ description: 'x', inputSchema: z.object({}), execute: () => Promise.resolve(value) })

  test('attaches the strict scope contextSchema and wrapper to every executable descriptor', () => {
    const tools: ToolSet = { alpha: d('a'), beta: d('b') }
    const finalized = finalizeProviderScopedTools(tools)

    for (const name of ['alpha', 'beta']) {
      expect(finalized[name]).toBeDefined()
      expect(finalized[name]!.contextSchema).toBeDefined()
      expect(finalized[name]!.execute).toBeDefined()
      expect(finalized[name]!.execute).not.toBe(tools[name]!.execute)
    }
  })

  test('drops non-executable descriptors from the finalized set', () => {
    const executable = d('a')
    const nonExecutable: ToolSet[string] = { ...d('x'), execute: undefined }
    const finalized = finalizeProviderScopedTools({ executable, nonExecutable })

    expect(finalized['executable']).toBeDefined()
    expect(finalized['nonExecutable']).toBeUndefined()
  })

  test('finalized executions read the scope only from that call\u2019s ToolExecutionOptions.context', async () => {
    const scopeA = makeActorScope()
    const scopeB = createActorProviderRequestScope({
      requestContext: {
        source: { ...makeSource(), chatUserId: 'user-b', rawTurnId: 'turn-b' },
        sourceEventId: 'turn-b:scope',
      },
      observeProviderRequest: () => {},
    })
    const seen: unknown[] = []
    const base = tool({
      description: 'x',
      inputSchema: z.object({}),
      execute: () => {
        seen.push(requireProviderRequestScope())
        return Promise.resolve('done')
      },
    })
    const finalized = finalizeProviderScopedTools({ probe: base })
    const execute = finalized['probe']!.execute!

    await execute({}, execOptions(scopeB))
    await execute({}, execOptions(scopeA))

    expect(seen).toEqual([scopeB, scopeA])
  })

  test('finalized executions fail closed with provider_scope_missing when context is invalid', async () => {
    let calls = 0
    const base = tool({
      description: 'x',
      inputSchema: z.object({}),
      execute: () => {
        calls += 1
        return Promise.resolve('done')
      },
    })
    const finalized = finalizeProviderScopedTools({ probe: base })

    const result: unknown = await finalized['probe']!.execute!({}, execOptions({}))

    expect(calls).toBe(0)
    assert.ok(isToolFailureResult(result))
    expect(result.errorCode).toBe('provider_scope_missing')
  })
})

describe('buildToolsContextRecord', () => {
  test('keys the record by every name in the tool set, each referencing the same scope', () => {
    const scope = makeActorScope()
    const tools: ToolSet = {
      one: tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) }),
      two: tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) }),
    }

    const record = buildToolsContextRecord(tools, scope)

    expect(Object.keys(record).toSorted()).toEqual(['one', 'two'])
    expect(record['one']).toBe(scope)
    expect(record['two']).toBe(scope)
  })

  test('keys by the full set, not a disclosed subset', () => {
    const scope = makeActorScope()
    const tools: ToolSet = {
      active: tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) }),
      inactive: tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) }),
      search_tools: tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) }),
      load_tool: tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) }),
    }

    const record = buildToolsContextRecord(tools, scope)

    expect(Object.keys(record).toSorted()).toEqual(['active', 'inactive', 'load_tool', 'search_tools'])
  })
})
