// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { supportsInteractiveButtons, supportsMessageDeletion } from '../chat/capabilities.js'
import type { ChatButton, ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { serializeCallbackData } from '../config-editor/index.js'
import { getAllConfig, maskValue } from '../config.js'
import { startGroupSettingsSelection } from '../group-settings/selector.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS, type ConfigKey } from '../types/config.js'

const log = logger.child({ scope: 'commands:config' })
const GROUP_CONFIG_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.'
const GROUP_CONFIG_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'
const NO_DELETE_WARNING =
  '⚠️ This platform does not support automatic deletion of messages containing secrets. Please manually delete your messages after entering API keys and tokens.\n\n'

const FIELD_DISPLAY_NAMES: Record<ConfigKey, string> = {
  llm_apikey: 'LLM API Key',
  llm_baseurl: 'Base URL',
  main_model: 'Main Model',
  small_model: 'Small Model',
  embedding_model: 'Embedding Model',
  kaneo_apikey: 'Kaneo API Key',
  kaneo_workspace_id: 'Kaneo Workspace ID',
  youtrack_token: 'YouTrack Token',
  timezone: 'Timezone',
}

function getFieldEmoji(key: ConfigKey): string {
  const emojiMap: Record<ConfigKey, string> = {
    llm_apikey: '🔑',
    llm_baseurl: '🌐',
    main_model: '🤖',
    small_model: '⚡',
    embedding_model: '📊',
    kaneo_apikey: '🔐',
    kaneo_workspace_id: '📁',
    youtrack_token: '🔐',
    timezone: '🌍',
  }
  return emojiMap[key] ?? '⚙️'
}

function formatConfigLine(key: ConfigKey, value: string | undefined): string {
  const displayName = FIELD_DISPLAY_NAMES[key]
  const emoji = getFieldEmoji(key)
  if (value === undefined) {
    return `${emoji} ${displayName}: *(not set)*`
  }
  return `${emoji} ${displayName}: ${maskValue(key, value)}`
}

function buildConfigButtons(config: Partial<Record<ConfigKey, string>>, targetContextId: string): ChatButton[] {
  const buttons: ChatButton[] = CONFIG_KEYS.map((key) => ({
    text: `${getFieldEmoji(key)} ${FIELD_DISPLAY_NAMES[key]}`,
    callbackData: serializeCallbackData({ action: 'edit', key }, targetContextId),
    style: config[key] === undefined ? 'secondary' : 'primary',
  }))
  buttons.push({
    text: '🔄 Full Setup',
    callbackData: serializeCallbackData({ action: 'setup' }, targetContextId),
    style: 'primary',
  })
  return buttons
}

export async function renderConfigForTarget(
  reply: ReplyFn,
  targetContextId: string,
  interactiveButtons: boolean,
): Promise<void> {
  const config = getAllConfig(targetContextId)
  const lines = ['⚙️ **Current Configuration**\n']

  CONFIG_KEYS.forEach((key) => {
    lines.push(formatConfigLine(key, config[key]))
  })

  if (!interactiveButtons) {
    lines.push('\n⚠️ Interactive editing is not available in this chat. Use `/setup` to configure everything.')
    await reply.formatted(lines.join('\n'))
    return
  }

  lines.push('\n💡 Click a field below to edit it, or use `/setup` to configure everything.')
  await reply.buttons(lines.join('\n'), { buttons: buildConfigButtons(config, targetContextId) })
}

async function replyWithConfigSelection(reply: ReplyFn, userId: string, interactiveButtons: boolean): Promise<void> {
  const selection = startGroupSettingsSelection(userId, 'config', interactiveButtons)
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

export function registerConfigCommand(
  chat: ChatProvider,
  _checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType === 'group') {
      await reply.text(auth.isGroupAdmin ? GROUP_CONFIG_REDIRECT : GROUP_CONFIG_ADMIN_ONLY)
      return
    }

    log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command called')
    const interactiveButtons = supportsInteractiveButtons(chat)

    log.info({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command executed')
    if (!supportsMessageDeletion(chat)) {
      await reply.text(NO_DELETE_WARNING)
    }
    await replyWithConfigSelection(reply, msg.user.id, interactiveButtons)
  }

  chat.registerCommand('config', handler)
}
