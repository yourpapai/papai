// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool, type ModelMessage, type ToolSet } from 'ai'
import { z } from 'zod'

import { detectToolFailure, selectReadOnlyTools } from '../../src/completion/verified-completion.js'
import type { ToolFailureResult } from '../../src/tool-failure.js'

const stub = (): ToolSet[string] =>
  tool({ description: '', inputSchema: z.object({}), execute: () => Promise.resolve(null) })

const fakeTools = (...names: string[]): ToolSet => {
  const tools: ToolSet = {}
  for (const name of names) {
    tools[name] = stub()
  }
  return tools
}

const failure: ToolFailureResult = {
  success: false,
  error: 'boom',
  toolName: 'update_task',
  toolCallId: 'c1',
  timestamp: '2026-07-01T00:00:00.000Z',
  errorType: 'tool-execution',
  errorCode: 'unknown',
  userMessage: 'That action failed.',
  agentMessage: 'It failed.',
  retryable: false,
}

describe('selectReadOnlyTools', () => {
  test('keeps get_/list_/search_ tools and drops mutating tools', () => {
    const result = selectReadOnlyTools(
      fakeTools('get_task', 'list_tasks', 'search_tools', 'create_task', 'update_task'),
    )
    expect(result).not.toBeUndefined()
    expect(Object.keys(result!).sort()).toEqual(['get_task', 'list_tasks', 'search_tools'])
  })

  test('returns undefined when no read-only tools are present', () => {
    expect(selectReadOnlyTools(fakeTools('create_task', 'delete_project'))).toBeUndefined()
  })
})

describe('detectToolFailure', () => {
  test('detects a ToolFailureResult nested in a tool message', () => {
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 'update_task', output: { type: 'json', value: failure } },
        ],
      },
    ]
    expect(detectToolFailure(messages)).toBe(true)
  })

  test('returns false when no tool result is a failure', () => {
    const messages: ModelMessage[] = [
      { role: 'assistant', content: 'hi' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'get_task',
            output: { type: 'json', value: { id: 'TK-1' } },
          },
        ],
      },
    ]
    expect(detectToolFailure(messages)).toBe(false)
  })
})
