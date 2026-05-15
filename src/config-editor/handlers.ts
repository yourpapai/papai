/**
 * Config Editor handlers
 * Button callback and message handlers for standalone config editing
 */

import { getConfig, isSensitiveKey, maskValue, setConfig } from '../config.js'
import { emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import { isConfigKey, type ConfigKey } from '../types/config.js'
import { createEditorSession, deleteEditorSession, getEditorSession, updateEditorSession } from './state.js'
import type { EditorButton, EditorProcessResult } from './types.js'
import { validateConfigValue } from './validation.js'

const log = logger.child({ scope: 'config-editor:handlers' })

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

const encodeContextId = (id: string): string => Buffer.from(id).toString('base64url')
const decodeContextId = (encoded: string): string => Buffer.from(encoded, 'base64url').toString('utf8')

function appendContext(base: string, targetContextId: string | undefined): string {
  return targetContextId === undefined ? base : `${base}@${encodeContextId(targetContextId)}`
}

export function serializeCallbackData(button: Pick<EditorButton, 'action' | 'key'>, targetContextId?: string): string {
  switch (button.action) {
    case 'edit':
      return appendContext(button.key === undefined ? 'cfg:back' : `cfg:edit:${button.key}`, targetContextId)
    case 'save':
      return appendContext(button.key === undefined ? 'cfg:back' : `cfg:save:${button.key}`, targetContextId)
    case 'cancel':
      return appendContext('cfg:cancel', targetContextId)
    case 'back':
      return appendContext('cfg:back', targetContextId)
    case 'setup':
      return appendContext('cfg:setup', targetContextId)
    default:
      return appendContext('cfg:back', targetContextId)
  }
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

/**
 * Build the config list view with edit buttons
 */
function buildConfigList(storageContextId: string): { text: string; buttons: EditorButton[] } {
  const lines = ['⚙️ **Configuration**\n']
  const buttons: EditorButton[] = []

  const configKeys: ConfigKey[] = [
    'llm_apikey',
    'llm_baseurl',
    'main_model',
    'small_model',
    'embedding_model',
    'kaneo_apikey',
    'youtrack_token',
    'timezone',
  ]

  for (const key of configKeys) {
    const value = getConfig(storageContextId, key)
    // Skip provider-specific keys that don't apply
    if (key === 'kaneo_apikey' && process.env['TASK_PROVIDER'] === 'youtrack') continue
    if (key === 'youtrack_token' && process.env['TASK_PROVIDER'] === 'kaneo') continue

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

/**
 * Parse callback data and extract action/key
 */
export function parseCallbackData(data: string): {
  action: 'edit' | 'save' | 'cancel' | 'back' | 'setup' | null
  key: ConfigKey | null
  targetContextId?: string
} {
  let targetContextId: string | undefined
  let core = data
  const atIdx = data.indexOf('@')
  if (atIdx !== -1) {
    try {
      targetContextId = decodeContextId(data.slice(atIdx + 1))
    } catch {
      /* invalid encoding — treat as legacy */
    }
    core = data.slice(0, atIdx)
  }

  if (core === 'cfg:cancel') return { action: 'cancel', key: null, targetContextId }
  if (core === 'cfg:back') return { action: 'back', key: null, targetContextId }
  if (core === 'cfg:setup') return { action: 'setup', key: null, targetContextId }

  if (core.startsWith('cfg:edit:')) {
    const key = core.replace('cfg:edit:', '')
    return isConfigKey(key) ? { action: 'edit', key, targetContextId } : { action: null, key: null }
  }

  if (core.startsWith('cfg:save:')) {
    const key = core.replace('cfg:save:', '')
    return isConfigKey(key) ? { action: 'save', key, targetContextId } : { action: null, key: null }
  }

  return { action: null, key: null }
}
