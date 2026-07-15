// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { DeferredDeliveryTarget } from '../types.js'
import type { DiscordClientLike, ReactableChannel } from './client-factory.js'

const log = logger.child({ scope: 'chat:discord:reactions' })

function isReactableChannel(value: unknown): value is ReactableChannel {
  if (typeof value !== 'object' || value === null) return false
  const messages = (value as Partial<ReactableChannel>).messages
  if (typeof messages !== 'object' || messages === null) return false
  const m = messages as Partial<ReactableChannel['messages']>
  return typeof m.react === 'function' && typeof m.fetch === 'function'
}

async function resolveReactableChannel(
  client: DiscordClientLike | null,
  target: DeferredDeliveryTarget,
): Promise<ReactableChannel | null> {
  if (client === null) return null
  const fetchChannel = client.channels?.fetch
  if (fetchChannel === undefined) return null
  const channel = await fetchChannel.call(client.channels, target.contextId)
  return isReactableChannel(channel) ? channel : null
}

/** Best-effort: remove `previousEmoji` (if given) then add `emoji` (if given). Never throws. */
async function applyDiscordReaction(
  channel: ReactableChannel,
  messageId: string,
  emoji: string | null,
  previousEmoji: string | null | undefined,
): Promise<void> {
  if (previousEmoji !== undefined && previousEmoji !== null) {
    const msg = await channel.messages.fetch(messageId)
    await msg.reactions.resolve(previousEmoji)?.users.remove()
  }
  if (emoji !== null) {
    await channel.messages.react(messageId, emoji)
  }
}

/**
 * Sets or clears a Discord reaction on an existing message. Resolves the channel from `target`
 * the same way `sendMessage` does, then removes `previousEmoji` and/or adds `emoji`.
 * Best-effort: never throws, returns false on any failure.
 */
export async function setDiscordReaction(
  client: DiscordClientLike | null,
  target: DeferredDeliveryTarget,
  messageId: string,
  emoji: string | null,
  previousEmoji: string | null | undefined,
): Promise<boolean> {
  try {
    const channel = await resolveReactableChannel(client, target)
    if (channel === null) return false
    await applyDiscordReaction(channel, messageId, emoji, previousEmoji)
    return true
  } catch (error: unknown) {
    log.warn({ messageId, error: error instanceof Error ? error.message : String(error) }, 'Discord setReaction failed')
    return false
  }
}
