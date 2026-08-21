// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { ButtonInteractionLike } from '../../../src/chat/discord/buttons.js'
import { DiscordChatProvider, type DispatchableMessage } from '../../../src/chat/discord/index.js'
import type { IncomingMessage } from '../../../src/chat/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { createFakeDiscordClient, type FakeDiscordClient } from '../harness/fake-discord-client.js'
import { PLATFORM_STORIES } from './catalog.js'

const PLATFORM_INSTANCE_ID = 'discord-platform'
const BOT_ID = 'discord-bot'
const CHANNEL_ID = 'channel-42'
const MEMBER_ID = 'member-7'
const MESSAGE_ID = 'message-9'
const CODE_LINE = 'const retained = true;\n'
const INTRO_PARAGRAPH = 'Intro paragraph stays before the code block.\n\n'
const CLOSING_PARAGRAPH = '\n\nClosing paragraph stays after the code block.'
const title = (scenarioId: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[scenarioId].title

const oversizedFencedMarkdown = `${INTRO_PARAGRAPH}\`\`\`typescript\n${CODE_LINE.repeat(87)}\`\`\`${CLOSING_PARAGRAPH}`
const expectedDiscordChunks = [
  INTRO_PARAGRAPH,
  `\`\`\`typescript\n${CODE_LINE.repeat(86)}\n\`\`\``,
  `\`\`\`typescript\n${CODE_LINE}\`\`\`${CLOSING_PARAGRAPH}`,
]

function hasBalancedFences(chunk: string): boolean {
  return (chunk.match(/```/gu)?.length ?? 0) % 2 === 0
}

function mentionedMessage(
  content: string,
  fake: FakeDiscordClient,
  options: { mentioned?: boolean; messageId?: string } = {},
): DispatchableMessage {
  return {
    id: options.messageId ?? MESSAGE_ID,
    author: { id: MEMBER_ID, username: 'member-seven', bot: false },
    content,
    channel: fake.channel,
    mentions: { has: (id: string) => id === BOT_ID && options.mentioned !== false },
    reference: null,
    type: 0,
  }
}

function buttonInteraction(): Partial<ButtonInteractionLike> {
  return {
    user: { id: MEMBER_ID, username: 'member-seven' },
    customId: 'save',
    channelId: CHANNEL_ID,
    message: { id: MESSAGE_ID },
  }
}

function createProvider(fake: FakeDiscordClient): DiscordChatProvider {
  return new DiscordChatProvider({
    clientFactory: fake.factory,
    token: 'discord-test-token',
    platformInstanceId: PLATFORM_INSTANCE_ID,
  })
}

async function startProvider(fake: FakeDiscordClient, provider: DiscordChatProvider): Promise<void> {
  const started = provider.start()
  fake.emitReady()
  const flushed = fake.flush()
  await started
  await flushed
}

async function replyToMentionedMessage(
  provider: DiscordChatProvider,
  fake: FakeDiscordClient,
  markdown: string,
): Promise<void> {
  provider.onMessage((_incoming, reply) => reply.formatted(markdown))
  fake.emitMessage(mentionedMessage('@papai format this', fake))
  await fake.flush()
}

describe('T3 Discord — interaction adapters', () => {
  let fake: FakeDiscordClient
  let provider: DiscordChatProvider

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    fake = createFakeDiscordClient({
      botId: BOT_ID,
      username: 'papai',
      rejectInteractionResponse: 'deferUpdate',
    })
    fake.channel.id = CHANNEL_ID
    provider = createProvider(fake)
  })

  afterEach(async () => {
    await provider.stop()
    fake.assertClean()
  })

  test(title('SCN-interaction-discord-command-routing'), async () => {
    const received: IncomingMessage[] = []
    let ordinaryMessages = 0
    provider.registerCommand('help', (message) => {
      received.push(message)
      return Promise.resolve()
    })
    provider.onMessage(() => {
      ordinaryMessages += 1
      return Promise.resolve()
    })

    await startProvider(fake, provider)
    fake.emitMessage(mentionedMessage('/help retained-args', fake))
    await fake.flush()
    fake.emitMessage(
      mentionedMessage('/help should-not-route', fake, {
        mentioned: false,
        messageId: 'message-control',
      }),
    )
    await fake.flush()

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      commandMatch: 'retained-args',
      contextId: CHANNEL_ID,
      contextType: 'group',
      isMentioned: true,
      messageId: MESSAGE_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
      text: '/help retained-args',
      user: {
        id: MEMBER_ID,
        username: 'member-seven',
      },
    })
    expect(ordinaryMessages).toBe(0)
  })

  test(title('SCN-interaction-discord-format-chunking'), async () => {
    await startProvider(fake, provider)
    await replyToMentionedMessage(provider, fake, oversizedFencedMarkdown)

    const chunks = fake.sentContents()
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true)
    expect(chunks).toEqual(expectedDiscordChunks)
    expect(chunks.every(hasBalancedFences)).toBe(true)
  })

  test(title('SCN-interaction-discord-response-lifecycle'), async () => {
    const lifecycle: string[] = []
    provider.onInteraction(async (_incoming, reply) => {
      lifecycle.push('route')
      await reply.ephemeralConfirm?.('saved')
    })

    await startProvider(fake, provider)
    const trackedButton = fake.button(buttonInteraction())
    fake.emitButton({
      ...buttonInteraction(),
      deferUpdate: async () => {
        lifecycle.push('acknowledge')
        await trackedButton.deferUpdate()
      },
      followUp: (payload) => {
        lifecycle.push('outcome')
        return trackedButton.followUp(payload)
      },
    })
    await fake.flush()

    expect(lifecycle).toEqual(['acknowledge', 'route', 'outcome'])
    expect(fake.deferUpdateCalls()).toHaveLength(1)
    expect(fake.followUpCalls()).toEqual([{ content: 'saved', flags: 64 }])
  })
})
