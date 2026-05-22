// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Bot } from 'grammy'

import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:telegram:commands' })

const userCommands = [
  { command: 'help', description: 'Show available commands' },
  { command: 'setup', description: 'Interactive configuration wizard' },
  { command: 'config', description: 'View current configuration' },
  { command: 'clear', description: 'Clear conversation history and memory' },
  { command: 'context', description: 'Show current LLM context usage' },
] as const

const adminCommands = [
  ...userCommands,
  { command: 'user', description: 'Manage users — /user add|remove <id|@username>' },
  { command: 'users', description: 'List authorized users' },
] as const

export async function registerTelegramCommands(bot: Bot, adminUserId: string): Promise<void> {
  await bot.api.setMyCommands(userCommands, { scope: { type: 'all_private_chats' } })
  await bot.api.setMyCommands(adminCommands, { scope: { type: 'chat', chat_id: parseInt(adminUserId, 10) } })
  log.info({ adminUserId }, 'Telegram command menu registered')
}
