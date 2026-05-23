// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getPluginConfig } from '../config.js'
import { listManageableGroups } from '../group-settings/access.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { pluginRegistry, setPluginEnabledForContext } from '../plugins/registry.js'
import type { PluginRegistryEntry } from '../plugins/registry.js'
import { replyTextPreferReplace } from './interaction-router-replies.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:plugin-interaction' })

function decodeContextId(encoded: string): string | null {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function canManageTargetContext(interaction: IncomingInteraction, targetContextId: string): boolean {
  if (interaction.contextType !== 'dm') return targetContextId === interaction.storageContextId
  if (targetContextId === interaction.user.id) return true
  return listManageableGroups(interaction.user.id).some((group) => group.contextId === targetContextId)
}

function getMissingRequiredConfigLabels(entry: PluginRegistryEntry, contextId: string): readonly string[] {
  return entry.discoveredPlugin.manifest.configRequirements
    .filter((requirement) => requirement.required)
    .filter((requirement) => {
      const value = getPluginConfig(contextId, entry.discoveredPlugin.manifest.id, requirement.key)
      return value === null || value.trim() === ''
    })
    .map((requirement) => requirement.label)
}

async function handleEnablePlugin(
  pluginId: string,
  contextId: string,
  interaction: IncomingInteraction,
  reply: ReplyFn,
): Promise<void> {
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined || entry.state !== 'active') {
    await replyTextPreferReplace(reply, `Plugin \`${pluginId}\` is not available.`)
    return
  }

  const missingLabels = getMissingRequiredConfigLabels(entry, contextId)
  if (missingLabels.length > 0) {
    await replyTextPreferReplace(
      reply,
      `Plugin \`${pluginId}\` requires configuration before it can be enabled: ${missingLabels.join(', ')}. Open /config for this target and set the missing values.`,
    )
    return
  }

  setPluginEnabledForContext(pluginId, contextId, true)
  log.info({ pluginId, contextId, userId: interaction.user.id }, 'Plugin enabled via interaction')
  await replyTextPreferReplace(reply, `🟢 Plugin \`${pluginId}\` enabled.`)
}

async function handleDisablePlugin(
  pluginId: string,
  contextId: string,
  interaction: IncomingInteraction,
  reply: ReplyFn,
): Promise<void> {
  setPluginEnabledForContext(pluginId, contextId, false)
  log.info({ pluginId, contextId, userId: interaction.user.id }, 'Plugin disabled via interaction')
  await replyTextPreferReplace(reply, `⭕ Plugin \`${pluginId}\` disabled.`)
}

/** Handle plg: callback interactions for enabling/disabling plugins per context. */
export async function handlePluginInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData } = interaction
  if (!callbackData.startsWith('plg:')) return false

  // Format: plg:<action>:<pluginId>:<base64url(contextId)>
  const parts = callbackData.slice(4).split(':')
  const action = parts[0]
  const pluginId = parts[1]
  const encodedContextId = parts[2]

  if (action === undefined || pluginId === undefined || encodedContextId === undefined) {
    log.warn({ callbackData }, 'Malformed plugin interaction callback')
    await replyTextPreferReplace(reply, 'Invalid plugin action. Please try again.')
    return true
  }
  const contextId = decodeContextId(encodedContextId)
  if (contextId === null) {
    log.warn({ callbackData }, 'Malformed plugin interaction context')
    await replyTextPreferReplace(reply, 'Invalid plugin action. Please try again.')
    return true
  }
  if (!canManageTargetContext(interaction, contextId)) {
    await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, contextId))
    return true
  }

  if (action === 'enable') {
    await handleEnablePlugin(pluginId, contextId, interaction, reply)
    return true
  }

  if (action === 'disable') {
    await handleDisablePlugin(pluginId, contextId, interaction, reply)
    return true
  }

  log.warn({ callbackData, action }, 'Unknown plugin interaction action')
  await replyTextPreferReplace(reply, 'Unknown plugin action.')
  return true
}
