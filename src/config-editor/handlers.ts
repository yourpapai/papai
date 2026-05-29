// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Config Editor handlers
 * Button callback and message handlers for standalone config editing
 */

import { getConfigFieldsForContext } from '../config-keys.js'
import {
  getConfigValue,
  getPluginConfig,
  isSensitiveKey,
  maskSensitiveValue,
  maskValue,
  setConfigValue,
  setPluginConfig,
} from '../config.js'
import { emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { ConfigField } from '../types/config.js'
import { createEditorSession, deleteEditorSession, getEditorSession, updateEditorSession } from './state.js'
import type { EditorButton, EditorProcessResult } from './types.js'
import { validateConfigField } from './validation.js'

export { parseCallbackData, serializeCallbackData } from './callback-data.js'

const log = logger.child({ scope: 'config-editor:handlers' })

function getFieldEmoji(field: ConfigField): string {
  if (field.storageKey === 'timezone') return '🌍'
  if (field.storageKey === 'mcp_endpoints') return '🔌'
  return field.sensitive ? '🔐' : '⚙️'
}

function getFieldForContext(storageContextId: string, key: string): ConfigField | undefined {
  return getConfigFieldsForContext(storageContextId).find((field) => field.storageKey === key)
}

function formatConfigLine(field: ConfigField, value: string | undefined): string {
  const emoji = getFieldEmoji(field)
  if (value === undefined) {
    return `${emoji} ${field.label}: *(not set)*`
  }
  return `${emoji} ${field.label}: ${field.sensitive ? maskSensitiveValue(value) : value}`
}

function getPluginFieldParts(storageKey: string): { pluginId: string; key: string } | null {
  const match = /^plugin:([^:]+):(.+)$/u.exec(storageKey)
  if (match === null) return null
  const [, pluginId, key] = match
  if (pluginId === undefined || key === undefined) return null
  return { pluginId, key }
}

function getStoredFieldValue(storageContextId: string, field: ConfigField): string | null {
  if (field.kind !== 'plugin-context') return getConfigValue(storageContextId, field.storageKey)
  const parts = getPluginFieldParts(field.storageKey)
  if (parts === null) return null
  return getPluginConfig(storageContextId, parts.pluginId, parts.key)
}

/**
 * Build the config list view with edit buttons
 */
function buildConfigList(storageContextId: string): { text: string; buttons: EditorButton[] } {
  const lines = ['⚙️ **Configuration**\n']
  const buttons: EditorButton[] = []

  const configFields = getConfigFieldsForContext(storageContextId)

  for (const field of configFields) {
    const value = getStoredFieldValue(storageContextId, field)

    lines.push(formatConfigLine(field, value ?? undefined))
    buttons.push({
      text: `${getFieldEmoji(field)} ${field.label}`,
      action: 'edit',
      key: field.storageKey,
      style: value === null ? 'secondary' : 'primary',
    })
  }

  lines.push('\n💡 Click a field to edit it.')

  return { text: lines.join('\n'), buttons }
}

/**
 * Start editing a specific config field
 */
export function startEditor(userId: string, storageContextId: string, key: string): EditorProcessResult {
  const field = getFieldForContext(storageContextId, key)
  if (field === undefined) {
    return { handled: true, response: `Config key "${key}" is not valid for this context.` }
  }

  createEditorSession({ userId, storageContextId, editingKey: key })

  const currentValue = getStoredFieldValue(storageContextId, field)
  const emoji = getFieldEmoji(field)

  let valueDisplay: string
  if (currentValue === null) {
    valueDisplay = '(not set)'
  } else {
    valueDisplay = field.sensitive ? maskSensitiveValue(currentValue) : maskValue(key, currentValue)
  }

  const lines = [
    `✏️ Edit ${field.label}`,
    '',
    `Current value: ${valueDisplay}`,
    '',
    `Enter new value for ${emoji} ${field.label}:`,
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

function handleSaveAction(userId: string, storageContextId: string, key?: string): EditorProcessResult {
  const session = getEditorSession(userId, storageContextId)
  if (session === null || session.pendingValue === undefined) {
    return { handled: false }
  }

  if (key !== undefined && key !== session.editingKey) {
    return { handled: false }
  }

  const field = getFieldForContext(storageContextId, session.editingKey)
  if (field === undefined) {
    deleteEditorSession(userId, storageContextId)
    return { handled: true, response: `Config key "${session.editingKey}" is not valid for this context.` }
  }

  if (field.kind === 'plugin-context') {
    const parts = getPluginFieldParts(session.editingKey)
    if (parts === null) {
      deleteEditorSession(userId, storageContextId)
      return { handled: true, response: `Config key "${session.editingKey}" is not valid for this context.` }
    }
    setPluginConfig(storageContextId, parts.pluginId, parts.key, session.pendingValue)
  } else {
    setConfigValue(storageContextId, session.editingKey, session.pendingValue)
  }
  deleteEditorSession(userId, storageContextId)

  log.info({ userId, storageContextId, key: session.editingKey }, 'Config value saved')

  emitUser('config_editor:closed', userId, { userId })

  return {
    handled: true,
    response: `✅ **${field.label}** saved successfully.`,
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
  key?: string,
): EditorProcessResult {
  switch (action) {
    case 'edit':
      return key === undefined ? { handled: false } : startEditor(userId, storageContextId, key)
    case 'save':
      return handleSaveAction(userId, storageContextId, key)
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

  const field = getFieldForContext(storageContextId, session.editingKey)
  if (field === undefined) {
    deleteEditorSession(userId, storageContextId)
    return { handled: true, response: `Config key "${session.editingKey}" is not valid for this context.` }
  }

  // Validate the input
  const validation = validateConfigField(field, text)
  if (!validation.valid) {
    return {
      handled: true,
      response: `❌ **${validation.error}**\n\nPlease enter a valid value for ${field.label}:`,
      buttons: [
        { text: '❌ Cancel', action: 'cancel', style: 'danger' },
        { text: '⬅️ Back', action: 'back', style: 'secondary' },
      ],
    }
  }

  // Store pending value
  updateEditorSession(userId, storageContextId, { pendingValue: text.trim() })

  const emoji = getFieldEmoji(field)
  const sensitiveKey = field.sensitive || isSensitiveKey(session.editingKey)
  const trimmedText = text.trim()
  const maskedOrRaw = sensitiveKey ? maskSensitiveValue(trimmedText) : trimmedText

  log.info({ userId, storageContextId, key: session.editingKey }, 'Config value entered, awaiting confirmation')

  emitUser('config_editor:step', userId, { userId, step: 'value_entered' })

  return {
    handled: true,
    response: `✏️ **${field.label}**\n\nNew value: \`${maskedOrRaw}\`\n\nSave this value?`,
    buttons: [
      { text: '❌ Cancel', action: 'cancel', style: 'danger' },
      { text: '⬅️ Back', action: 'back', style: 'secondary' },
      { text: `✅ Save ${emoji}`, action: 'save', key: session.editingKey, style: 'primary' },
    ],
    isSensitiveKey: sensitiveKey,
  }
}
