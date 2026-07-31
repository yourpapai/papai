// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getFeatureObserver } from '../analytics/feature-observer.js'
import type { AnalyticsRequestContext } from '../analytics/provider-observer.js'
import { buildChatCommandRequestContext } from '../analytics/provider-scope-factory.js'
import type { ChatProvider, CommandHandler, IncomingMessage, AuthorizationResult } from '../chat/types.js'
import { logger } from '../logger.js'
import { issueSettingsLink } from '../settings/issue-link.js'

const log = logger.child({ scope: 'commands:config' })

const GROUP_CONFIG_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.'
const GROUP_CONFIG_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'
const NOT_CONFIGURED =
  'The settings UI is not configured on this deployment. Ask the administrator to set SETTINGS_PUBLIC_BASE_URL.'

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
      const observer = getFeatureObserver()
      const requestContext = commandMilestoneContext(msg, auth)
      if (observer !== null && requestContext !== null) observer.configLinkIssued(requestContext, 'issued')
      return
    }
    if (link.kind === 'rate_limited') {
      const minutes = Math.max(1, Math.ceil(link.retryAfterSec / 60))
      await reply.text(`Too many settings links requested. Please try again in ${minutes} minute(s).`)
      const observer = getFeatureObserver()
      const requestContext = commandMilestoneContext(msg, auth)
      if (observer !== null && requestContext !== null) {
        observer.configLinkIssued(requestContext, 'rate_limited')
        observer.rateLimitBlocked(requestContext, 'settings_link')
      }
      return
    }

    log.warn({ userId: msg.user.id }, '/config requested but settings UI is not configured')
    await reply.text(NOT_CONFIGURED)
    const observer = getFeatureObserver()
    const requestContext = commandMilestoneContext(msg, auth)
    if (observer !== null && requestContext !== null) {
      observer.configLinkIssued(requestContext, 'not_configured')
      observer.unconfiguredReply(requestContext, { missing: 'settings_base_url', surface: 'chat' })
    }
  }

  chat.registerCommand('config', handler)
}
