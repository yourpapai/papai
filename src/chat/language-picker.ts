// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigValue, setConfigValue, unsetConfigValue } from '../config.js'
import { t } from '../i18n/index.js'
import { logger } from '../logger.js'
import { resolveSourceChatProvider } from './source-instance.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:language-picker' })

/**
 * First-interaction language picker.
 *
 * Posts a two-button `lang:en` / `lang:ru` prompt (routed by
 * `src/chat/interaction-router.ts`) the first time an authorized, non-guest
 * actor talks to the bot from a config context that has no stored `language`
 * and no `language_prompted` marker. Buttonless platforms (Kontur Talk) skip
 * the picker entirely; the marker is set synchronously before the send (and
 * rolled back on failure) so the guard window contains no await — concurrent
 * first messages cannot double-post, and the bot asks at most once per context.
 *
 * Best-effort: a send failure is logged and swallowed — it must never block
 * the user's actual message. Returns true when the picker was posted.
 */
export async function maybePostLanguagePicker(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean> {
  try {
    return await postLanguagePicker(chat, msg, reply, auth)
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Language picker post failed; continuing turn',
    )
    return false
  }
}

async function postLanguagePicker(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean> {
  if (!auth.allowed || auth.isGuest === true) return false
  if (!resolveSourceChatProvider(chat, msg.platformInstanceId).capabilities.has('messages.buttons')) return false

  const configContextId = auth.configContextId ?? auth.storageContextId
  if (getConfigValue(configContextId, 'language') !== null) return false
  if (getConfigValue(configContextId, 'language_prompted') !== null) return false

  setConfigValue(configContextId, 'language_prompted', '1')
  try {
    await reply.buttons(t('picker.prompt'), {
      buttons: [
        { text: t('picker.english'), callbackData: 'lang:en' },
        { text: t('picker.russian'), callbackData: 'lang:ru' },
      ],
    })
  } catch (error) {
    unsetConfigValue(configContextId, 'language_prompted')
    throw error
  }
  log.info({ configContextId }, 'Language picker posted (first interaction)')
  return true
}
