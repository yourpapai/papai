// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { KonturTalkChatProvider } from '../../../src/chat/kontur-talk/index.js'
import type { ReplyFn } from '../../../src/chat/types.js'
import { mockLogger } from '../../utils/test-helpers.js'
import { startFakeKonturTalkServer, type FakeKonturTalkServer } from '../harness/fake-kontur-talk-server.js'

const PLATFORM_INSTANCE_ID = 'kontur-platform'
const JWT_TOKEN = 'header.eyJzdWIiOiJrb250dXItYm90In0.signature'
const ROOM_ID = '!room:example'
const DEFAULT_THREAD_ID = '$thread-default'
const title = (scenarioId: string): string => scenarioId

function createProvider(fake: FakeKonturTalkServer): KonturTalkChatProvider {
  return new KonturTalkChatProvider({
    jwtToken: JWT_TOKEN,
    platformInstanceId: PLATFORM_INSTANCE_ID,
    apiBaseUrl: fake.baseUrl,
  })
}

describe('T3 Kontur Talk — reply formatting', () => {
  test(title('SCN-interaction-kontur-reply-formatting'), async () => {
    mockLogger()
    const fake = await startFakeKonturTalkServer()
    const provider = createProvider(fake)
    let reply: ReplyFn | undefined
    let pollSettled: Promise<void> = Promise.resolve()
    let resolveHandled: () => void = () => {}
    const handled = new Promise<void>((resolve) => {
      resolveHandled = resolve
    })

    provider.onMessage(async (_message, receivedReply) => {
      await receivedReply.text('plain reply')
      await receivedReply.formatted('**formatted reply**', { threadId: '$thread-override' })
      reply = receivedReply
      resolveHandled()
    })
    fake.enqueueUpdates([
      {
        event_id: '$event-1',
        user_id: 'member-1',
        room_id: ROOM_ID,
        room_is_direct: false,
        type: 'm.room.message',
        timestamp: 0,
        message_type: 'm.text',
        body: 'reply please',
        thread_id: DEFAULT_THREAD_ID,
      },
    ])

    try {
      await provider.start()
      await handled
      await fake.whenPollPending()
      pollSettled = fake.whenPollSettled()

      expect(fake.requests().filter(({ method }) => method === 'POST')).toEqual([
        {
          method: 'POST',
          path: `/bot/${JWT_TOKEN}/send_message`,
          body: {
            room_id: ROOM_ID,
            message: 'plain reply',
            format: 'plain',
            thread_id: DEFAULT_THREAD_ID,
            mentions: [],
          },
        },
        {
          method: 'POST',
          path: `/bot/${JWT_TOKEN}/send_message`,
          body: {
            room_id: ROOM_ID,
            message: '**formatted reply**',
            format: 'markdown',
            thread_id: '$thread-override',
            mentions: [],
          },
        },
      ])
      await expect(reply!.buttons('unsupported', { buttons: [] })).rejects.toThrow(/does not support/iu)
      expect(fake.sentRequests()).toHaveLength(2)
    } finally {
      await provider.stop()
      await fake.stop()
      await pollSettled
      fake.assertClean()
    }
  })
})
