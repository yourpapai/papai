// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import * as conversationModule from '../../src/conversation.js'
import {
  persistContextResponse,
  persistProactiveResults,
  toolCallCount,
} from '../../src/deferred-prompts/proactive-llm-persist.js'
import * as historyModule from '../../src/history.js'
import * as memoryRunnerModule from '../../src/long-term-memory/runner.js'

describe('proactive-llm-persist', () => {
  const spies: Array<{ mockRestore: () => void }> = []

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  const track = <T extends { mockRestore: () => void }>(spy: T): T => {
    spies.push(spy)
    return spy
  }

  test('counts top-level tool calls defensively', () => {
    expect(toolCallCount({ toolCalls: [{ toolName: 'create_task' }] })).toBe(1)
    expect(toolCallCount({ toolCalls: 'not-an-array' })).toBeUndefined()
    expect(toolCallCount(null)).toBeUndefined()
  })

  test('context-mode persistence triggers long-term extraction when trimming', () => {
    const extractionCalls: unknown[][] = []
    track(spyOn(historyModule, 'appendHistory').mockImplementation(() => undefined))
    track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(true))
    track(spyOn(conversationModule, 'runTrimInBackground').mockResolvedValue(undefined))
    track(
      spyOn(memoryRunnerModule, 'runMemoryExtractionInBackground').mockImplementation((...args: unknown[]) => {
        extractionCalls.push(args)
        return Promise.resolve()
      }),
    )
    const history: ModelMessage[] = [{ role: 'user', content: 'Remember the release cadence.' }]
    const assistantMessages: ModelMessage[] = [{ role: 'assistant', content: 'Captured.' }]

    persistContextResponse('ctx:thread', 'cfg', 'group', history, 'gpt-main', assistantMessages)

    expect(extractionCalls[0]?.[0]).toEqual({
      storageContextId: 'ctx:thread',
      configContextId: 'cfg',
      contextType: 'group',
      history: [...history, ...assistantMessages],
    })
  })

  test('full-mode persistence triggers long-term extraction when trimming', () => {
    const extractionCalls: unknown[][] = []
    track(spyOn(historyModule, 'appendHistory').mockImplementation(() => undefined))
    track(spyOn(conversationModule, 'shouldTriggerTrim').mockReturnValue(true))
    track(spyOn(conversationModule, 'runTrimInBackground').mockResolvedValue(undefined))
    track(
      spyOn(memoryRunnerModule, 'runMemoryExtractionInBackground').mockImplementation((...args: unknown[]) => {
        extractionCalls.push(args)
        return Promise.resolve()
      }),
    )
    const history: ModelMessage[] = [{ role: 'user', content: 'Ship notes every Friday.' }]
    const assistantMessages: ModelMessage[] = [{ role: 'assistant', content: 'Done.' }]

    persistProactiveResults(
      'creator',
      'ctx',
      'cfg',
      'dm',
      { response: { messages: assistantMessages }, text: 'Done.', toolCalls: [] },
      history,
      'gpt-main',
    )

    expect(extractionCalls[0]?.[0]).toEqual({
      storageContextId: 'ctx',
      configContextId: 'cfg',
      contextType: 'dm',
      history: [...history, ...assistantMessages],
    })
  })
})
