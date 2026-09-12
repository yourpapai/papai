// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { DiscordChatProvider, type DispatchableMessage } from '../../../src/chat/discord/index.js'
import type { IncomingMessage } from '../../../src/chat/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { createFakeDiscordClient, type FakeDiscordClient } from '../harness/fake-discord-client.js'
import { PLATFORM_STORIES } from './catalog.js'

const PLATFORM_INSTANCE_ID = 'discord-platform'
const BOT_ID = 'discord-bot'
const CHANNEL_ID = 'channel-42'
const MEMBER_ID = 'member-7'
const BODY = 'ship the release notes'
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

/**
 * Fields whose values legitimately differ between a mention and a reply because
 * they encode the reference itself. Everything else is what "dispatched exactly
 * as an explicit mention" has to mean.
 */
type ReferenceDerived = 'messageId' | 'isMentioned' | 'isReplyToBot' | 'replyToMessageId' | 'replyContext'

const withoutReferenceFields = (message: IncomingMessage): Omit<IncomingMessage, ReferenceDerived> => {
  const {
    messageId: _id,
    isMentioned: _m,
    isReplyToBot: _r,
    replyToMessageId: _to,
    replyContext: _ctx,
    ...rest
  } = message
  return rest
}

function guildMessage(
  fake: FakeDiscordClient,
  input: { id: string; content: string; mentioned: boolean; replyTo?: string },
): DispatchableMessage {
  return {
    id: input.id,
    author: { id: MEMBER_ID, username: 'member-seven', bot: false },
    content: input.content,
    channel: fake.channel,
    mentions: { has: (id: string) => input.mentioned && id === BOT_ID },
    reference: input.replyTo === undefined ? null : { messageId: input.replyTo },
    // discord.js MessageType: Default = 0, Reply = 19.
    type: input.replyTo === undefined ? 0 : 19,
  }
}

describe('T3 Discord — reply-to-bot mention equivalence', () => {
  let fake: FakeDiscordClient
  let provider: DiscordChatProvider
  let dispatched: IncomingMessage[]

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    fake = createFakeDiscordClient({ botId: BOT_ID, username: 'papai' })
    fake.channel.id = CHANNEL_ID
    dispatched = []
    provider = new DiscordChatProvider({
      clientFactory: fake.factory,
      token: 'discord-test-token',
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })
    provider.onMessage((incoming) => {
      dispatched.push(incoming)
      return Promise.resolve()
    })
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

  test(title('SCN-interaction-discord-reply-mention'), async () => {
    fake.seedChannelMessage({ id: 'bot-parent', author: { id: BOT_ID, username: 'papai' }, content: 'earlier answer' })
    fake.seedChannelMessage({
      id: 'member-parent',
      author: { id: MEMBER_ID, username: 'member-seven' },
      content: 'unrelated',
    })

    fake.emitMessage(guildMessage(fake, { id: 'msg-mention', content: `<@${BOT_ID}> ${BODY}`, mentioned: true }))
    await fake.flush()
    fake.emitMessage(guildMessage(fake, { id: 'msg-reply', content: BODY, mentioned: false, replyTo: 'bot-parent' }))
    await fake.flush()
    // Control: the same unmentioned content replying to a human parent must stay silent.
    fake.emitMessage(
      guildMessage(fake, { id: 'msg-control', content: BODY, mentioned: false, replyTo: 'member-parent' }),
    )
    await fake.flush()

    expect(dispatched.map((message) => message.messageId)).toEqual(['msg-mention', 'msg-reply'])
    const [mention, reply] = dispatched
    expect(withoutReferenceFields(reply!)).toEqual(withoutReferenceFields(mention!))
    expect(reply).toMatchObject({ isMentioned: false, isReplyToBot: true, replyToMessageId: 'bot-parent' })
    // The parent came back through the fake's messages.fetch, not a stubbed helper.
    expect(reply!.replyContext).toMatchObject({ messageId: 'bot-parent', authorId: BOT_ID, text: 'earlier answer' })
  })
})
