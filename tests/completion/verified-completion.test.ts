// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool, type ModelMessage, type ToolSet } from 'ai'
import { z } from 'zod'

import {
  buildVerifiedCompletion,
  detectToolFailure,
  selectReadOnlyTools,
} from '../../src/completion/verified-completion.js'
import type { VerifierDeps, VerifierPrompt } from '../../src/completion/verified-completion.js'
import type { ToolFailureResult } from '../../src/tool-failure.js'
import { mockLogger } from '../utils/test-helpers.js'

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

describe('buildVerifiedCompletion', () => {
  const okDeps = (text: string | undefined, capture?: (p: VerifierPrompt) => void): VerifierDeps => ({
    readOnlyToolset: undefined,
    invokeVerifier: (prompt: VerifierPrompt): Promise<{ text: string | undefined }> => {
      capture?.(prompt)
      return Promise.resolve({ text })
    },
  })

  test('confirmed: passes through the verifier text', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: false },
      okDeps('Created task TK-42.'),
    )
    expect(result).toEqual({ text: 'Created task TK-42.', verdict: 'confirmed' })
  })

  test('truncated: verdict is truncated and the prompt tells the model to invite "continue"', async () => {
    mockLogger()
    let seen: VerifierPrompt | undefined
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'tool-calls', hadToolFailure: false },
      okDeps('Reached the step limit; say continue to resume.', (p) => {
        seen = p
      }),
    )
    expect(result.verdict).toBe('truncated')
    expect(seen?.system).toContain('continue')
  })

  test('partial: a tool failure yields the partial verdict', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: true },
      okDeps('The update failed.'),
    )
    expect(result.verdict).toBe('partial')
  })

  test('unconfirmed: neutral message when the verifier throws', async () => {
    mockLogger()
    const deps: VerifierDeps = {
      readOnlyToolset: undefined,
      invokeVerifier: (): Promise<{ text: string | undefined }> => {
        throw new Error('network')
      },
    }
    const result = await buildVerifiedCompletion({ history: [], finishReason: 'stop', hadToolFailure: false }, deps)
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toContain('could not confirm')
  })

  test('unconfirmed: neutral message when the verifier returns empty text', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: false },
      okDeps(''),
    )
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toContain('could not confirm')
  })
})
