// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  resolveTelegramGroupDisplayLabel,
  resolveTelegramUserDisplayLabel,
} from './telegram/group-display-resolution.js'
import type { ChatProvider, ResolveUserContext } from './types.js'

const TELEGRAM_PROVIDER = 'telegram'

const isTelegramChat = (chat: Pick<ChatProvider, 'name'>): boolean => chat.name === TELEGRAM_PROVIDER

export const resolveChatGroupDisplayLabel = (chat: ChatProvider, groupId: string): Promise<string | null> => {
  if (isTelegramChat(chat)) {
    return resolveTelegramGroupDisplayLabel(chat, groupId)
  }

  const lookup = chat.resolveGroupLabel
  if (lookup === undefined) {
    return Promise.resolve(null)
  }

  return lookup(groupId)
}

export const resolveChatUserDisplayLabel = (
  chat: ChatProvider,
  userId: string,
  context: ResolveUserContext,
): Promise<string | null> => {
  if (isTelegramChat(chat) && context.contextType === 'group') {
    return resolveTelegramUserDisplayLabel(chat, context.contextId, userId)
  }

  const lookup = chat.resolveUserLabel
  if (lookup === undefined) {
    return Promise.resolve(null)
  }

  return lookup(userId, context)
}
