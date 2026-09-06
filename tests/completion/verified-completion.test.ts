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

  test('keeps read_-prefixed tools and still drops expand_result and mutating tools', () => {
    const result = selectReadOnlyTools(
      fakeTools('get_task', 'read_recent_logs', 'create_task', 'update_task', 'delete_project', 'expand_result'),
    )
    expect(result).not.toBeUndefined()
    expect(Object.keys(result!).sort()).toEqual(['get_task', 'read_recent_logs'])
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
        label: 'empty final text with no tool activity is a no-op',
        turn: {
          history: emptyTextHistory,
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: false,
          finalText: '',
        },
        expected: 'no-op',
      },
      {
        label: 'empty final text with tool activity stays on the confirmed path',
        turn: {
          history: activeHistory,
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: true,
          finalText: '',
        },
        expected: 'confirmed',
      },
      {
        label: 'a pending tool call beats no-op (truncated)',
        turn: {
          history: emptyTextHistory,
          finishReason: 'tool-calls',
          hadToolFailure: false,
          hadToolActivity: false,
          finalText: '',
        },
        expected: 'truncated',
      },
      {
        label: 'a tool failure beats no-op (partial)',
        turn: {
          history: emptyTextHistory,
          finishReason: 'stop',
          hadToolFailure: true,
          hadToolActivity: false,
          finalText: '',
        },
        expected: 'partial',
      },
      {
        label: 'a pending tool call also beats a tool failure (truncated keeps priority)',
        turn: {
          history: failedHistory,
          finishReason: 'tool-calls',
          hadToolFailure: true,
          hadToolActivity: true,
          finalText: '',
        },
        expected: 'truncated',
      },
      {
        label: 'non-empty final text with no activity stays confirmed',
        turn: {
          history: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'All done.' },
          ],
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: false,
          finalText: 'All done.',
        },
        expected: 'confirmed',
      },
      {
        label: 'stale assistant text from earlier turns does not mask a no-op turn',
        turn: {
          history: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'Earlier reply.' },
            { role: 'user', content: 'list open tasks' },
          ],
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: false,
          finalText: '',
        },
        expected: 'no-op',
      },
      {
        label: 'undefined final text with no activity is a no-op',
        turn: {
          history: [],
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: false,
        },
        expected: 'no-op',
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

  const fallbackDeps = (mode: 'empty' | 'whitespace' | 'throw'): VerifierDeps => ({
    readOnlyToolset: undefined,
    invokeVerifier: (): Promise<{ text: string | undefined }> => {
      if (mode === 'throw') throw new Error('network')
      return Promise.resolve({ text: mode === 'empty' ? '' : '  \n\t ' })
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

  test('degraded verifier (empty/whitespace/throw) on a turn with model text delivers the model answer with the derived verdict', async () => {
    mockLogger()
    const modelAnswer = 'Task TK-42 moved to Done.'
    const activeTurn: CompletionTurn = {
      history: [],
      finishReason: 'stop',
      hadToolFailure: false,
      hadToolActivity: true,
      finalText: modelAnswer,
    }
    const rows: readonly Row<{
      mode: 'empty' | 'whitespace' | 'throw'
      turn: CompletionTurn
      expectedVerdict: CompletionVerdict
    }>[] = [
      {
        label: 'verifier empty on an active turn keeps the confirmed verdict',
        mode: 'empty',
        turn: activeTurn,
        expectedVerdict: 'confirmed',
      },
      {
        label: 'whitespace-only verifier text on an active turn keeps the confirmed verdict',
        mode: 'whitespace',
        turn: activeTurn,
        expectedVerdict: 'confirmed',
      },
      {
        label: 'verifier throw on an active turn keeps the confirmed verdict',
        mode: 'throw',
        turn: activeTurn,
        expectedVerdict: 'confirmed',
      },
      {
        label: 'verifier empty on a failed turn keeps the partial verdict',
        mode: 'empty',
        turn: { ...activeTurn, hadToolFailure: true },
        expectedVerdict: 'partial',
      },
      {
        label: 'whitespace-only verifier text on a failed turn keeps the partial verdict',
        mode: 'whitespace',
        turn: { ...activeTurn, hadToolFailure: true },
        expectedVerdict: 'partial',
      },
      {
        label: 'verifier throw on a failed turn keeps the partial verdict',
        mode: 'throw',
        turn: { ...activeTurn, hadToolFailure: true },
        expectedVerdict: 'partial',
      },
      {
        label: 'verifier empty on a truncated turn keeps the truncated verdict',
        mode: 'empty',
        turn: { ...activeTurn, finishReason: 'tool-calls' },
        expectedVerdict: 'truncated',
      },
      {
        label: 'whitespace-only verifier text on a truncated turn keeps the truncated verdict',
        mode: 'whitespace',
        turn: { ...activeTurn, finishReason: 'tool-calls' },
        expectedVerdict: 'truncated',
      },
      {
        label: 'verifier throw on a truncated turn keeps the truncated verdict',
        mode: 'throw',
        turn: { ...activeTurn, finishReason: 'tool-calls' },
        expectedVerdict: 'truncated',
      },
    ]
    await assertEach(rows, async (row) => {
      const result = await buildVerifiedCompletion(row.turn, fallbackDeps(row.mode))
      expect(result.text).toBe(modelAnswer)
      expect(result.verdict).toBe(row.expectedVerdict)
    })
  })

  test('unconfirmed stub matrix with no model text: the activity-selected stub still fires for every verifier failure mode', async () => {
    mockLogger()
    const neutralStub = 'I ran the requested actions but could not confirm the result — please double-check.'
    const noopStub = 'It looks like nothing was actually executed this turn — it cut off. Please repeat your request.'
    const rows: readonly Row<{
      mode: 'empty' | 'whitespace' | 'throw'
      finalText: string | undefined
      hadToolActivity: boolean
      expectedText: string
    }>[] = [
      {
        label: 'verifier empty with an explicit empty final text after an active turn picks the neutral stub',
        mode: 'empty',
        finalText: '',
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label: 'verifier empty with an explicit empty final text after a no-op turn picks the no-op stub',
        mode: 'empty',
        finalText: '',
        hadToolActivity: false,
        expectedText: noopStub,
      },
      {
        label: 'verifier empty with an undefined final text after an active turn picks the neutral stub',
        mode: 'empty',
        finalText: undefined,
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label: 'verifier empty with an undefined final text after a no-op turn picks the no-op stub',
        mode: 'empty',
        finalText: undefined,
        hadToolActivity: false,
        expectedText: noopStub,
      },
      {
        label:
          'whitespace-only verifier text with an explicit empty final text after an active turn picks the neutral stub',
        mode: 'whitespace',
        finalText: '',
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label:
          'whitespace-only verifier text with an explicit empty final text after a no-op turn picks the no-op stub',
        mode: 'whitespace',
        finalText: '',
        hadToolActivity: false,
        expectedText: noopStub,
      },
      {
        label: 'whitespace-only verifier text with an undefined final text after an active turn picks the neutral stub',
        mode: 'whitespace',
        finalText: undefined,
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label: 'whitespace-only verifier text with an undefined final text after a no-op turn picks the no-op stub',
        mode: 'whitespace',
        finalText: undefined,
        hadToolActivity: false,
        expectedText: noopStub,
      },
      {
        label: 'verifier throw with an explicit empty final text after an active turn picks the neutral stub',
        mode: 'throw',
        finalText: '',
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label: 'verifier throw with an explicit empty final text after a no-op turn picks the no-op stub',
        mode: 'throw',
        finalText: '',
        hadToolActivity: false,
        expectedText: noopStub,
      },
      {
        label: 'verifier throw with an undefined final text after an active turn picks the neutral stub',
        mode: 'throw',
        finalText: undefined,
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label: 'verifier throw with an undefined final text after a no-op turn picks the no-op stub',
        mode: 'throw',
        finalText: undefined,
        hadToolActivity: false,
        expectedText: noopStub,
      },
    ]
    await assertEach(rows, async (row) => {
      const result = await buildVerifiedCompletion(
        {
          history: [],
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: row.hadToolActivity,
          finalText: row.finalText,
        },
        fallbackDeps(row.mode),
      )
      expect(result.verdict).toBe('unconfirmed')
      expect(result.text).toBe(row.expectedText)
    })
  })

  test('whitespace-only final text counts as no model text: the activity-selected unconfirmed stub fires', async () => {
    mockLogger()
    const neutralStub = 'I ran the requested actions but could not confirm the result — please double-check.'
    const noopStub = 'It looks like nothing was actually executed this turn — it cut off. Please repeat your request.'
    const rows: readonly Row<{
      mode: 'empty' | 'whitespace' | 'throw'
      hadToolActivity: boolean
      expectedText: string
    }>[] = [
      {
        label: 'verifier empty after an active turn picks the neutral stub',
        mode: 'empty',
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label: 'verifier empty after a no-op turn picks the no-op stub',
        mode: 'empty',
        hadToolActivity: false,
        expectedText: noopStub,
      },
      {
        label: 'whitespace verifier text after an active turn picks the neutral stub',
        mode: 'whitespace',
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label: 'whitespace verifier text after a no-op turn picks the no-op stub',
        mode: 'whitespace',
        hadToolActivity: false,
        expectedText: noopStub,
      },
      {
        label: 'verifier throw after an active turn picks the neutral stub',
        mode: 'throw',
        hadToolActivity: true,
        expectedText: neutralStub,
      },
      {
        label: 'verifier throw after a no-op turn picks the no-op stub',
        mode: 'throw',
        hadToolActivity: false,
        expectedText: noopStub,
      },
    ]
    await assertEach(rows, async (row) => {
      const result = await buildVerifiedCompletion(
        {
          history: [],
          finishReason: 'stop',
          hadToolFailure: false,
          hadToolActivity: row.hadToolActivity,
          finalText: '  \n\t ',
        },
        fallbackDeps(row.mode),
      )
      expect(result.verdict).toBe('unconfirmed')
      expect(result.text).toBe(row.expectedText)
    })
  })
})
