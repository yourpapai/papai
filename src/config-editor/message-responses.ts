// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isSensitiveKey, maskSensitiveValue } from '../config.js'
import { emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { ConfigField } from '../types/config.js'
import { getEditorSession, type EditorSessionUpdate, updateEditorSession } from './state.js'
import type { EditorButton, EditorProcessResult } from './types.js'

const log = logger.child({ scope: 'config-editor:message-responses' })

export function buildCancelBackButtonsForSession(sessionToken: string): EditorButton[] {
  return [
    { text: '❌ Cancel', action: 'cancel', sessionToken, style: 'danger' },
    { text: '⬅️ Back', action: 'back', sessionToken, style: 'secondary' },
  ]
}

function buildSaveConfirmationButtons(sessionKey: string, sessionToken: string, emoji: string): EditorButton[] {
  return [
    { text: '❌ Cancel', action: 'cancel', sessionToken, style: 'danger' },
    { text: '⬅️ Back', action: 'back', sessionToken, style: 'secondary' },
    {
      text: `✅ Save ${emoji}`,
      action: 'save',
      key: sessionKey,
      sessionToken,
      style: 'primary',
    },
  ]
}

function updateSessionAndGet(
  userId: string,
  storageContextId: string,
  update: EditorSessionUpdate,
): ReturnType<typeof getEditorSession> {
  updateEditorSession(userId, storageContextId, update)
  return getEditorSession(userId, storageContextId)
}

export function buildInvalidValueResponse(
  userId: string,
  storageContextId: string,
  field: ConfigField,
  validationError: string,
): EditorProcessResult {
  const updatedSession = updateSessionAndGet(userId, storageContextId, {
    clearPendingValue: true,
    rotateSessionToken: true,
  })
  if (updatedSession === null) {
    return { handled: false }
  }

  return {
    handled: true,
    response: `❌ **${validationError}**\n\nPlease enter a valid value for ${field.label}:`,
    buttons: buildCancelBackButtonsForSession(updatedSession.sessionToken),
  }
}

export function buildPendingValueResponse(
  userId: string,
  storageContextId: string,
  sessionKey: string,
  field: ConfigField,
  text: string,
  emoji: string,
): EditorProcessResult {
  const trimmedText = text.trim()
  const updatedSession = updateSessionAndGet(userId, storageContextId, {
    pendingValue: trimmedText,
    rotateSessionToken: true,
  })
  if (updatedSession === null) {
    return { handled: false }
  }

  const sensitiveKey = field.sensitive || isSensitiveKey(sessionKey)
  const maskedOrRaw = sensitiveKey ? maskSensitiveValue(trimmedText) : trimmedText

  log.info({ userId, storageContextId, key: sessionKey }, 'Config value entered, awaiting confirmation')
  emitUser('config_editor:step', userId, { userId, step: 'value_entered' })

  return {
    handled: true,
    response: `✏️ **${field.label}**\n\nNew value: \`${maskedOrRaw}\`\n\nSave this value?`,
    buttons: buildSaveConfirmationButtons(sessionKey, updatedSession.sessionToken, emoji),
    isSensitiveKey: sensitiveKey,
  }
}
