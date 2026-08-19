// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getFeatureObserver } from '../analytics/feature-observer.js'
import type { AnalyticsRequestContext } from '../analytics/provider-observer.js'
import { buildChatCommandRequestContext } from '../analytics/provider-scope-factory.js'
import type { ChatProvider, CommandHandler, IncomingMessage, AuthorizationResult } from '../chat/types.js'
import { t } from '../i18n/index.js'
import { logger } from '../logger.js'
import { issueSettingsLink } from '../settings/issue-link.js'
import { getContextLanguage } from '../utils/config-language.js'

const log = logger.child({ scope: 'commands:config' })

/** Pure milestone context for the command path; null when the platform is unresolvable or analytics is off. */
const commandMilestoneContext = (msg: IncomingMessage, auth: AuthorizationResult): AnalyticsRequestContext | null =>
  buildChatCommandRequestContext({
    platformInstanceId: msg.platformInstanceId,
    chatUserId: msg.user.id,
    nativeContextId: msg.contextId,
    storageContextId: auth.storageContextId,
    configContextId: auth.configContextId ?? auth.storageContextId,
    contextType: msg.contextType,
    actorRole: auth.isBotAdmin ? 'admin' : 'member',
  })

export function registerConfigCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    // A user who can manage a group is otherwise denied in DM but may still
    // launch /config to reach the settings UI (auth.configCommandAllowed).
    if (!auth.allowed && auth.configCommandAllowed !== true) return

    const locale = getContextLanguage(auth.configContextId ?? auth.storageContextId)
    if (msg.contextType === 'group') {
      await reply.text(
        auth.isGroupAdmin ? t('commands.config.groupRedirect', locale) : t('commands.config.groupAdminOnly', locale),
      )
      return
    }

    const link = issueSettingsLink({ platformInstanceId: msg.platformInstanceId, platformUserId: msg.user.id })
    if (link.kind === 'ok') {
      log.info({ userId: msg.user.id }, '/config issued settings link')
      await reply.formatted(t('commands.config.linkIssued', locale, { url: link.url }))
      const observer = getFeatureObserver()
      const requestContext = commandMilestoneContext(msg, auth)
      if (observer !== null && requestContext !== null) observer.configLinkIssued(requestContext, 'issued')
      return
    }
    if (link.kind === 'rate_limited') {
      const minutes = Math.max(1, Math.ceil(link.retryAfterSec / 60))
      await reply.text(t('commands.config.rateLimited', locale, { minutes }))
      const observer = getFeatureObserver()
      const requestContext = commandMilestoneContext(msg, auth)
      if (observer !== null && requestContext !== null) {
        observer.configLinkIssued(requestContext, 'rate_limited')
        observer.rateLimitBlocked(requestContext, 'settings_link')
      }
      return
    }

    log.warn({ userId: msg.user.id }, '/config requested but settings UI is not configured')
    await reply.text(t('commands.config.notConfigured', locale))
    const observer = getFeatureObserver()
    const requestContext = commandMilestoneContext(msg, auth)
    if (observer !== null && requestContext !== null) {
      observer.configLinkIssued(requestContext, 'not_configured')
      observer.unconfiguredReply(requestContext, { missing: 'settings_base_url', surface: 'chat' })
    }
  }

  chat.registerCommand('config', handler)
}
