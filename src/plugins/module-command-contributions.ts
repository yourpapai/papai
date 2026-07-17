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
  const entries = moduleCommandRegistry.list()
  const registeredNames = new Set<string>()
  for (const { moduleId, command } of entries) {
    for (const name of [namespacedModuleCommandName(moduleId, command.name), command.legacyWireName]) {
      if (name === undefined) continue
      if (registeredNames.has(name)) throw new Error(`Duplicate module command wire name '${name}'`)
      registeredNames.add(name)
    }
  }
  for (const { moduleId, command } of entries) {
    const names = [namespacedModuleCommandName(moduleId, command.name), command.legacyWireName].filter(
      (name): name is string => name !== undefined,
    )
    const handler: CommandHandler = async (message, reply, auth) => {
      if (!moduleEligibilityRegistry.isEligible(moduleId, auth.storageContextId)) {
        await reply.text(command.ineligibleMessage ?? 'This command is not available in this context.')
        return
      }
      await Promise.resolve(command.execute(message, reply, auth))
    }
    for (const name of names) chat.registerCommand(name, handler)
  }
}
