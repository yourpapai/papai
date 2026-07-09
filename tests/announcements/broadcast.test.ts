// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import {
  defaultBroadcastDepsForTest,
  broadcastAnnouncement,
  groupTarget,
  type BroadcastDeps,
} from '../../src/announcements/broadcast.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import * as proactiveDeliveryModule from '../../src/deferred-prompts/proactive-delivery.js'
import * as proactiveHistoryModule from '../../src/proactive-history.js'
import { createMockChat, mockLogger } from '../utils/test-helpers.js'

const chat = createMockChat()

type SpyInstance = { mockRestore: () => void }

function makeDeps(over: Partial<BroadcastDeps>): BroadcastDeps {
  const delivered = new Set<string>()
  return {
    listSubscribedUsers: () => [{ platformInstanceId: 'pi', platformUserId: 'u1' }],
    listSubscribedGroups: () => [{ groupId: 'g1' }],
    isDelivered: (v, ctx) => delivered.has(`${v}:${ctx}`),
    recordDelivery: (v, ctx, _t, status) => {
      if (status === 'sent') delivered.add(`${v}:${ctx}`)
    },
    markBroadcast: () => {},
    sendDm: () => Promise.resolve(true),
    sendGroup: () => Promise.resolve(true),
    now: () => '2026-06-26T00:00:00Z',
    ...over,
  }
}

describe('broadcastAnnouncement', () => {
  test('sends to all subscribers and returns counts', async () => {
    const result = await broadcastAnnouncement(chat, '9.9.9', 'body', makeDeps({}))
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 })
  })

  test('skips already-delivered recipients (idempotent re-broadcast)', async () => {
    const result = await broadcastAnnouncement(
      chat,
      '9.9.9',
      'body',
      makeDeps({
        isDelivered: (_v, ctx) => ctx === 'pi:u1',
      }),
    )
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 1 })
  })

  test('failure on one recipient does not abort the batch', async () => {
    const result = await broadcastAnnouncement(
      chat,
      '9.9.9',
      'body',
      makeDeps({
        sendGroup: () => Promise.resolve(false),
      }),
    )
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 })
  })

  test('a thrown send is counted as failed, not fatal', async () => {
    const result = await broadcastAnnouncement(
      chat,
      '9.9.9',
      'body',
      makeDeps({
        sendDm: () => Promise.reject(new Error('network')),
      }),
    )
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 })
  })

  test('marks the version broadcast when complete', async () => {
    let markedAt: string | null = null
    await broadcastAnnouncement(
      chat,
      '9.9.9',
      'body',
      makeDeps({
        markBroadcast: (_v, at) => {
          markedAt = at
        },
      }),
    )
    expect(markedAt!).toBe('2026-06-26T00:00:00Z')
  })

  test('groupTarget decodes a scoped group id to the native channel id for delivery', () => {
    // authorizedGroups.groupId is the scoped config context id; the delivery
    // target's contextId must carry the NATIVE platform id (used verbatim as the
    // Mattermost channel_id), while storageContextId keeps the scoped id for routing.
    const scoped = toScopedContextId({
      platformInstanceId: 'mattermost-default',
      nativeContextId: '6he4u1qdoido8yu5onbczzzupe',
    })
    const target = groupTarget(scoped)
    expect(target.contextId).toBe('6he4u1qdoido8yu5onbczzzupe')
    expect(target.storageContextId).toBe(scoped)
    expect(target.contextType).toBe('group')
  })

  test('groupTarget leaves a legacy native group id unchanged', () => {
    const target = groupTarget('123456')
    expect(target.contextId).toBe('123456')
    expect(target.storageContextId).toBe('123456')
  })

  test('empty subscriber lists return zero counts and still call markBroadcast', async () => {
    let broadcastMarked = false
    const result = await broadcastAnnouncement(
      chat,
      '9.9.9',
      'body',
      makeDeps({
        listSubscribedUsers: () => [],
        listSubscribedGroups: () => [],
        markBroadcast: () => {
          broadcastMarked = true
        },
      }),
    )
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0 })
    expect(broadcastMarked).toBe(true)
  })
})

describe('defaultDeps send + record wiring', () => {
  const spies: SpyInstance[] = []

  const track = <T extends SpyInstance>(spy: T): T => {
    spies.push(spy)
    return spy
  }

  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  test('sendDm records the delivered body into the recipient DM history on success', async () => {
    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )
    const dmChat = createMockChat({ sendMessage: () => Promise.resolve(true) })

    const ok = await defaultBroadcastDepsForTest.sendDm(dmChat, 'inst', 'u1', 'Release notes')

    expect(ok).toBe(true)
    expect(recordCalls).toEqual([
      [toScopedContextId({ platformInstanceId: 'inst', nativeContextId: 'u1' }), 'Release notes'],
    ])
  })

  test('sendDm does not record when delivery fails', async () => {
    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )
    const dmChat = createMockChat({ sendMessage: () => Promise.resolve(false) })

    const ok = await defaultBroadcastDepsForTest.sendDm(dmChat, 'inst', 'u1', 'Release notes')

    expect(ok).toBe(false)
    expect(recordCalls).toEqual([])
  })

  test('sendGroup records the delivered body into the scoped group history on success', async () => {
    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )
    track(spyOn(proactiveDeliveryModule, 'sendProactiveMessage').mockImplementation(() => Promise.resolve(true)))

    const ok = await defaultBroadcastDepsForTest.sendGroup(chat, 'pi:inst:ctx:grp', 'Release notes')

    expect(ok).toBe(true)
    expect(recordCalls).toEqual([['pi:inst:ctx:grp', 'Release notes']])
  })

  test('sendGroup does not record when delivery fails', async () => {
    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )
    track(spyOn(proactiveDeliveryModule, 'sendProactiveMessage').mockImplementation(() => Promise.resolve(false)))

    const ok = await defaultBroadcastDepsForTest.sendGroup(chat, 'pi:inst:ctx:grp', 'Release notes')

    expect(ok).toBe(false)
    expect(recordCalls).toEqual([])
  })
})
