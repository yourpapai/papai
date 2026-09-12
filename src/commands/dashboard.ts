// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { getClaimTtlSeconds, issueClaim } from '../dashboard-auth/index.js'
import { t } from '../i18n/index.js'
import { logger } from '../logger.js'
import { getSettingsPublicBaseUrl } from '../settings/config.js'
import { getContextLanguage } from '../utils/config-language.js'

const log = logger.child({ scope: 'commands:dashboard' })

const defaultBaseUrl = (): string => {
  const explicit = process.env['DASHBOARD_BASE_URL']
  if (explicit !== undefined && explicit !== '') return explicit.replace(/\/$/u, '')
  const settingsBase = getSettingsPublicBaseUrl()
  if (settingsBase !== null) return settingsBase
  const host = process.env['DEBUG_HOSTNAME'] ?? '127.0.0.1'
  const port = process.env['DEBUG_PORT'] ?? '9100'
  return `http://${host}:${port}`
}

const isDebugServerEnabled = (): boolean => process.env['DEBUG_SERVER'] === 'true'

export const registerDashboardCommand = (chat: Readonly<ChatProvider>): void => {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return
    const locale = getContextLanguage(auth.configContextId ?? auth.storageContextId)

    if (msg.contextType !== 'dm') {
      await reply.text(t('commands.dashboard.dmOnly', locale))
      return
    }
    if (!auth.isBotAdmin) {
      await reply.text(t('commands.dashboard.adminOnly', locale))
      return
    }
    if (!isDebugServerEnabled()) {
      await reply.text(t('commands.dashboard.disabled', locale))
      return
    }

    const adminUserId = msg.user.id
    if (adminUserId === '') {
      log.error('dashboard command: msg.user.id missing')
      await reply.text(t('commands.dashboard.userIdMissing', locale))
      return
    }

    let claim: { nonce: string }
    try {
      claim = issueClaim(adminUserId, msg.platformInstanceId)
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'dashboard command: issueClaim failed',
      )
      await reply.text(t('commands.dashboard.issueFailed', locale))
      return
    }

    const url = `${defaultBaseUrl()}/auth/claim?n=${claim.nonce}`
    const ttlMinutes = Math.round(getClaimTtlSeconds() / 60)
    await reply.formatted(t('commands.dashboard.claimLink', locale, { url, ttlMinutes }), {
      disableLinkPreview: true,
    })
  }

  chat.registerCommand('dashboard', handler)
}
