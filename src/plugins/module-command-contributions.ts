// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { moduleCommandRegistry } from '../ports/module-contributions.js'
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'

const sanitizeModuleId = (moduleId: string): string => moduleId.replace(/-/gu, '_')

/** Namespace a module command: `module_<sanitized-id>_<command>` (parallel to plugin commands). */
export function namespacedModuleCommandName(moduleId: string, commandName: string): string {
  return `module_${sanitizeModuleId(moduleId)}_${commandName}`
}

/**
 * Register every trusted-module command with the chat provider. Eligibility is re-checked per
 * invocation against `moduleEligibilityRegistry`: a module with no registered predicate is always
 * eligible, but a registered predicate can gate execution per `storageContextId`.
 */
export function registerModuleCommands(chat: ChatProvider): void {
  for (const { moduleId, command } of moduleCommandRegistry.list()) {
    const name = namespacedModuleCommandName(moduleId, command.name)
    const handler: CommandHandler = async (message, reply, auth) => {
      if (!moduleEligibilityRegistry.isEligible(moduleId, auth.storageContextId)) {
        await reply.text('This command is not available in this context.')
        return
      }
      await Promise.resolve(command.execute(message, reply, auth))
    }
    chat.registerCommand(name, handler)
  }
}
