// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability, ChatProvider, CommandHandler, ContextType } from '../chat/types.js'
import { getDictionary, type Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { getContextLanguage } from '../utils/config-language.js'

const log = logger.child({ scope: 'commands:help' })

function getDmHelpText(isAdmin: boolean, locale: Locale): string {
  const texts = getDictionary(locale).commands.help
  return isAdmin ? texts.dmUser + texts.dmAdmin : texts.dmUser
}

function getGroupHelpText(isGroupAdmin: boolean, locale: Locale): string {
  const texts = getDictionary(locale).commands.help
  return isGroupAdmin ? texts.groupUser + texts.groupAdmin : texts.groupUser
}

export function buildHelpText(
  _capabilities: ReadonlySet<ChatCapability>,
  contextType: ContextType,
  opts: { isBotAdmin: boolean; isGroupAdmin: boolean },
  locale: Locale = 'en',
): string {
  return contextType === 'dm' ? getDmHelpText(opts.isBotAdmin, locale) : getGroupHelpText(opts.isGroupAdmin, locale)
}

export function registerHelpCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    log.info({ userId: msg.user.id, contextType: msg.contextType }, '/help command executed')

    const helpText = buildHelpText(
      chat.capabilities,
      msg.contextType,
      {
        isBotAdmin: auth.isBotAdmin,
        isGroupAdmin: auth.isGroupAdmin,
      },
      getContextLanguage(auth.configContextId ?? auth.storageContextId),
    )
    await reply.text(helpText)
  }

  chat.registerCommand('help', handler)
}
