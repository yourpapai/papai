// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatButton, ReplyFn } from './chat/types.js'
import { logger } from './logger.js'
import { hasActiveWizard, processWizardMessage } from './wizard/index.js'

const log = logger.child({ scope: 'wizard-integration' })

const SENSITIVE_DELETE_WARNING =
  '\n\n⚠️ This platform does not support automatic deletion of messages. Please manually delete your previous message containing the secret value.'

const getWizardButtonStyle = (action: string): 'primary' | 'secondary' | 'danger' => {
  if (action === 'cancel') {
    return 'danger'
  }
  if (action === 'skip_small_model' || action === 'skip_embedding') {
    return 'secondary'
  }
  return 'primary'
}

const getWizardContextSuffix = (targetContextId: string | undefined): string => {
  if (targetContextId === undefined) {
    return ''
  }
  return `@${Buffer.from(targetContextId).toString('base64url')}`
}

function getWizardButtons(
  buttons: NonNullable<Awaited<ReturnType<typeof processWizardMessage>>['buttons']>,
  targetContextId: string | undefined,
): ChatButton[] {
  const contextSuffix = getWizardContextSuffix(targetContextId)
  return buttons.map((button) => ({
    text: button.text,
    callbackData: `wizard_${button.action}${contextSuffix}`,
    style: getWizardButtonStyle(button.action),
  }))
}

export async function handleWizardMessage(
  userId: string,
  storageContextId: string,
  text: string,
  reply: ReplyFn,
  supportsInteractiveButtons: boolean,
  targetContextId?: string,
  messageId?: string,
): Promise<boolean> {
  if (!hasActiveWizard(userId, storageContextId)) {
    return false
  }

  const wizardResult = await processWizardMessage(userId, storageContextId, text)
  if (!wizardResult.handled) {
    return false
  }

  let response = wizardResult.response ?? ''
  if (wizardResult.isSensitiveKey === true) {
    if (reply.deleteMessage !== undefined && messageId !== undefined) {
      try {
        await reply.deleteMessage(messageId)
        log.info({ userId, messageId }, 'Deleted user message containing sensitive wizard value')
      } catch (error) {
        log.warn(
          { userId, messageId, error: error instanceof Error ? error.message : String(error) },
          'Failed to delete user message with sensitive wizard value',
        )
      }
    } else {
      response += SENSITIVE_DELETE_WARNING
    }
  }

  const buttons = wizardResult.buttons
  const shouldShowButtons = supportsInteractiveButtons && buttons !== undefined && buttons.length > 0
  if (shouldShowButtons && buttons !== undefined) {
    await reply.buttons(response, { buttons: getWizardButtons(buttons, targetContextId) })
    return true
  }

  if (response !== '') {
    await reply.text(response)
  }
  return true
}
