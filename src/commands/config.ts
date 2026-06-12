// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { issueSettingsLink } from '../settings/issue-link.js'

const log = logger.child({ scope: 'commands:config' })

const GROUP_CONFIG_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.'
const GROUP_CONFIG_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'
const NOT_CONFIGURED =
  'The settings UI is not configured on this deployment. Ask the administrator to set SETTINGS_PUBLIC_BASE_URL.'

export function registerConfigCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType === 'group') {
      await reply.text(auth.isGroupAdmin ? GROUP_CONFIG_REDIRECT : GROUP_CONFIG_ADMIN_ONLY)
      return
    }

    const link = issueSettingsLink({ platformInstanceId: msg.platformInstanceId, platformUserId: msg.user.id })
    if (link.kind === 'ok') {
      log.info({ userId: msg.user.id }, '/config issued settings link')
      await reply.formatted(
        `🔧 Open your settings: ${link.url}\n\n⚠️ This link is single-use and expires in 10 minutes. Do not share it.`,
      )
      return
    }
    if (link.kind === 'rate_limited') {
      const minutes = Math.max(1, Math.ceil(link.retryAfterSec / 60))
      await reply.text(`Too many settings links requested. Please try again in ${minutes} minute(s).`)
      return
    }

    log.warn({ userId: msg.user.id }, '/config requested but settings UI is not configured')
    await reply.text(NOT_CONFIGURED)
  }

  chat.registerCommand('config', handler)
}
