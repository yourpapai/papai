// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import {
  buildMetadataMessages,
  buildMinimalSystemPrompt,
  finalizeAndLog,
  finalizeDeliveryText,
  getStorageContextId,
  modelIdForLightweight,
  timezoneOrUtc,
  wrapPrompt,
} from '../../src/deferred-prompts/proactive-llm-helpers.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'
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
