// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildAiOutputConfigSection } from '../ai-output-config-ui.js'
import { supportsInteractiveButtons, supportsMessageDeletion } from '../chat/capabilities.js'
import { resolveSourceChatProvider } from '../chat/source-instance.js'
import type { ChatButton, ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { serializeCallbackData } from '../config-editor/index.js'
import { getConfigFieldsForContext } from '../config-keys.js'
import { getConfigValue, getPluginConfig, maskSensitiveValue, maskValue } from '../config.js'
import { startGroupSettingsSelection } from '../group-settings/selector.js'
import { logger } from '../logger.js'
import { getPluginContextEligibility, isPluginActiveForContext, pluginRegistry } from '../plugins/registry.js'
import type { PluginRegistryEntry } from '../plugins/registry.js'
import { getPluginContextState } from '../plugins/store.js'
import { getToolPrefs } from '../tools/tool-preferences.js'
import type { ConfigField } from '../types/config.js'

const log = logger.child({ scope: 'commands:config' })
const GROUP_CONFIG_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.'
const GROUP_CONFIG_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'
const NO_DELETE_WARNING =
  '⚠️ This platform does not support automatic deletion of messages containing secrets. Please manually delete your messages after entering API keys and tokens.\n\n'
const MAX_CALLBACK_DATA_BYTES = 64

function isSafeCallbackData(callbackData: string): boolean {
  return Buffer.byteLength(callbackData, 'utf8') <= MAX_CALLBACK_DATA_BYTES
}

function getFieldEmoji(field: ConfigField): string {
  if (field.storageKey === 'timezone') return '🌍'
  return field.sensitive ? '🔐' : '⚙️'
}

function formatConfigLine(field: ConfigField, value: string | undefined): string {
  const emoji = getFieldEmoji(field)
  if (value === undefined) {
    return `${emoji} ${field.label}: *(not set)*`
  }
  return `${emoji} ${field.label}: ${field.sensitive ? maskSensitiveValue(value) : maskValue(field.storageKey, value)}`
}

function buildConfigButtons(fields: readonly ConfigField[], targetContextId: string): ChatButton[] {
  const buttons: ChatButton[] = fields.map((field) => ({
    text: `${getFieldEmoji(field)} ${field.label}`,
    callbackData: serializeCallbackData({ action: 'edit', key: field.storageKey }, targetContextId),
    style: getConfigValue(targetContextId, field.storageKey) === null ? 'secondary' : 'primary',
  }))
  buttons.push({
    text: '🔄 Full Setup',
    callbackData: serializeCallbackData({ action: 'setup' }, targetContextId),
    style: 'primary',
  })
  return buttons
}

function encodePluginContextId(contextId: string): string {
  return Buffer.from(contextId).toString('base64url')
}

function maskPluginConfigValue(value: string): string {
  return `****${value.slice(-4)}`
}

function isPluginSelectedForContext(entry: PluginRegistryEntry, targetContextId: string): boolean {
  const state = getPluginContextState(entry.discoveredPlugin.manifest.id, targetContextId)
  return state === undefined ? entry.discoveredPlugin.manifest.defaultEnabled : state.enabled
}

function formatPluginStatus(entry: PluginRegistryEntry, targetContextId: string): string {
  const selected = isPluginSelectedForContext(entry, targetContextId)
  const source =
    getPluginContextState(entry.discoveredPlugin.manifest.id, targetContextId) === undefined && selected
      ? ' (default)'
      : ''
  if (!selected) return 'disabled'

  const eligibility = getPluginContextEligibility(entry.discoveredPlugin.manifest.id, targetContextId)
  if (eligibility.eligible) return `enabled${source}`
  if (eligibility.reason === 'config_missing') return 'unavailable (missing config)'
  if (eligibility.reason === 'capability_missing') {
    return `unavailable (missing capability: ${eligibility.missingCapabilities.join(', ')})`
  }
  return 'disabled'
}

function appendPluginRequirementLines(lines: string[], entry: PluginRegistryEntry, targetContextId: string): void {
  for (const requirement of entry.discoveredPlugin.manifest.configRequirements) {
    const value = getPluginConfig(targetContextId, entry.discoveredPlugin.manifest.id, requirement.key)
    const displayedValue =
      value === null || value === '' ? '*(not set)*' : requirement.sensitive ? maskPluginConfigValue(value) : value
    lines.push(`  - ${requirement.label} (${requirement.required ? 'required' : 'optional'}): ${displayedValue}`)
  }
}

function appendPluginConfigLines(lines: string[], targetContextId: string): void {
  const pluginEntries = pluginRegistry.getAllEntries().filter((entry) => entry.state === 'active')
  if (pluginEntries.length === 0) return

  lines.push('\n🧩 **Plugins**')
  for (const entry of pluginEntries) {
    const eligible = isPluginActiveForContext(entry.discoveredPlugin.manifest.id, targetContextId)
    const selected = isPluginSelectedForContext(entry, targetContextId)
    const marker = eligible ? '🟢' : selected ? '🟠' : '⭕'
    lines.push(`${marker} ${entry.discoveredPlugin.manifest.name}: ${formatPluginStatus(entry, targetContextId)}`)
    appendPluginRequirementLines(lines, entry, targetContextId)
  }
}

function buildPluginButtons(targetContextId: string): ChatButton[] {
  const encodedContextId = encodePluginContextId(targetContextId)
  return pluginRegistry
    .getAllEntries()
    .filter((entry) => entry.state === 'active')
    .map((entry) => {
      const pluginId = entry.discoveredPlugin.manifest.id
      const enabled = isPluginActiveForContext(pluginId, targetContextId)
      return {
        text: `${enabled ? 'Disable' : 'Enable'} ${entry.discoveredPlugin.manifest.name}`,
        callbackData: `plg:${enabled ? 'disable' : 'enable'}:${pluginId}:${encodedContextId}`,
        style: enabled ? ('danger' as const) : ('primary' as const),
      }
    })
    .filter((button) => isSafeCallbackData(button.callbackData))
}

function buildToolsButton(targetContextId: string): ChatButton | null {
  const button = {
    text: '🧰 Tools',
    callbackData: `tgl:menu:${encodePluginContextId(targetContextId)}`,
    style: 'secondary' as const,
  }
  return isSafeCallbackData(button.callbackData) ? button : null
}

export async function renderConfigForTarget(
  reply: ReplyFn,
  targetContextId: string,
  interactiveButtons: boolean,
): Promise<void> {
  const fields = getConfigFieldsForContext(targetContextId)
  const lines = ['⚙️ **Current Configuration**\n']

  fields.forEach((field) => {
    lines.push(formatConfigLine(field, getConfigValue(targetContextId, field.storageKey) ?? undefined))
  })
  const aiOutputSection = buildAiOutputConfigSection(targetContextId)
  lines.push(...aiOutputSection.lines)
  appendPluginConfigLines(lines, targetContextId)
  const toolPrefs = getToolPrefs(targetContextId)
  const disabledCount =
    toolPrefs.disabledDomains.length + Object.values(toolPrefs.toolOverrides).filter((v) => !v).length
  lines.push(`\n🧰 **Tools**: ${disabledCount === 0 ? 'all enabled' : `${disabledCount} disabled`}`)

  if (!interactiveButtons) {
    lines.push('\n⚠️ Interactive editing is not available in this chat. Use `/setup` to configure everything.')
    await reply.formatted(lines.join('\n'))
    return
  }

  lines.push('\n💡 Click a field below to edit it, or use `/setup` to configure everything.')
  const toolsButton = buildToolsButton(targetContextId)
  await reply.buttons(lines.join('\n'), {
    buttons: [
      ...buildConfigButtons(fields, targetContextId),
      ...aiOutputSection.buttons,
      ...buildPluginButtons(targetContextId),
      ...(toolsButton === null ? [] : [toolsButton]),
    ],
  })
}

async function replyWithConfigSelection(
  reply: ReplyFn,
  userId: string,
  platformInstanceId: string,
  interactiveButtons: boolean,
): Promise<void> {
  const selection = startGroupSettingsSelection(userId, 'config', interactiveButtons, platformInstanceId)
  if ('continueWith' in selection) {
    await renderConfigForTarget(reply, selection.continueWith.targetContextId, interactiveButtons)
    return
  }
  if ('buttons' in selection && selection.buttons !== undefined) {
    await reply.buttons(selection.response, { buttons: selection.buttons })
    return
  }
  if ('response' in selection) {
    await reply.text(selection.response)
  }
}

export function registerConfigCommand(chat: ChatProvider, ..._rest: [] | [_checkAuthorization: unknown]): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType === 'group') {
      await reply.text(auth.isGroupAdmin ? GROUP_CONFIG_REDIRECT : GROUP_CONFIG_ADMIN_ONLY)
      return
    }

    log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command called')
    const sourceChat = resolveSourceChatProvider(chat, msg.platformInstanceId)
    const interactiveButtons = supportsInteractiveButtons(sourceChat)

    log.info({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command executed')
    if (!supportsMessageDeletion(sourceChat)) {
      await reply.text(NO_DELETE_WARNING)
    }
    await replyWithConfigSelection(reply, msg.user.id, msg.platformInstanceId, interactiveButtons)
  }

  chat.registerCommand('config', handler)
}
