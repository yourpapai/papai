// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MessageQueue } from '../../src/message-queue/queue.js'
import type { QueueItem } from '../../src/message-queue/types.js'
import { createMockReply, mockLogger } from '../utils/test-helpers.js'

function groupItem(userId: string, text: string): QueueItem {
  return {
    text,
    userId,
    username: userId,
    storageContextId: 'group-1:thread-1',
    configContextId: 'group-1',
    contextType: 'group',
    newAttachmentIds: [],
    voiceStagedIds: [],
  }
}

describe('MessageQueue one-run-per-thread serialization', () => {
  test('a different-user flush does not start a second handler until the first completes', async () => {
    mockLogger()
    const queue = new MessageQueue('group-1:thread-1')
    const active: string[] = []
    let maxConcurrent = 0

    queue.setHandler(async (coalesced) => {
      active.push(coalesced.userId)
      maxConcurrent = Math.max(maxConcurrent, active.length)
      await new Promise<void>((r) => {
        setTimeout(r, 20)
      })
      active.pop()
    })

    const { reply } = createMockReply()
    // Alice buffers, then Bob (different user) arrives — old behavior dispatched Alice fire-and-forget.
    queue.enqueue(groupItem('alice', 'one'), reply)
    queue.enqueue(groupItem('bob', 'two'), reply)

    // Wait for the debounce + both handler runs.
    await new Promise<void>((r) => {
      setTimeout(r, 100)
    })
    expect(maxConcurrent).toBe(1)
  })
})
