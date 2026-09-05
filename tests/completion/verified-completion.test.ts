// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool, type ModelMessage, type ToolResultPart, type ToolSet } from 'ai'
import { z } from 'zod'

import {
  buildVerifiedCompletion,
  deriveVerdict,
  detectToolFailure,
  selectReadOnlyTools,
  turnHasToolActivity,
} from '../../src/completion/verified-completion.js'
import type {
  CompletionTurn,
  CompletionVerdict,
  VerifierDeps,
  VerifierPrompt,
} from '../../src/completion/verified-completion.js'
import type { ToolFailureResult } from '../../src/tool-failure.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'
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

const toolResultMessage = (toolName: string, output: ToolResultPart['output']): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: 'c1', toolName, output }],
})

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

describe('turnHasToolActivity', () => {
  test('a tool-result message counts as tool activity', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'list open tasks' },
      toolResultMessage('list_tasks', { type: 'json', value: { ok: true } }),
    ]
    expect(turnHasToolActivity(messages)).toBe(true)
  })

  test('an assistant-only history has no tool activity', () => {
    const messages: ModelMessage[] = [{ role: 'assistant', content: 'All done.' }]
    expect(turnHasToolActivity(messages)).toBe(false)
  })
})

describe('deriveVerdict', () => {
  const emptyTextHistory: ModelMessage[] = [
    { role: 'user', content: 'list open tasks' },
    { role: 'assistant', content: '' },
  ]
  const activeHistory: ModelMessage[] = [
    { role: 'user', content: 'list open tasks' },
    toolResultMessage('list_tasks', { type: 'json', value: { ok: true } }),
    { role: 'assistant', content: '' },
  ]
  const failedHistory: ModelMessage[] = [
    { role: 'user', content: 'list open tasks' },
    toolResultMessage('update_task', { type: 'json', value: failure }),
    { role: 'assistant', content: '' },
  ]

  test('verdict derivation matrix: truncated and partial precede no-op; activity keeps confirmed', async () => {
    const rows: readonly Row<{ turn: CompletionTurn; expected: CompletionVerdict }>[] = [
      {
        label: 'empty text with no tool activity is a no-op',
        turn: { history: emptyTextHistory, finishReason: 'stop', hadToolFailure: false, hadToolActivity: false },
        expected: 'no-op',
      },
      {
        label: 'empty text with tool activity stays on the confirmed path',
        turn: { history: activeHistory, finishReason: 'stop', hadToolFailure: false, hadToolActivity: true },
        expected: 'confirmed',
      },
      {
        label: 'a pending tool call beats no-op (truncated)',
        turn: { history: emptyTextHistory, finishReason: 'tool-calls', hadToolFailure: false, hadToolActivity: false },
        expected: 'truncated',
      },
      {
        label: 'a tool failure beats no-op (partial)',
        turn: { history: emptyTextHistory, finishReason: 'stop', hadToolFailure: true, hadToolActivity: false },
        expected: 'partial',
      },
      {
        label: 'a pending tool call also beats a tool failure (truncated keeps priority)',
        turn: { history: failedHistory, finishReason: 'tool-calls', hadToolFailure: true, hadToolActivity: true },
        expected: 'truncated',
      },
      {
        label: 'non-empty text with no activity stays confirmed',
        turn: {
          history: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'All done.' },
          ],
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: false,
        },
        expected: 'confirmed',
      },
      {
        label: 'assistant text delivered as content parts still counts as text',
        turn: {
          history: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] },
          ],
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: false,
        },
        expected: 'confirmed',
      },
    ]
    await assertEach(rows, (row) => {
      expect(deriveVerdict(row.turn)).toBe(row.expected)
    })
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

  const fallbackDeps = (mode: 'empty' | 'throw'): VerifierDeps => ({
    readOnlyToolset: undefined,
    invokeVerifier: (): Promise<{ text: string | undefined }> => {
      if (mode === 'throw') throw new Error('network')
      return Promise.resolve({ text: '' })
    },
  })

  test('confirmed: passes through the verifier text', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: false, hadToolActivity: true },
      okDeps('Created task TK-42.'),
    )
    expect(result).toEqual({ text: 'Created task TK-42.', verdict: 'confirmed' })
  })

  test('truncated: verdict is truncated and the prompt asks for a progress summary, offering "continue" as an option', async () => {
    mockLogger()
    let seen: VerifierPrompt | undefined
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'tool-calls', hadToolFailure: false, hadToolActivity: false },
      okDeps('Did A and B; C still pending — say continue to resume.', (p) => {
        seen = p
      }),
    )
    expect(result.verdict).toBe('truncated')
    // The reworded prompt frames the turn as a lot of work done, summarizing progress and
    // remaining steps, and offers "continue" as an option rather than demanding it.
    expect(seen?.system).toContain('what remains')
    expect(seen?.system).toContain('continue')
    expect(seen?.system).not.toContain('reached the tool-step limit before finishing')
  })

  test('partial: a tool failure yields the partial verdict', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: true, hadToolActivity: true },
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
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: false, hadToolActivity: true },
      deps,
    )
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toContain('could not confirm')
  })

  test('unconfirmed: neutral message when the verifier returns empty text', async () => {
    mockLogger()
    const result = await buildVerifiedCompletion(
      { history: [], finishReason: 'stop', hadToolFailure: false, hadToolActivity: true },
      okDeps(''),
    )
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toContain('could not confirm')
  })

  test('unconfirmed fallback selection matrix: activity picks the neutral vs the no-op message', async () => {
    mockLogger()
    const rows: readonly Row<{ mode: 'empty' | 'throw'; hadToolActivity: boolean; expectedText: string }>[] = [
      {
        label: 'verifier empty after an active turn reports the actions ran but were unconfirmed',
        mode: 'empty',
        hadToolActivity: true,
        expectedText: 'I ran the requested actions but could not confirm the result — please double-check.',
      },
      {
        label: 'verifier empty after a no-op turn says nothing was executed',
        mode: 'empty',
        hadToolActivity: false,
        expectedText: 'It looks like nothing was actually executed this turn — it cut off. Please repeat your request.',
      },
      {
        label: 'verifier throw after an active turn reports the actions ran but were unconfirmed',
        mode: 'throw',
        hadToolActivity: true,
        expectedText: 'I ran the requested actions but could not confirm the result — please double-check.',
      },
      {
        label: 'verifier throw after a no-op turn says nothing was executed',
        mode: 'throw',
        hadToolActivity: false,
        expectedText: 'It looks like nothing was actually executed this turn — it cut off. Please repeat your request.',
      },
    ]
    await assertEach(rows, async (row) => {
      const result = await buildVerifiedCompletion(
        { history: [], finishReason: 'stop', hadToolFailure: false, hadToolActivity: row.hadToolActivity },
        fallbackDeps(row.mode),
      )
      expect(result.verdict).toBe('unconfirmed')
      expect(result.text).toBe(row.expectedText)
    })
  })
})
