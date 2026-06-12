// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { sanitizePluginId } from './contribution-names.js'
import { contributionRegistry } from './contributions.js'
import { formatPluginEligibilityMessage } from './eligibility-message.js'
import { getPluginContextEligibility } from './registry.js'

export function namespacedCommandName(pluginId: string, commandName: string): string {
  return `plugin_${sanitizePluginId(pluginId)}_${commandName}`
}

export function registerPluginCommands(chat: ChatProvider): void {
  contributionRegistry.getAllContributions().forEach((contributions) => {
    contributions.commands.forEach((command) => {
      const commandName = namespacedCommandName(contributions.pluginId, command.name)
      const handler: CommandHandler = async (message, reply, auth) => {
        const eligibility = getPluginContextEligibility(contributions.pluginId, auth.storageContextId)
        if (!eligibility.eligible) {
          await reply.text(formatPluginEligibilityMessage(contributions.pluginId, eligibility))
          return
        }
        await Promise.resolve(command.execute(message, reply, auth))
      }
      chat.registerCommand(commandName, handler)
    })
  })
}
