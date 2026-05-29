// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IncomingInteraction } from '../types.js'

const CHANNEL_TYPE_DM = 1

export type DiscordInteractionContext = {
  user: { id: string; username: string }
  customId: string
  channelId: string
  channel: { type: number } | null
  message: { id: string }
}

export function buildDiscordInteraction(
  ctx: DiscordInteractionContext,
  isAdmin: boolean,
  platformInstanceId: string,
): IncomingInteraction | null {
  const callbackData = ctx.customId
  if (callbackData === '') return null

  const contextType = ctx.channel?.type === CHANNEL_TYPE_DM ? 'dm' : 'group'
  const contextId = contextType === 'dm' ? ctx.user.id : ctx.channelId

  return {
    kind: 'button',
    user: {
      id: ctx.user.id,
      username: ctx.user.username.length > 0 ? ctx.user.username : null,
      isAdmin,
    },
    contextId,
    contextType,
    platformInstanceId,
    storageContextId: contextId,
    callbackData,
    messageId: ctx.message.id,
  }
}
