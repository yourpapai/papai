// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MessageQueue } from '../../src/message-queue/queue.js'
import type { QueueItem } from '../../src/message-queue/types.js'
import { createMockReply } from '../utils/test-helpers.js'

const baseItem = (overrides: Partial<QueueItem>): QueueItem => ({
  text: 'hi',
  userId: 'u1',
  username: null,
  storageContextId: 'user1',
  contextType: 'dm',
  newAttachmentIds: [],
  voiceStagedIds: [],
  ...overrides,
})

describe('queue identity propagation', () => {
  test('flush carries isBotAdmin and platformInstanceId from the buffered item', () => {
    const q = new MessageQueue('user1')
    q.enqueue(baseItem({ isBotAdmin: true, platformInstanceId: 'pi-1' }), createMockReply().reply)
    const flushed = q.forceFlush()
    expect(flushed?.isBotAdmin).toBe(true)
    expect(flushed?.platformInstanceId).toBe('pi-1')
  })

  test('coalesced flush takes the last message identity values', () => {
    const q = new MessageQueue('user1')
    q.enqueue(baseItem({ isBotAdmin: true, platformInstanceId: 'pi-1' }), createMockReply().reply)
    q.enqueue(baseItem({ isBotAdmin: false, platformInstanceId: 'pi-2' }), createMockReply().reply)
    const flushed = q.forceFlush()
    expect(flushed?.isBotAdmin).toBe(false)
    expect(flushed?.platformInstanceId).toBe('pi-2')
  })

  test('coalesced flush takes admin identity when the last message is from an admin', () => {
    const q = new MessageQueue('user1')
    q.enqueue(baseItem({ isBotAdmin: false, platformInstanceId: 'pi-1' }), createMockReply().reply)
    q.enqueue(baseItem({ isBotAdmin: true, platformInstanceId: 'pi-2' }), createMockReply().reply)
    const flushed = q.forceFlush()
    expect(flushed?.isBotAdmin).toBe(true)
    expect(flushed?.platformInstanceId).toBe('pi-2')
  })
})
