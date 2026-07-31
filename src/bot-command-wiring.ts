// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import {
  buildAnalyticsSourceContext,
  buildAuthCheckedFact,
  buildChatMessageAcceptedFact,
  commandPropOf,
  createAuthorizedTurnSeed,
} from './analytics/bot-observer.js'
import type { AnalyticsObserver } from './analytics/runtime.js'
import type { AnalyticsSourceContext } from './analytics/source-facts.js'
import { checkAuthorizationExtended } from './auth.js'
import { recordGroupObservation } from './bot-group-observation.js'
import { createReplyDeliveryTracker, emitReplyCompletedIfNeeded, trackReplyUsage } from './bot-reply-tracking.js'
import { replyToUnauthorized } from './bot-unauthorized-reply.js'
import { supportsFileReplies } from './chat/capabilities.js'
import { userManagesAuthorizedGroupLive } from './chat/group-admin-live.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn } from './chat/types.js'
import {
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerDashboardCommand,
  registerHelpCommand,
  registerStartCommand,
  registerStopCommand,
} from './commands/index.js'
import { registerPluginCommands } from './plugins/command-contributions.js'

function resolveMessageAuth(msg: IncomingMessage): AuthorizationResult {
  return checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.threadId,
    msg.user.isAdmin,
    msg.platformInstanceId,
  )
}

// A denied DM user who can manage a group (auth.configCommandAllowed) is still
// allowed to launch the settings UI via /config, but nothing else.
function isConfigLaunchBypass(commandName: string, auth: AuthorizationResult): boolean {
  return commandName === 'config' && auth.configCommandAllowed === true
}

// Cold-DM fallback: the local observation check found nothing, so ask the platform
// whether this DM user administers any authorized group before denying /config.
async function resolveCommandAuth(
  chat: ChatProvider,
  commandName: string,
  msg: IncomingMessage,
): Promise<AuthorizationResult> {
  const auth = resolveMessageAuth(msg)
  if (auth.allowed || isConfigLaunchBypass(commandName, auth)) return auth
  if (commandName !== 'config' || msg.contextType !== 'dm') return auth
  const canManage = await userManagesAuthorizedGroupLive(chat, msg.user.id, msg.platformInstanceId)
  return canManage ? { ...auth, configCommandAllowed: true } : auth
}

function observeCommandAccepted(
  observer: AnalyticsObserver,
  source: AnalyticsSourceContext,
  msg: IncomingMessage,
  commandName: string,
): void {
  const seed = createAuthorizedTurnSeed(source, msg, 0, {
    nowMs: () => Date.now(),
    nowMonotonicMs: () => performance.now(),
  })
  observer.observe(buildChatMessageAcceptedFact(seed, { isCommand: true, command: commandPropOf(commandName) }))
}

function createObservedCommandHandler(
  chat: ChatProvider,
  commandName: string,
  handler: (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void>,
  analyticsObserver?: AnalyticsObserver,
): (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void> {
  return async (msg, reply, _auth): Promise<void> => {
    const start = Date.now()
    const startMonotonicMs = performance.now()
    const auth = await resolveCommandAuth(chat, commandName, msg)
    const source = analyticsObserver === undefined ? null : buildAnalyticsSourceContext(msg, auth, 'command', null)
    if (analyticsObserver !== undefined && source !== null) {
      analyticsObserver.observe(buildAuthCheckedFact(source, auth))
    }
    const delivery =
      analyticsObserver !== undefined && source !== null ? createReplyDeliveryTracker(startMonotonicMs) : undefined
    const tracked = trackReplyUsage(reply, supportsFileReplies(chat), delivery)
    const replyAnalytics =
      analyticsObserver !== undefined && source !== null
        ? { observer: analyticsObserver, source, sourceEventId: randomUUID() }
        : undefined
    if (!auth.allowed && !isConfigLaunchBypass(commandName, auth)) {
      await replyToUnauthorized(tracked.reply, auth, msg.contextId)
      emitReplyCompletedIfNeeded(tracked, msg.user.id, auth.storageContextId, start)
      return
    }
    if (analyticsObserver !== undefined && source !== null)
      observeCommandAccepted(analyticsObserver, source, msg, commandName)
    if (msg.contextType === 'group' && auth.isGroupAdmin) recordGroupObservation(chat, msg)
    await handler(msg, tracked.reply, auth)
    emitReplyCompletedIfNeeded(tracked, msg.user.id, auth.storageContextId, start, undefined, replyAnalytics)
  }
}

function createObservedChatProvider(chat: ChatProvider, analyticsObserver?: AnalyticsObserver): ChatProvider {
  const registerCommand = chat.registerCommand.bind(chat)
  return new Proxy(chat, {
    get(target, prop: keyof ChatProvider) {
      if (prop === 'registerCommand') {
        return (name: string, handler: (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void>) => {
          registerCommand(name, createObservedCommandHandler(chat, name, handler, analyticsObserver))
        }
      }
      return target[prop]
    },
  })
}

export function registerCommands(chat: ChatProvider, adminUserId: string, analyticsObserver?: AnalyticsObserver): void {
  const observedChat = createObservedChatProvider(chat, analyticsObserver)
  registerHelpCommand(observedChat)
  registerStartCommand(observedChat)
  registerConfigCommand(observedChat)
  registerContextCommand(observedChat)
  registerClearCommand(observedChat, undefined, adminUserId)
  registerDashboardCommand(observedChat)
  registerStopCommand(observedChat, analyticsObserver)
  registerPluginCommands(observedChat)
}
