// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import * as conversationModule from '../../src/conversation.js'
import {
  buildMetadataMessages,
  buildMinimalSystemPrompt,
  finalizeAndLog,
  finalizeDeliveryText,
  getStorageContextId,
  modelIdForLightweight,
  persistContextResponse,
  persistProactiveResults,
  timezoneOrUtc,
  toolCallCount,
  wrapPrompt,
} from '../../src/deferred-prompts/proactive-llm-helpers.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'
import * as historyModule from '../../src/history.js'
import * as memoryRunnerModule from '../../src/long-term-memory/runner.js'
import { mockLogger } from '../utils/test-helpers.js'

const dmTarget: DeferredDeliveryTarget = {
  contextId: 'user-1',
  contextType: 'dm',
  threadId: null,
  audience: 'personal',
  mentionUserIds: [],
  createdByUserId: 'user-1',
  createdByUsername: null,
}

describe('proactive-llm-helpers', () => {
  const spies: Array<{ mockRestore: () => void }> = []

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  const track = <T extends { mockRestore: () => void }>(spy: T): T => {
    spies.push(spy)
    return spy
  }

  test('uses thread-scoped storage context for group threads', () => {
    expect(
      getStorageContextId({
        ...dmTarget,
        contextId: '-1001',
        contextType: 'group',
        threadId: '42',
      }),
    ).toBe('-1001:42')
  })

  test('uses delivery context id when no group thread exists', () => {
    expect(getStorageContextId(dmTarget)).toBe('user-1')
  })

  test('resolves fallback values without fallback expressions at call sites', () => {
    expect(finalizeDeliveryText({ text: undefined, finishReason: 'stop' })).toBe('Done.')
    expect(finalizeDeliveryText({ text: 'Ready', finishReason: 'stop' })).toBe('Ready')
    expect(modelIdForLightweight(null, 'main-model')).toBe('main-model')
    expect(modelIdForLightweight('small-model', 'main-model')).toBe('small-model')
    expect(timezoneOrUtc(null)).toBe('UTC')
    expect(timezoneOrUtc('Europe/Berlin')).toBe('Europe/Berlin')
  })

  test('drops incomplete text when the turn ended on a pending tool call', () => {
    expect(
      finalizeDeliveryText({
        text: 'Let me first check the current date and time to give you an accurate reminder.',
        finishReason: 'tool-calls',
      }),
    ).toBe('Done.')
  })

  test('treats empty text as the Done fallback', () => {
    expect(finalizeDeliveryText({ text: '', finishReason: 'stop' })).toBe('Done.')
  })

  test('counts top-level tool calls defensively', () => {
    expect(toolCallCount({ toolCalls: [{ toolName: 'create_task' }] })).toBe(1)
    expect(toolCallCount({ toolCalls: 'not-an-array' })).toBeUndefined()
    expect(toolCallCount(null)).toBeUndefined()
  })

  test('builds minimal prompt and metadata messages', () => {
    const metadata: ExecutionMetadata = {
      mode: 'lightweight',
      delivery_brief: 'Brief',
      context_snapshot: 'Snapshot',
    }

    expect(buildMinimalSystemPrompt('scheduled')).toContain('[PROACTIVE EXECUTION]')
    expect(buildMetadataMessages(metadata)).toEqual([
      { role: 'system', content: '[DELIVERY BRIEF]\nBrief' },
      { role: 'system', content: '[CONTEXT FROM CREATION TIME]\nSnapshot' },
    ])
    expect(wrapPrompt('drink water')).toBe('===DEFERRED_TASK===\ndrink water\n===END_DEFERRED_TASK===')
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

describe('finalizeAndLog verification', () => {
  test('empty text + verification → verified text', async () => {
    mockLogger()
    const text = await finalizeAndLog(
      { text: '', finishReason: 'stop', response: { messages: [] } },
      'user-1',
      'full',
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: 'Reminder delivered.' }),
        },
      },
    )
    expect(text).toBe('Reminder delivered.')
  })

  test('no verification arg → legacy Done. fallback preserved', async () => {
    mockLogger()
    const text = await finalizeAndLog({ text: '', finishReason: 'stop' }, 'user-1', 'lightweight')
    expect(text).toBe('Done.')
  })
})
