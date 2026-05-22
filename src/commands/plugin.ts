// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, ReplyFn } from '../chat/types.js'
import { logger } from '../logger.js'
import { pluginRegistry, setPluginEnabledForContext } from '../plugins/registry.js'
import {
  getAllPluginAdminStates,
  getEnabledPluginsForContext,
  getPluginAdminState,
  getRecentRuntimeEvents,
} from '../plugins/store.js'
import type { PluginState } from '../plugins/types.js'

const log = logger.child({ scope: 'commands:plugin' })

function formatState(state: PluginState): string {
  const stateEmoji: Record<PluginState, string> = {
    discovered: '🔍',
    approved: '✅',
    rejected: '❌',
    incompatible: '⚠️',
    config_missing: '⚙️',
    active: '🟢',
    error: '🔴',
  }
  return `${stateEmoji[state] ?? '❓'} ${state}`
}

function buildPluginListMessage(): string {
  const allStates = getAllPluginAdminStates()
  const entries = pluginRegistry.getAllEntries()

  if (allStates.length === 0 && entries.length === 0) {
    return 'No plugins discovered. Place plugin directories under the `plugins/` folder.'
  }

  const lines: string[] = ['🧩 **Plugins**\n']
  for (const entry of entries) {
    const { manifest } = entry.discoveredPlugin
    lines.push(`**${manifest.name}** (\`${manifest.id}\`) v${manifest.version}`)
    lines.push(`  State: ${formatState(entry.state)}`)
    if (entry.compatibilityReason !== undefined) lines.push(`  Note: ${entry.compatibilityReason}`)
    lines.push(`  ${manifest.description}`)
    lines.push('')
  }

  if (lines.length === 1) lines.push('No plugins registered in registry.')
  lines.push('Usage: /plugin list | info <id> | approve <id> | reject <id> | enable <id> [ctx] | disable <id> [ctx]')
  return lines.join('\n')
}

function buildPluginInfoMessage(pluginId: string): string {
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined) {
    const dbState = getPluginAdminState(pluginId)
    if (dbState === undefined) return `Plugin \`${pluginId}\` not found.`
    return `Plugin \`${pluginId}\` known to DB but not in registry. State: ${dbState.state}`
  }

  const { manifest } = entry.discoveredPlugin
  const lines = [
    `🧩 **${manifest.name}** (\`${manifest.id}\`) v${manifest.version}`,
    `State: ${formatState(entry.state)}`,
    manifest.description,
    `Permissions: ${manifest.permissions.length > 0 ? manifest.permissions.join(', ') : 'none'}`,
    `Tools: ${manifest.contributes.tools.length > 0 ? manifest.contributes.tools.join(', ') : 'none'}`,
  ]
  if (entry.compatibilityReason !== undefined) lines.push(`Note: ${entry.compatibilityReason}`)
  const recentEvents = getRecentRuntimeEvents(pluginId, 3)
  if (recentEvents.length > 0) {
    lines.push('Recent events:')
    for (const event of recentEvents) {
      const detail = event.message === null ? '' : ` — ${event.message}`
      lines.push(`- ${event.occurredAt}: ${event.eventType}${detail}`)
    }
  }
  return lines.join('\n')
}

async function handleApprove(pluginId: string, adminUserId: string, reply: ReplyFn): Promise<void> {
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined) {
    await reply.text(`Plugin \`${pluginId}\` not found. Run /plugin list to see available plugins.`)
    return
  }
  const success = pluginRegistry.approve(pluginId, adminUserId, entry.discoveredPlugin.manifestHash)
  if (success) {
    log.info({ pluginId, adminUserId }, 'Plugin approved via command')
    await reply.text(`✅ Plugin \`${pluginId}\` approved. It will be active on next startup.`)
  } else {
    await reply.text(`Failed to approve \`${pluginId}\`.`)
  }
}

async function handleEnable(
  pluginId: string,
  targetContextId: string,
  adminUserId: string,
  reply: ReplyFn,
): Promise<void> {
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined) {
    await reply.text(`Plugin \`${pluginId}\` not found.`)
    return
  }
  if (entry.state !== 'active') {
    await reply.text(`Plugin \`${pluginId}\` is not active (state: ${entry.state}). It must be active before enabling.`)
    return
  }
  setPluginEnabledForContext(pluginId, targetContextId, true)
  const enabledPluginCount = getEnabledPluginsForContext(targetContextId).length
  log.info({ pluginId, targetContextId, adminUserId, enabledPluginCount }, 'Plugin enabled for context via command')
  await reply.text(`🟢 Plugin \`${pluginId}\` enabled for context \`${targetContextId}\`.`)
}

async function handleReject(pluginId: string, adminUserId: string, reply: ReplyFn): Promise<void> {
  const ok = pluginRegistry.reject(pluginId)
  if (ok) {
    log.info({ pluginId, adminUserId }, 'Plugin rejected via command')
  }
  await reply.text(ok ? `❌ Plugin \`${pluginId}\` rejected.` : `Plugin \`${pluginId}\` not found.`)
}

const PLUGIN_USAGE =
  'Usage: /plugin list | info <id> | approve <id> | reject <id> | enable <id> [ctx] | disable <id> [ctx]'

async function handleDisable(
  pluginId: string,
  targetContextId: string,
  adminUserId: string,
  reply: ReplyFn,
): Promise<void> {
  setPluginEnabledForContext(pluginId, targetContextId, false)
  const enabledPluginCount = getEnabledPluginsForContext(targetContextId).length
  log.info({ pluginId, targetContextId, adminUserId, enabledPluginCount }, 'Plugin disabled for context via command')
  await reply.text(`⭕ Plugin \`${pluginId}\` disabled.`)
}

async function runPluginSubcommand(subcommand: string, args: string[], userId: string, reply: ReplyFn): Promise<void> {
  if (subcommand === 'list') {
    await reply.text(buildPluginListMessage())
  } else if (subcommand === 'info') {
    const id = args[1]
    await reply.text(id === undefined ? 'Usage: /plugin info <plugin-id>' : buildPluginInfoMessage(id))
  } else if (subcommand === 'approve') {
    const id = args[1]
    if (id === undefined) {
      await reply.text('Usage: /plugin approve <plugin-id>')
      return
    }
    await handleApprove(id, userId, reply)
  } else if (subcommand === 'reject') {
    const id = args[1]
    if (id === undefined) {
      await reply.text('Usage: /plugin reject <plugin-id>')
      return
    }
    await handleReject(id, userId, reply)
  } else if (subcommand === 'enable') {
    const id = args[1]
    if (id === undefined) {
      await reply.text('Usage: /plugin enable <plugin-id> [context-id]')
      return
    }
    await handleEnable(id, args[2] ?? userId, userId, reply)
  } else if (subcommand === 'disable') {
    const id = args[1]
    if (id === undefined) {
      await reply.text('Usage: /plugin disable <plugin-id> [context-id]')
      return
    }
    await handleDisable(id, args[2] ?? userId, userId, reply)
  } else {
    await reply.text(`Unknown plugin subcommand. ${PLUGIN_USAGE}`)
  }
}

export function registerPluginCommand(chat: ChatProvider, adminUserId: string): void {
  chat.registerCommand('plugin', async (msg, reply, auth) => {
    if (!auth.allowed) return
    if (!auth.isBotAdmin && msg.user.id !== adminUserId) {
      await reply.text('Only the bot admin can manage plugins.')
      return
    }
    if (msg.contextType === 'group') {
      await reply.text('Plugin management is only available in direct messages.')
      return
    }
    const args = (msg.commandMatch ?? '')
      .trim()
      .split(/\s+/u)
      .filter((s) => s !== '')
    const subcommand = args[0] ?? 'list'
    log.debug({ userId: msg.user.id, subcommand, args }, '/plugin command called')
    await runPluginSubcommand(subcommand, args, msg.user.id, reply)
  })
}
