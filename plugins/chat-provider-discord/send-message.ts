// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import { logger } from '../../src/logger.js'
import type { DiscordClientLike } from './client-factory.js'
import { chunkForDiscord } from './format-chunking.js'
import { discordTraits } from './metadata.js'

const log = logger.child({ scope: 'chat:discord' })

type SendableChannel = {
  send: (opts: { content: string }) => Promise<unknown>
  isSendable?: () => boolean
}

const isSendableChannel = (val: unknown): val is SendableChannel => {
  if (typeof val !== 'object' || val === null) return false
  const candidate = val as Partial<SendableChannel>
  if (typeof candidate.send !== 'function') return false
  if (candidate.isSendable === undefined) return true
  return candidate.isSendable()
}

const sendChunks = (chunks: readonly string[], send: (content: string) => Promise<unknown>): Promise<unknown> =>
  chunks.reduce<Promise<unknown>>((prev, chunk) => prev.then(() => send(chunk)), Promise.resolve(null))

export async function sendDiscordMessage(
  client: DiscordClientLike | null,
  target: DeferredDeliveryTarget,
  markdown: string,
): Promise<void> {
  if (client === null || client.users === undefined) {
    throw new Error('DiscordChatProvider.sendMessage called before start()')
  }
  if (target.contextType === 'dm') {
    const user = await client.users.fetch(target.contextId)
    const dm = await user.createDM()
    const chunks = chunkForDiscord(markdown, discordTraits.maxMessageLength!)
    await sendChunks(chunks, (content) => dm.send({ content }))
    log.info({ userId: target.contextId }, 'Discord DM sent')
    return
  }
  const mentions = target.audience === 'personal' ? target.mentionUserIds.map((id) => `<@${id}>`).join(' ') : ''
  const content = mentions === '' ? markdown : `${mentions} ${markdown}`
  const fetchChannel = client.channels?.fetch
  const channel = fetchChannel ? await fetchChannel.call(client.channels, target.contextId) : undefined
  if (!isSendableChannel(channel)) {
    log.warn({ channelId: target.contextId }, 'Discord channel not sendable')
    throw new Error('Discord channel not sendable')
  }
  const chunks = chunkForDiscord(content, discordTraits.maxMessageLength!)
  await sendChunks(chunks, (chunk) => channel.send({ content: chunk }))
  log.info({ channelId: target.contextId }, 'Discord channel message sent')
}
