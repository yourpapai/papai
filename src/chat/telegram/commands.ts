// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listCommandCatalogEntries } from '../../commands/catalog.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:telegram:commands' })

type TelegramCommandScope = 'dm-user' | 'dm-admin' | 'group-user' | 'group-admin'

type TelegramCommandOptions =
  | { readonly scope: { readonly type: 'all_private_chats' } }
  | { readonly scope: { readonly type: 'chat'; readonly chat_id: number } }
  | { readonly scope: { readonly type: 'all_group_chats' } }
  | { readonly scope: { readonly type: 'all_chat_administrators' } }

type TelegramPublishedCommand = {
  readonly command: string
  readonly description: string
}

type TelegramCommandBot = {
  readonly api: {
    setMyCommands: (commands: readonly TelegramPublishedCommand[], options: TelegramCommandOptions) => Promise<unknown>
    deleteMyCommands: (options: TelegramCommandOptions) => Promise<unknown>
  }
}

async function publishScopeCommands(
  bot: TelegramCommandBot,
  commands: readonly TelegramPublishedCommand[],
  options: TelegramCommandOptions,
): Promise<void> {
  try {
    await bot.api.setMyCommands(commands, options)
  } catch (error) {
    log.error({ err: error, scope: options.scope.type }, 'Telegram command publication failed')
    throw error
  }
}

async function clearScopeCommands(bot: TelegramCommandBot, options: TelegramCommandOptions): Promise<void> {
  try {
    await bot.api.deleteMyCommands(options)
  } catch (error) {
    log.error({ err: error, scope: options.scope.type }, 'Telegram command publication failed')
    throw error
  }
}

function commandsForScope(scope: TelegramCommandScope): readonly TelegramPublishedCommand[] {
  return listCommandCatalogEntries()
    .filter((entry) => {
      switch (scope) {
        case 'dm-user':
          return entry.telegram.publishInDmUser
        case 'dm-admin':
          return entry.telegram.publishInDmAdmin
        case 'group-user':
          return entry.telegram.publishInGroupUser
        case 'group-admin':
          return entry.telegram.publishInGroupAdmin
        default:
          return false
      }
    })
    .map((entry) => ({ command: entry.name, description: entry.description }))
}

function parseAdminChatId(adminUserId: string): number {
  if (!/^\d+$/u.test(adminUserId)) {
    throw new Error(`Telegram admin command scope requires a numeric ADMIN_USER_ID, got: ${adminUserId}`)
  }

  return Number.parseInt(adminUserId, 10)
}

export async function registerTelegramCommands(bot: TelegramCommandBot, adminUserId: string): Promise<void> {
  const adminChatId = parseAdminChatId(adminUserId)

  await publishScopeCommands(bot, commandsForScope('dm-user'), { scope: { type: 'all_private_chats' } })
  await publishScopeCommands(bot, commandsForScope('dm-admin'), { scope: { type: 'chat', chat_id: adminChatId } })
  await publishScopeCommands(bot, commandsForScope('group-user'), { scope: { type: 'all_group_chats' } })

  const groupAdminCommands = commandsForScope('group-admin')
  if (groupAdminCommands.length > 0) {
    await publishScopeCommands(bot, groupAdminCommands, { scope: { type: 'all_chat_administrators' } })
  } else {
    await clearScopeCommands(bot, { scope: { type: 'all_chat_administrators' } })
  }

  log.info({ adminUserId }, 'Telegram command menu registered')
}
