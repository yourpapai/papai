// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ProviderScopeMissingError } from '../src/analytics/provider-request-scope.js'
import { ProviderClassifiedError, providerError } from '../src/providers/errors.js'
import {
  buildToolFailureResult,
  createInterruptedToolFailureResult,
  createProviderScopeMissingFailureResult,
  isToolFailureResult,
} from '../src/tool-failure.js'

describe('buildToolFailureResult', () => {
  test('preserves classified provider errors as structured tool failures', () => {
    const result = buildToolFailureResult(
      new ProviderClassifiedError('Task lookup failed', providerError.taskNotFound('TASK-7')),
      'get_task',
      'call-1',
    )

    expect(isToolFailureResult(result)).toBe(true)
    expect(result).toMatchObject({
      success: false,
      toolName: 'get_task',
      toolCallId: 'call-1',
      errorType: 'provider',
      errorCode: 'task-not-found',
      retryable: false,
      details: { taskId: 'TASK-7' },
    })
    expect(result.userMessage).toContain('TASK-7')
    expect(result.agentMessage).toContain('task')
  })

  test('wraps unknown errors with fallback tool execution metadata', () => {
    const result = buildToolFailureResult(new Error('boom'), 'search_tasks', 'call-2')

    expect(isToolFailureResult(result)).toBe(true)
    expect(result).toMatchObject({
      success: false,
      toolName: 'search_tasks',
      toolCallId: 'call-2',
      error: 'boom',
      errorType: 'tool-execution',
      errorCode: 'unknown',
      retryable: false,
    })
    expect(result.userMessage.toLowerCase()).toContain('failed')
    expect(result.agentMessage.toLowerCase()).toContain('debug')
  })
})

describe('provider_scope_missing mapping', () => {
  test('buildToolFailureResult maps ProviderScopeMissingError to the controlled failure', () => {
    const result = buildToolFailureResult(new ProviderScopeMissingError(), 'get_task', 'call-scope-1')

    expect(isToolFailureResult(result)).toBe(true)
    expect(result).toMatchObject({
      success: false,
      toolName: 'get_task',
      toolCallId: 'call-scope-1',
      errorType: 'tool-execution',
      errorCode: 'provider_scope_missing',
      retryable: false,
    })
    expect(result.error).not.toContain('user-1')
  })

  test('createProviderScopeMissingFailureResult produces the controlled failure directly', () => {
    const result = createProviderScopeMissingFailureResult('list_tasks', 'call-scope-2')

    expect(isToolFailureResult(result)).toBe(true)
    expect(result).toMatchObject({
      success: false,
      toolName: 'list_tasks',
      toolCallId: 'call-scope-2',
      errorType: 'tool-execution',
      errorCode: 'provider_scope_missing',
      retryable: false,
    })
    expect(result.userMessage.toLowerCase()).toContain('failed')
    expect(result.agentMessage).toContain('provider_scope_missing')
  })
})

describe('createInterruptedToolFailureResult', () => {
  test('marks recovered interrupted tool calls as retryable', () => {
    const result = createInterruptedToolFailureResult('create_task', 'call-3')

    expect(isToolFailureResult(result)).toBe(true)
    expect(result).toMatchObject({
      success: false,
      toolName: 'create_task',
      toolCallId: 'call-3',
      errorType: 'tool-execution',
      errorCode: 'interrupted',
      recovered: true,
      retryable: true,
    })
    expect(result.agentMessage.toLowerCase()).toContain('interrupted')
  })
})
