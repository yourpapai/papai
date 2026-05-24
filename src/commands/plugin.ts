// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, ReplyFn } from '../chat/types.js'
import { isAdmin, isSuperAdmin } from '../instances/admin-store.js'
import { logger } from '../logger.js'
import { pluginRegistry, setPluginEnabledForContext } from '../plugins/registry.js'
import {
  getAllPluginAdminStates,
  getEnabledPluginsForContext,
  getPluginAdminState,
  getRecentRuntimeEvents,
} from '../plugins/store.js'
import type { PluginState } from '../plugins/types.js'
import {
  canManageTargetContext,
  getTargetContextId,
  hasExplicitTargetContext,
  type PluginCommandContext,
  replyTargetAuthorizationFailure,
} from './plugin-auth.js'

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
  const emoji = stateEmoji[state]
  return `${emoji} ${state}`
}

const getCommandText = (commandMatch: string | RegExpMatchArray | null | undefined): string => {
  if (typeof commandMatch === 'string') return commandMatch
  return ''
}

const getSubcommand = (args: string[]): string => {
  const subcommand = args[0]
  if (subcommand === undefined) return 'list'
  return subcommand
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
    `Prompt fragments: ${manifest.contributes.promptFragments.length > 0 ? manifest.contributes.promptFragments.join(', ') : 'none'}`,
    `Commands: ${manifest.contributes.commands.length > 0 ? manifest.contributes.commands.join(', ') : 'none'}`,
    `Jobs: ${manifest.contributes.jobs.length > 0 ? manifest.contributes.jobs.join(', ') : 'none'}`,
    `Config keys: ${manifest.contributes.configKeys.length > 0 ? manifest.contributes.configKeys.join(', ') : 'none'}`,
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
  await reply.text(
    ok
      ? `❌ Plugin \`${pluginId}\` rejected. It will stop loading on next startup.`
      : `Plugin \`${pluginId}\` not found.`,
  )
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

async function runApproveSubcommand(ctx: PluginCommandContext): Promise<void> {
  const id = ctx.args[1]
  if (id === undefined) {
    await ctx.reply.text('Usage: /plugin approve <plugin-id>')
    return
  }
  if (!isSuperAdmin(ctx.userId)) {
    await ctx.reply.text('Only the super admin can approve or reject plugins.')
    return
  }
  await handleApprove(id, ctx.userId, ctx.reply)
}

async function runRejectSubcommand(ctx: PluginCommandContext): Promise<void> {
  const id = ctx.args[1]
  if (id === undefined) {
    await ctx.reply.text('Usage: /plugin reject <plugin-id>')
    return
  }
  if (!isSuperAdmin(ctx.userId)) {
    await ctx.reply.text('Only the super admin can approve or reject plugins.')
    return
  }
  await handleReject(id, ctx.userId, ctx.reply)
}

async function runEnableSubcommand(ctx: PluginCommandContext): Promise<void> {
  const id = ctx.args[1]
  if (id === undefined) {
    await ctx.reply.text('Usage: /plugin enable <plugin-id> [context-id]')
    return
  }
  const targetContextId = getTargetContextId(ctx.args, ctx.sourceContextId)
  const authorization = canManageTargetContext(
    ctx.userId,
    targetContextId,
    ctx.sourcePlatformInstanceId,
    hasExplicitTargetContext(ctx.args),
  )
  if (!authorization.allowed) {
    await replyTargetAuthorizationFailure(authorization, ctx.reply)
    return
  }
  await handleEnable(id, targetContextId, ctx.userId, ctx.reply)
}

async function runDisableSubcommand(ctx: PluginCommandContext): Promise<void> {
  const id = ctx.args[1]
  if (id === undefined) {
    await ctx.reply.text('Usage: /plugin disable <plugin-id> [context-id]')
    return
  }
  const targetContextId = getTargetContextId(ctx.args, ctx.sourceContextId)
  const authorization = canManageTargetContext(
    ctx.userId,
    targetContextId,
    ctx.sourcePlatformInstanceId,
    hasExplicitTargetContext(ctx.args),
  )
  if (!authorization.allowed) {
    await replyTargetAuthorizationFailure(authorization, ctx.reply)
    return
  }
  await handleDisable(id, targetContextId, ctx.userId, ctx.reply)
}

async function runPluginSubcommand(subcommand: string, ctx: PluginCommandContext): Promise<void> {
  if (subcommand === 'list') {
    await ctx.reply.text(buildPluginListMessage())
  } else if (subcommand === 'info') {
    const id = ctx.args[1]
    await ctx.reply.text(id === undefined ? 'Usage: /plugin info <plugin-id>' : buildPluginInfoMessage(id))
  } else if (subcommand === 'approve') {
    await runApproveSubcommand(ctx)
  } else if (subcommand === 'reject') {
    await runRejectSubcommand(ctx)
  } else if (subcommand === 'enable') {
    await runEnableSubcommand(ctx)
  } else if (subcommand === 'disable') {
    await runDisableSubcommand(ctx)
  } else {
    await ctx.reply.text(`Unknown plugin subcommand. ${PLUGIN_USAGE}`)
  }
}

export function registerPluginCommand(chat: ChatProvider, _adminUserId: string): void {
  chat.registerCommand('plugin', async (msg, reply, auth) => {
    if (!auth.allowed) return
    if (!isAdmin(msg.user.id, msg.platformInstanceId)) {
      await reply.text('Only an admin for this platform can manage plugins.')
      return
    }
    if (msg.contextType === 'group') {
      await reply.text('Plugin management is only available in direct messages.')
      return
    }
    const args = getCommandText(msg.commandMatch)
      .trim()
      .split(/\s+/u)
      .filter((s) => s !== '')
    const subcommand = getSubcommand(args)
    log.debug({ userId: msg.user.id, subcommand, args }, '/plugin command called')
    await runPluginSubcommand(subcommand, {
      args,
      userId: msg.user.id,
      sourceContextId: msg.contextId,
      sourcePlatformInstanceId: msg.platformInstanceId,
      reply,
    })
  })
}
