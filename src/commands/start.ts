// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { replyToUnauthorized } from '../bot-unauthorized-reply.js'
import { maybePostLanguagePicker } from '../chat/language-picker.js'
import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { t } from '../i18n/index.js'
import { logger } from '../logger.js'
import { getContextLanguage } from '../utils/config-language.js'

const log = logger.child({ scope: 'commands:start' })

export function registerStartCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) {
      await replyToUnauthorized(reply, auth, msg.contextId)
      return
    }

    log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/start command executed')

    await maybePostLanguagePicker(chat, msg, reply, auth)
    await reply.formatted(
      t('commands.start.welcome', getContextLanguage(auth.configContextId ?? auth.storageContextId)),
    )
  }

  chat.registerCommand('start', handler)
}
