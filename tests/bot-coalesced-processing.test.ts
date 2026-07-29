// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { processCoalescedMessage } from '../src/bot-coalesced-processing.js'
import type { BotDeps } from '../src/bot.js'
import type { CoalescedItem } from '../src/message-queue/types.js'
import { createMockReply, mockLogger } from './utils/test-helpers.js'

const makeCoalesced = (overrides: Partial<CoalescedItem> = {}): CoalescedItem => ({
  text: 'hello',
  userId: 'u1',
  username: 'alice',
  storageContextId: 'u1',
  contextType: 'dm',
  configContextId: undefined,
  newAttachmentIds: [],
  voiceStagedIds: [],
  reply: createMockReply().reply,
  turnId: 't1',
  messageIds: ['m1'],
  segments: [{ messageId: 'm1', text: 'hello', username: 'alice' }],
  ...overrides,
})

describe('processCoalescedMessage', () => {
  test('forwards coalescedItem fields to processMessage including messageIds + segments', async () => {
    mockLogger()
    const captured: {
      contextType: string
      rest: readonly unknown[]
    } = { contextType: '', rest: [] }
    const deps: BotDeps = {
      processMessage: (_reply, _ctx, _uid, _uname, _text, contextType, ...rest): Promise<void> => {
        captured.contextType = contextType
        captured.rest = rest
        return Promise.resolve()
      },
    }
    await processCoalescedMessage(makeCoalesced({ messageIds: ['m1', 'm2'] }), deps)
    // rest tuple: [configContextId, deps, newAttachmentIds, turnId, actorRole, originatingMessageIds, segments]
    expect(captured.contextType).toBe('dm')
    expect(captured.rest[5]).toEqual(['m1', 'm2'])
    expect(captured.rest[6]).toEqual([{ messageId: 'm1', text: 'hello', username: 'alice' }])
  })

  test('rethrows after running the finally block when processMessage rejects', async () => {
    mockLogger()
    const deps: BotDeps = {
      processMessage: (): Promise<void> => Promise.reject(new Error('boom')),
    }
    await expect(processCoalescedMessage(makeCoalesced(), deps)).rejects.toThrow('boom')
  })
})
