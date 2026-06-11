// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import * as conversationModule from '../src/conversation.js'
import * as historyModule from '../src/history.js'
import { appendAssistantHistory } from '../src/llm-history.js'
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

  const setup = (): { appendCalls: ModelMessage[][]; trimCalls: unknown[][] } => {
    mockLogger()
    const appendCalls: ModelMessage[][] = []
    const trimCalls: unknown[][] = []
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
    return { appendCalls, trimCalls }
  }

  test('appends assistant messages and does not trim a short history', () => {
    const { appendCalls, trimCalls } = setup()
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
  })

  test('triggers a background trim when the threshold is crossed', () => {
    const { trimCalls } = setup()
    track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(true))

    appendAssistantHistory(
      'ctx',
      'cfg',
      'gpt-4o',
      [{ role: 'user', content: 'hi' }],
      [{ role: 'assistant', content: 'hello' }],
    )

    expect(trimCalls).toHaveLength(1)
    expect(trimCalls[0]![0]).toBe('ctx')
    expect(trimCalls[0]![3]).toBe('cfg')
  })

  test('passes the model name through to the trim decision', () => {
    setup()
    const shouldTrim = track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(false))

    appendAssistantHistory('ctx', 'cfg', 'claude-opus-4-8', [{ role: 'user', content: 'hi' }], [])

    expect(shouldTrim).toHaveBeenCalled()
    expect(shouldTrim.mock.calls[0]![1]).toBe('claude-opus-4-8')
  })
})
