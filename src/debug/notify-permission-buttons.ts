// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'

import { escapeMarkdown } from '../chat/permission-prompt.js'
import type { ChatRouter } from '../chat/router.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ChatButton, DeferredDeliveryTarget } from '../chat/types.js'
import { logger } from '../logger.js'
import { kvSet } from '../plugins/store.js'
import type { NotifyBody } from './notify-route.js'

const log = logger.child({ scope: 'debug:notify-permission-buttons' })

export const PERMISSION_KV_PLUGIN_ID = 'nerv-magi-permission'

const buildPermissionPrompt = (title: string): string => `🔐 ${escapeMarkdown(title)}?`

/**
 * Renders Allow/Deny buttons for a `needs_permission` notify and parks the ask under a short kv
 * id keyed to this notify's callback data, so a later `mperm:` click can resolve it back to magi.
 * Returns false (never sends anything else) whenever buttons aren't usable — missing
 * `magiSessionId`/`toolCallId`, an unsupported provider, a failed send, or a throw — so the
 * caller can fall through to the ordinary markdown post instead.
 */
export const tryPermissionButtons = async (
  chat: { sendProactiveButtonsReturningId: ChatRouter['sendProactiveButtonsReturningId'] },
  platformInstanceId: string,
  target: DeferredDeliveryTarget,
  body: NotifyBody,
): Promise<boolean> => {
  const { magiSessionId, toolCallId } = body
  if (magiSessionId === undefined || toolCallId === undefined) return false
  const cbid = randomBytes(6).toString('base64url')
  const prompt = buildPermissionPrompt(body.title ?? body.markdown)
  const buttons: ChatButton[] = [
    { text: '✅ Allow', callbackData: `mperm:a:${cbid}`, style: 'primary' },
    { text: '🚫 Deny', callbackData: `mperm:d:${cbid}`, style: 'danger' },
  ]
  let outcome: { delivered: boolean; messageId: string | null; supported: boolean }
  try {
    outcome = await chat.sendProactiveButtonsReturningId(platformInstanceId, target, prompt, buttons)
  } catch (error: unknown) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'permission button send threw; falling back',
    )
    return false
  }
  if (!outcome.supported || !outcome.delivered) return false
  const configContextId = getConfigContextIdFromStorageContextId(body.contextId)
  kvSet(PERMISSION_KV_PLUGIN_ID, configContextId, cbid, JSON.stringify({ sessionId: magiSessionId, toolCallId }))
  return true
}
