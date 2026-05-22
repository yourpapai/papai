// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleEditorMessage, hasActiveEditor, serializeCallbackData } from '../config-editor/index.js'
import { logger } from '../logger.js'
import type { ChatButton, ReplyFn } from './types.js'

const log = logger.child({ scope: 'config-editor-integration' })

const SENSITIVE_DELETE_WARNING =
  '\n\n⚠️ This platform does not support automatic deletion of messages. Please manually delete your previous message containing the secret value.'

export async function handleConfigEditorMessage(
  userId: string,
  storageContextId: string,
  text: string,
  reply: ReplyFn,
  messageId?: string,
): Promise<boolean> {
  if (!hasActiveEditor(userId, storageContextId)) {
    return false
  }

  const result = handleEditorMessage(userId, storageContextId, text)
  if (!result.handled) {
    return false
  }

  let response = result.response ?? ''
  if (result.isSensitiveKey === true) {
    if (reply.deleteMessage !== undefined && messageId !== undefined) {
      try {
        await reply.deleteMessage(messageId)
        log.info({ userId, messageId }, 'Deleted user message containing sensitive config value')
      } catch (error) {
        log.warn(
          { userId, messageId, error: error instanceof Error ? error.message : String(error) },
          'Failed to delete user message with sensitive config value',
        )
      }
    } else {
      response += SENSITIVE_DELETE_WARNING
    }
  }

  const buttons = result.buttons
  if (buttons !== undefined && buttons.length > 0) {
    const chatButtons: ChatButton[] = buttons.map((btn) => ({
      text: btn.text,
      callbackData: serializeCallbackData(btn, storageContextId),
      style: btn.style ?? 'primary',
    }))
    await reply.buttons(response, { buttons: chatButtons })
    return true
  }

  if (response !== '') {
    await reply.text(response)
  }
  return true
}
