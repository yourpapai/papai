// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ReplyFn } from '../../../src/chat/types.js'
import { MessageQueue } from '../../../src/message-queue/queue.js'
import type { CoalescedItem, QueueItem } from '../../../src/message-queue/types.js'
import { waitFor } from '../../utils/test-helpers.js'
import { scenario } from '../harness/scenario.js'

function groupItem(userId: string, text: string, attachmentIds: readonly string[] = []): QueueItem {
  return {
    text,
    userId,
    username: userId,
    storageContextId: 'group-1:thread-1',
    configContextId: 'group-1',
    contextType: 'group',
    newAttachmentIds: attachmentIds,
    voiceStagedIds: [],
  }
}

function createMockReply(): ReplyFn {
  return {
    text: async () => {},
    formatted: async () => {},
    typing: () => {},
    buttons: () => Promise.resolve(undefined),
  }
}

function installBlockingHandler(
  queue: MessageQueue,
  aliceGate: Promise<undefined>,
  events: string[],
  counters: { active: number; maxActive: number; completed: number },
): void {
  queue.setHandler(async (turn: CoalescedItem) => {
    events.push(`start:${turn.text}`)
    counters.active++
    counters.maxActive = Math.max(counters.maxActive, counters.active)
    try {
      if (turn.userId === 'alice') await aliceGate
      events.push(`end:${turn.text}`)
    } finally {
      counters.active--
      counters.completed++
    }
  })
}

scenario('SCN-queue-coalescing: same-actor messages form one ordered turn', () => {
  const queue = new MessageQueue('group-1:thread-1')
  const firstReply = createMockReply()
  const lastReply = createMockReply()
  queue.enqueue(groupItem('alice', 'first', ['att-1']), firstReply)
  queue.enqueue(groupItem('alice', 'second', ['att-2']), lastReply)

  const turn = queue.forceFlush()
  expect(turn).not.toBeNull()
  expect(turn?.text).toBe('[@alice]: first\n[@alice]: second')
  expect(turn?.newAttachmentIds).toEqual(['att-1', 'att-2'])
  expect(turn?.reply).toBe(lastReply)
})

scenario('SCN-queue-group-serialization: actor changes flush and serialize group-thread turns', async () => {
  const queue = new MessageQueue('group-1:thread-1')
  const alice = Promise.withResolvers<undefined>()
  const events: string[] = []
  const counters = { active: 0, maxActive: 0, completed: 0 }
  installBlockingHandler(queue, alice.promise, events, counters)

  const reply = createMockReply()
  queue.enqueue(groupItem('alice', 'one'), reply)
  queue.enqueue(groupItem('bob', 'two'), reply)
  await waitFor(() => events.includes('start:[@alice]: one'))
  alice.resolve(undefined)
  await waitFor(() => counters.completed === 2)

  expect(events).toEqual(['start:[@alice]: one', 'end:[@alice]: one', 'start:[@bob]: two', 'end:[@bob]: two'])
  expect(counters.maxActive).toBe(1)

  const recoveryQueue = new MessageQueue('group-1:thread-1')
  const failedAlice = Promise.withResolvers<undefined>()
  const recoveryEvents: string[] = []
  const recoveryCounters = { active: 0, maxActive: 0, completed: 0 }
  installBlockingHandler(recoveryQueue, failedAlice.promise, recoveryEvents, recoveryCounters)

  recoveryQueue.enqueue(groupItem('alice', 'one'), reply)
  recoveryQueue.enqueue(groupItem('bob', 'two'), reply)
  await waitFor(() => recoveryEvents.includes('start:[@alice]: one'))
  failedAlice.reject(new Error('expected Alice failure'))
  await waitFor(() => recoveryCounters.completed === 2)

  expect(recoveryEvents).toEqual(['start:[@alice]: one', 'start:[@bob]: two', 'end:[@bob]: two'])
  expect(recoveryCounters.maxActive).toBe(1)
})
