// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { moduleCommandRegistry } from '../ports/module-contributions.js'

const sanitizeModuleId = (moduleId: string): string => moduleId.replace(/-/gu, '_')

/** Namespace a module command: `module_<sanitized-id>_<command>` (parallel to plugin commands). */
export function namespacedModuleCommandName(moduleId: string, commandName: string): string {
  return `module_${sanitizeModuleId(moduleId)}_${commandName}`
}

/**
 * Register every trusted-module command with the chat provider. Unlike plugin commands there is no
 * per-context eligibility re-check — a trusted module is always active.
 */
export function registerModuleCommands(chat: ChatProvider): void {
  for (const { moduleId, command } of moduleCommandRegistry.list()) {
    const name = namespacedModuleCommandName(moduleId, command.name)
    const handler: CommandHandler = async (message, reply, auth) => {
      await Promise.resolve(command.execute(message, reply, auth))
    }
    chat.registerCommand(name, handler)
  }
}
