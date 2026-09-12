// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { DiscordChatProvider, type DispatchableMessage } from '../../../src/chat/discord/index.js'
import type { ReplyFn } from '../../../src/chat/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { createFakeDiscordClient, type FakeDiscordClient } from '../harness/fake-discord-client.js'
import { PLATFORM_STORIES } from './catalog.js'

const PLATFORM_INSTANCE_ID = 'discord-platform'
const BOT_ID = 'discord-bot'
const CHANNEL_ID = 'channel-42'
const MEMBER_ID = 'member-7'
const FINAL_REPLY = 'Done.'
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

function mentionedMessage(fake: FakeDiscordClient): DispatchableMessage {
  return {
    id: 'message-status',
    author: { id: MEMBER_ID, username: 'member-seven', bot: false },
    content: `<@${BOT_ID}> do the work`,
    channel: fake.channel,
    mentions: { has: (id: string) => id === BOT_ID },
    reference: null,
    type: 0,
  }
}

/** One agent turn: open a live status, narrate it, dismiss it, then answer. */
const runStatusTurn = async (reply: ReplyFn): Promise<void> => {
  const status = await reply.createStatus?.('Thinking…')
  await status?.update('Reading the thread')
  await status?.update('Writing the answer')
  await status?.dismiss()
  await reply.text(FINAL_REPLY)
}

describe('T3 Discord — live status lifecycle', () => {
  let fake: FakeDiscordClient
  let provider: DiscordChatProvider

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    fake = createFakeDiscordClient({ botId: BOT_ID, username: 'papai' })
    fake.channel.id = CHANNEL_ID
    provider = new DiscordChatProvider({
      clientFactory: fake.factory,
      token: 'discord-test-token',
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })
    provider.onMessage((_incoming, reply) => runStatusTurn(reply))
    const started = provider.start()
    fake.emitReady()
    const flushed = fake.flush()
    await started
    await flushed
  })

  afterEach(async () => {
    await provider.stop()
    fake.assertClean()
  })

  test(title('SCN-interaction-discord-status-lifecycle'), async () => {
    fake.emitMessage(mentionedMessage(fake))
    await fake.flush()

    expect(fake.channelCalls()).toEqual([
      { method: 'send', content: 'Thinking…' },
      { method: 'edit', content: 'Reading the thread' },
      { method: 'edit', content: 'Writing the answer' },
      { method: 'delete', messageId: 'sent-1' },
      { method: 'send', content: FINAL_REPLY },
    ])
    // The delete is terminal: nothing edits the status message after it.
    const dismissedAt = fake.channelCalls().findIndex((call) => call.method === 'delete')
    expect(
      fake
        .channelCalls()
        .slice(dismissedAt + 1)
        .some((call) => call.method === 'edit'),
    ).toBe(false)
  })

  test(title('SCN-interaction-discord-status-send-failure'), async () => {
    fake.failNextChannelSend()

    fake.emitMessage(mentionedMessage(fake))
    await fake.flush()

    // No status message exists, so the handle is undefined and the turn skips
    // straight to its answer rather than editing or deleting a message that
    // was never created.
    expect(fake.channelCalls()).toEqual([{ method: 'send', content: FINAL_REPLY }])
  })
})
