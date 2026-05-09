import {
  findGroupUserObservation,
  findKnownGroupContext,
  upsertGroupUserObservation,
} from '../../group-settings/registry.js'
import { logger } from '../../logger.js'
import type { ChatProvider } from '../types.js'

const TELEGRAM_PROVIDER = 'telegram'

const log = logger.child({ scope: 'chat:telegram:group-display-resolution' })

const isTelegramChat = (chat: Pick<ChatProvider, 'name'>): boolean => chat.name === TELEGRAM_PROVIDER

const resolveLiveGroupLabel = async (chat: ChatProvider, groupId: string): Promise<string | null> => {
  const lookup = chat.resolveGroupLabel
  if (lookup === undefined) {
    return null
  }

  try {
    return await lookup(groupId)
  } catch (error: unknown) {
    log.warn(
      { groupId, error: error instanceof Error ? error.message : String(error) },
      'Telegram group label lookup failed',
    )
    return null
  }
}

const resolveLiveUserLabel = async (chat: ChatProvider, contextId: string, userId: string): Promise<string | null> => {
  const lookup = chat.resolveUserLabel
  if (lookup === undefined) {
    return null
  }

  try {
    return await lookup(userId, { contextId, contextType: 'group' })
  } catch (error: unknown) {
    log.warn(
      { contextId, userId, error: error instanceof Error ? error.message : String(error) },
      'Telegram user label lookup failed',
    )
    return null
  }
}

export async function resolveTelegramGroupDisplayLabel(chat: ChatProvider, groupId: string): Promise<string | null> {
  if (!isTelegramChat(chat)) {
    return null
  }

  const liveLabel = await resolveLiveGroupLabel(chat, groupId)
  if (liveLabel !== null) {
    return liveLabel
  }

  return findKnownGroupContext(TELEGRAM_PROVIDER, groupId)?.displayName ?? null
}

export async function resolveTelegramUserDisplayLabel(
  chat: ChatProvider,
  contextId: string,
  userId: string,
): Promise<string | null> {
  if (!isTelegramChat(chat)) {
    return null
  }

  const liveLabel = await resolveLiveUserLabel(chat, contextId, userId)
  if (liveLabel !== null) {
    upsertGroupUserObservation({
      provider: TELEGRAM_PROVIDER,
      contextId,
      userId,
      username: null,
      displayLabel: liveLabel,
    })
    return liveLabel
  }

  return findGroupUserObservation(TELEGRAM_PROVIDER, contextId, userId)?.displayLabel ?? null
}
