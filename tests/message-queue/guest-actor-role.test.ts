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
  storageContextId: 'g1',
  contextType: 'group',
  newAttachmentIds: [],
  voiceStagedIds: [],
  ...overrides,
})

describe('queue actorRole propagation', () => {
  test('flush carries actorRole from the buffered item', () => {
    const q = new MessageQueue('g1')
    q.enqueue(baseItem({ actorRole: 'guest' }), createMockReply().reply)
    const flushed = q.forceFlush()
    expect(flushed?.actorRole).toBe('guest')
  })
})
