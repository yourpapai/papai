// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Config Editor handlers
 * Button callback and message handlers for standalone config editing
 */

import { getConfigKeysForContext } from '../config-keys.js'
import { getConfig, isSensitiveKey, maskValue, setConfig } from '../config.js'
import { emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { ConfigKey } from '../types/config.js'
import { createEditorSession, deleteEditorSession, getEditorSession, updateEditorSession } from './state.js'
import type { EditorButton, EditorProcessResult } from './types.js'
import { validateConfigValue } from './validation.js'

export { parseCallbackData, serializeCallbackData } from './callback-data.js'

const log = logger.child({ scope: 'config-editor:handlers' })

const FIELD_DISPLAY_NAMES: Record<ConfigKey, string> = {
  kaneo_apikey: 'Kaneo API Key',
  kaneo_workspace_id: 'Kaneo Workspace ID',
  youtrack_token: 'YouTrack Token',
  timezone: 'Timezone',
  mcp_endpoints: 'MCP Endpoints',
}

function getFieldEmoji(key: ConfigKey): string {
  const emojiMap: Record<ConfigKey, string> = {
    kaneo_apikey: '🔐',
    kaneo_workspace_id: '📁',
    youtrack_token: '🔐',
    timezone: '🌍',
    mcp_endpoints: '🔌',
  }
  return emojiMap[key] ?? '⚙️'
}

function isKeyValidForContext(storageContextId: string, key: ConfigKey): boolean {
  return getConfigKeysForContext(storageContextId).includes(key)
}

function formatConfigLine(key: ConfigKey, value: string | undefined): string {
  const displayName = FIELD_DISPLAY_NAMES[key]
  const emoji = getFieldEmoji(key)
  if (value === undefined) {
    return `${emoji} ${displayName}: *(not set)*`
  }
  return `${emoji} ${displayName}: ${maskValue(key, value)}`
}

/**
 * Build the config list view with edit buttons
 */
function buildConfigList(storageContextId: string): { text: string; buttons: EditorButton[] } {
  const lines = ['⚙️ **Configuration**\n']
  const buttons: EditorButton[] = []

  const configKeys = getConfigKeysForContext(storageContextId)

  for (const key of configKeys) {
    const value = getConfig(storageContextId, key)

    lines.push(formatConfigLine(key, value ?? undefined))
    buttons.push({
      text: `${getFieldEmoji(key)} ${FIELD_DISPLAY_NAMES[key]}`,
      action: 'edit',
      key,
      style: value === null ? 'secondary' : 'primary',
    })
  }

  lines.push('\n💡 Click a field to edit it.')

  return { text: lines.join('\n'), buttons }
}

/**
 * Start editing a specific config field
 */
export function startEditor(userId: string, storageContextId: string, key: ConfigKey): EditorProcessResult {
  if (!isKeyValidForContext(storageContextId, key)) {
    return { handled: true, response: `Config key "${key}" is not valid for this context.` }
  }

  createEditorSession({ userId, storageContextId, editingKey: key })

  const currentValue = getConfig(storageContextId, key)
  const displayName = FIELD_DISPLAY_NAMES[key]
  const emoji = getFieldEmoji(key)

  let valueDisplay: string
  if (currentValue === null) {
    valueDisplay = '(not set)'
  } else {
    valueDisplay = maskValue(key, currentValue)
  }

  const lines = [
    `✏️ Edit ${displayName}`,
    '',
    `Current value: ${valueDisplay}`,
    '',
    `Enter new value for ${emoji} ${displayName}:`,
  ]

  log.info({ userId, storageContextId, key }, 'Started config editor')

  emitUser('config_editor:opened', userId, { userId })

  return {
    handled: true,
    response: lines.join('\n'),
    buttons: [
      { text: '❌ Cancel', action: 'cancel', style: 'danger' },
      { text: '⬅️ Back', action: 'back', style: 'secondary' },
    ],
  }
}

function handleSaveAction(userId: string, storageContextId: string): EditorProcessResult {
  const session = getEditorSession(userId, storageContextId)
  if (session === null || session.pendingValue === undefined) {
    return { handled: false }
  }

  if (!isKeyValidForContext(storageContextId, session.editingKey)) {
    deleteEditorSession(userId, storageContextId)
    return { handled: true, response: `Config key "${session.editingKey}" is not valid for this context.` }
  }

  setConfig(storageContextId, session.editingKey, session.pendingValue)
  deleteEditorSession(userId, storageContextId)

  const displayName = FIELD_DISPLAY_NAMES[session.editingKey]
  log.info({ userId, storageContextId, key: session.editingKey }, 'Config value saved')

  emitUser('config_editor:closed', userId, { userId })

  return {
    handled: true,
    response: `✅ **${displayName}** saved successfully.`,
    buttons: [{ text: '⬅️ Back to Config', action: 'back', style: 'primary' }],
  }
}

function handleCancelAction(userId: string, storageContextId: string): EditorProcessResult {
  deleteEditorSession(userId, storageContextId)
  log.info({ userId, storageContextId }, 'Config editor cancelled')

  emitUser('config_editor:closed', userId, { userId })

  return {
    handled: true,
    response: '❌ Changes cancelled. No updates were saved.',
    buttons: [{ text: '⬅️ Back to Config', action: 'back', style: 'primary' }],
  }
}

function handleBackAction(userId: string, storageContextId: string): EditorProcessResult {
  deleteEditorSession(userId, storageContextId)
  const { text, buttons } = buildConfigList(storageContextId)
  return { handled: true, response: text, buttons }
}

function handleSetupAction(): EditorProcessResult {
  return {
    handled: true,
    response: '🔄 Use `/setup` to run the full configuration wizard.',
  }
}

/**
 * Handle a button callback action
 */
export function handleEditorCallback(
  userId: string,
  storageContextId: string,
  action: 'edit' | 'save' | 'cancel' | 'back' | 'setup',
  key?: ConfigKey,
): EditorProcessResult {
  switch (action) {
    case 'edit':
      return key === undefined ? { handled: false } : startEditor(userId, storageContextId, key)
    case 'save':
      return handleSaveAction(userId, storageContextId)
    case 'cancel':
      return handleCancelAction(userId, storageContextId)
    case 'back':
      return handleBackAction(userId, storageContextId)
    case 'setup':
      return handleSetupAction()
    default:
      return { handled: false }
  }
}

/**
 * Handle a text message while in editor mode
 */
export function handleEditorMessage(userId: string, storageContextId: string, text: string): EditorProcessResult {
  const session = getEditorSession(userId, storageContextId)
  if (session === null) {
    return { handled: false }
  }

  if (!isKeyValidForContext(storageContextId, session.editingKey)) {
    deleteEditorSession(userId, storageContextId)
    return { handled: true, response: `Config key "${session.editingKey}" is not valid for this context.` }
  }

  // Validate the input
  const validation = validateConfigValue(session.editingKey, text)
  if (!validation.valid) {
    const displayName = FIELD_DISPLAY_NAMES[session.editingKey]
    return {
      handled: true,
      response: `❌ **${validation.error}**\n\nPlease enter a valid value for ${displayName}:`,
      buttons: [
        { text: '❌ Cancel', action: 'cancel', style: 'danger' },
        { text: '⬅️ Back', action: 'back', style: 'secondary' },
      ],
    }
  }

  // Store pending value
  updateEditorSession(userId, storageContextId, { pendingValue: text.trim() })

  const displayName = FIELD_DISPLAY_NAMES[session.editingKey]
  const emoji = getFieldEmoji(session.editingKey)
  const sensitiveKey = isSensitiveKey(session.editingKey)
  const trimmedText = text.trim()
  const maskedOrRaw = sensitiveKey ? maskValue(session.editingKey, trimmedText) : trimmedText

  log.info({ userId, storageContextId, key: session.editingKey }, 'Config value entered, awaiting confirmation')

  emitUser('config_editor:step', userId, { userId, step: 'value_entered' })

  return {
    handled: true,
    response: `✏️ **${displayName}**\n\nNew value: \`${maskedOrRaw}\`\n\nSave this value?`,
    buttons: [
      { text: '❌ Cancel', action: 'cancel', style: 'danger' },
      { text: '⬅️ Back', action: 'back', style: 'secondary' },
      { text: `✅ Save ${emoji}`, action: 'save', key: session.editingKey, style: 'primary' },
    ],
    isSensitiveKey: sensitiveKey,
  }
}
