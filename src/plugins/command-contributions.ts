// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { sanitizePluginId } from './contribution-names.js'
import { contributionRegistry } from './contributions.js'

export function namespacedCommandName(pluginId: string, commandName: string): string {
  return `plugin_${sanitizePluginId(pluginId)}_${commandName}`
}

export function registerPluginCommands(chat: ChatProvider): void {
  contributionRegistry.getAllContributions().forEach((contributions) => {
    contributions.commands.forEach((command) => {
      const commandName = namespacedCommandName(contributions.pluginId, command.name)
      const handler: CommandHandler = async (message, reply, auth) => {
        await Promise.resolve(command.execute(message, reply, auth))
      }
      chat.registerCommand(commandName, handler)
    })
  })
}
