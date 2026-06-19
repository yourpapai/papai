// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MessageQueue } from '../../src/message-queue/queue.js'
import type { QueueItem } from '../../src/message-queue/types.js'
import { createMockReply, mockLogger, waitFor } from '../utils/test-helpers.js'

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

// DEBOUNCE_MS in queue.ts is 500 ms. The handler below sleeps 600 ms — longer
// than the debounce — so without the handler-chain serialization Bob's turn
// (dispatched at ~500 ms via the old fire-and-forget path) would start while
// Alice's 600 ms handler is still running, yielding maxConcurrent === 2.
// With the chain fix Bob waits on the chain and maxConcurrent stays 1.
describe('MessageQueue one-run-per-thread serialization', () => {
  test('a different-user flush does not start a second handler until the first completes', async () => {
    mockLogger()
    const queue = new MessageQueue('group-1:thread-1')
    let active = 0
    let maxConcurrent = 0
    let completed = 0

    queue.setHandler(async (_coalesced) => {
      active++
      maxConcurrent = Math.max(maxConcurrent, active)
      await new Promise<void>((r) => {
        setTimeout(r, 600)
      })
      active--
      completed++
    })

    const { reply } = createMockReply()
    // Alice buffers, then Bob (different user) arrives — forces Alice's turn to
    // run via the handler chain, then Bob's turn runs after Alice's completes.
    queue.enqueue(groupItem('alice', 'one'), reply)
    queue.enqueue(groupItem('bob', 'two'), reply)

    // Poll until both handler executions finish (generous 3 s timeout).
    await waitFor(() => completed === 2, 3000)

    expect(completed).toBe(2)
    expect(maxConcurrent).toBe(1)
  })
})
