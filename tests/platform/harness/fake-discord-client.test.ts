// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createFakeDiscordClient } from './fake-discord-client.js'

const recordMessageId = (message: unknown, received: string[]): void => {
  if (typeof message === 'object' && message !== null && 'id' in message && typeof message.id === 'string') {
    received.push(message.id)
  }
}

const recordInteractionCustomId = (interaction: unknown, received: string[]): void => {
  if (
    typeof interaction === 'object' &&
    interaction !== null &&
    'customId' in interaction &&
    typeof interaction.customId === 'string'
  ) {
    received.push(interaction.customId)
  }
}

describe('fake Discord client', () => {
  test('emits ready once and records ordered channel sends', async () => {
    const fake = createFakeDiscordClient({ botId: 'discord-bot', username: 'papai' })

    const started = fake.login('discord-test-token')
    fake.emitReady()
    await started
    fake.emitReady()
    await fake.channel.send({ content: 'first' })
    await fake.channel.send({ content: 'second' })

    expect(fake.sentContents()).toEqual(['first', 'second'])

    await fake.client.destroy()
    fake.assertClean()
  })

  test('emits messages and button interactions through the registered listeners', async () => {
    const fake = createFakeDiscordClient({ botId: 'discord-bot', username: 'papai' })
    const received: string[] = []
    fake.client.on('messageCreate', (message) => recordMessageId(message, received))
    fake.client.on('interactionCreate', (interaction) => recordInteractionCustomId(interaction, received))

    fake.emitMessage({
      id: 'message-1',
      author: { id: 'user-1', username: 'Ada', bot: false },
      content: 'hello',
      channel: fake.channel,
      mentions: { has: () => false },
      reference: null,
      type: 0,
    })
    await fake.emitButton({ customId: 'approve' })

    expect(received).toEqual(['message-1', 'approve'])
    expect(fake.deferUpdateCalls()).toEqual([undefined])

    await fake.client.destroy()
    fake.assertClean()
  })

  test('records channel mutations and rejects a configured interaction response', async () => {
    const fake = createFakeDiscordClient({
      botId: 'discord-bot',
      username: 'papai',
      rejectInteractionResponse: 'followUp',
    })

    const sent = await fake.channel.send({ content: 'draft' })
    await sent.edit({ content: 'edited' })
    await sent.delete()
    await fake.channel.sendTyping()

    const interaction = fake.button({ customId: 'retry' })
    await interaction.deferUpdate()
    await expect(interaction.followUp({ content: 'nope' })).rejects.toThrow('configured followUp rejection')

    expect(fake.channelCalls()).toEqual([
      { method: 'send', content: 'draft' },
      { method: 'edit', content: 'edited' },
      { method: 'delete', messageId: 'sent-1' },
      { method: 'sendTyping' },
    ])
    expect(fake.followUpCalls()).toEqual([{ content: 'nope' }])

    await fake.client.destroy()
    fake.assertClean()
  })

  test('records a rejected defer attempt and waits for response settlement before cleanup', async () => {
    const fake = createFakeDiscordClient({
      botId: 'discord-bot',
      username: 'papai',
      rejectInteractionResponse: 'deferUpdate',
    })

    const deferred = fake.button().deferUpdate()
    expect(fake.deferUpdateCalls()).toEqual([undefined])

    const destroyed = fake.client.destroy()
    expect(() => fake.assertClean()).toThrow('pending interaction response')
    await expect(deferred).rejects.toThrow('configured deferUpdate rejection')
    await destroyed
    fake.assertClean()
  })
})
