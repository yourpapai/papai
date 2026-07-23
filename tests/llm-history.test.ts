// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import * as conversationModule from '../src/conversation.js'
import * as historyModule from '../src/history.js'
import { appendAssistantHistory } from '../src/llm-history.js'
import * as captureDebouncModule from '../src/long-term-memory/capture-debounce.js'
import * as memoryRunnerModule from '../src/long-term-memory/runner.js'
import { mockLogger } from './utils/test-helpers.js'

type SpyInstance = { mockRestore: () => void }

describe('appendAssistantHistory', () => {
  const spies: SpyInstance[] = []

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  const track = <T extends SpyInstance>(spy: T): T => {
    spies.push(spy)
    return spy
  }

  const setup = (): {
    appendCalls: ModelMessage[][]
    trimCalls: unknown[][]
    extractionCalls: unknown[][]
    armCalls: unknown[][]
  } => {
    mockLogger()
    const appendCalls: ModelMessage[][] = []
    const trimCalls: unknown[][] = []
    const extractionCalls: unknown[][] = []
    const armCalls: unknown[][] = []
    track(
      spyOn(historyModule, 'appendHistory').mockImplementation((_id: string, msgs: readonly ModelMessage[]) => {
        appendCalls.push([...msgs])
      }),
    )
    track(
      spyOn(conversationModule, 'runTrimInBackground').mockImplementation((...args: unknown[]) => {
        trimCalls.push(args)
        return Promise.resolve()
      }),
    )
    track(
      spyOn(memoryRunnerModule, 'runMemoryExtractionInBackground').mockImplementation((...args: unknown[]) => {
        extractionCalls.push(args)
        return Promise.resolve()
      }),
    )
    track(
      spyOn(captureDebouncModule, 'armMemoryCapture').mockImplementation((...args: unknown[]) => {
        armCalls.push(args)
      }),
    )
    return { appendCalls, trimCalls, extractionCalls, armCalls }
  }

  test('appends assistant messages and does not trim a short history', () => {
    const { appendCalls, trimCalls, extractionCalls } = setup()
    track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(false))

    appendAssistantHistory(
      'ctx',
      'cfg',
      'gpt-4o',
      [{ role: 'user', content: 'hi' }],
      [{ role: 'assistant', content: 'hello' }],
    )

    expect(appendCalls).toHaveLength(1)
    expect(trimCalls).toHaveLength(0)
    expect(extractionCalls).toHaveLength(0)
  })

  test('triggers background trim and memory extraction when the threshold is crossed', () => {
    const { trimCalls, extractionCalls } = setup()
    track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(true))
    const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const assistantMessages: ModelMessage[] = [{ role: 'assistant', content: 'hello' }]

    appendAssistantHistory('ctx', 'cfg', 'gpt-4o', history, assistantMessages, 'group')

    expect(trimCalls).toHaveLength(1)
    expect(trimCalls[0]![0]).toBe('ctx')
    expect(trimCalls[0]![3]).toBe('cfg')
    expect(extractionCalls).toHaveLength(1)
    expect(extractionCalls[0]![0]).toEqual({
      storageContextId: 'ctx',
      configContextId: 'cfg',
      contextType: 'group',
      history: [...history, ...assistantMessages],
    })
  })

  test('passes the model name through to the trim decision', () => {
    setup()
    const shouldTrim = track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(false))

    appendAssistantHistory('ctx', 'cfg', 'claude-opus-4-8', [{ role: 'user', content: 'hi' }], [])

    expect(shouldTrim).toHaveBeenCalled()
    expect(shouldTrim.mock.calls[0]![1]).toBe('claude-opus-4-8')
  })

  test('defers background trim and extraction when the turn was truncated at the step cap', () => {
    const { appendCalls, trimCalls, extractionCalls } = setup()
    // Threshold is crossed, but a truncated (mid-task) turn must not be trimmed yet.
    track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(true))
    const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const assistantMessages: ModelMessage[] = [{ role: 'assistant', content: 'partial' }]

    appendAssistantHistory('ctx', 'cfg', 'gpt-4o', history, assistantMessages, 'group', 'member', true)

    // The in-progress tool trace is still persisted so "continue" can see it...
    expect(appendCalls).toHaveLength(1)
    expect(appendCalls[0]).toEqual(assistantMessages)
    // ...but no trim/extraction runs that could collapse it before the resume turn.
    expect(trimCalls).toHaveLength(0)
    expect(extractionCalls).toHaveLength(0)
  })

  test('trims a completed turn even right after several truncated ones (self-heal boundary)', () => {
    const { trimCalls } = setup()
    track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(true))
    const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const assistantMessages: ModelMessage[] = [{ role: 'assistant', content: 'done' }]

    // Truncated turns defer trimming...
    appendAssistantHistory('ctx', 'cfg', 'gpt-4o', history, assistantMessages, 'group', 'member', true)
    expect(trimCalls).toHaveLength(0)

    // ...but the first completed (non-truncated) turn compresses the accumulated trace.
    appendAssistantHistory('ctx', 'cfg', 'gpt-4o', history, assistantMessages, 'group', 'member', false)
    expect(trimCalls).toHaveLength(1)
  })

  test('arms debounced memory capture unconditionally on each group turn', () => {
    const { armCalls } = setup()
    track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(false))
    const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const assistantMessages: ModelMessage[] = [{ role: 'assistant', content: 'hello' }]

    appendAssistantHistory('ctx', 'cfg', 'gpt-4o', history, assistantMessages, 'group')

    expect(armCalls).toHaveLength(1)
    expect(armCalls[0]![0]).toEqual({
      storageContextId: 'ctx',
      configContextId: 'cfg',
      contextType: 'group',
      history: [...history, ...assistantMessages],
      actorRole: 'member',
    })
  })
})
