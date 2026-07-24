// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildAnalyticsSourceContext, buildAuthCheckedFact } from './analytics/bot-observer.js'
import { toSourceProvider } from './attachments/types.js'
import { checkAuthorizationExtended, getThreadScopedStorageContextId } from './auth.js'
import { stageGroupFileCandidates } from './bot-attachments.js'
import { registerCommands } from './bot-command-wiring.js'
import { recordGroupObservation } from './bot-group-observation.js'
import { resolveMessageAuth } from './bot-guards.js'
import { cacheObservedIncomingMessage } from './bot-message-caching.js'
import { handleAuthorizedMessage, type BotDeps } from './bot-message-handler.js'
import { emitReplyCompletedIfNeeded, trackReplyUsage } from './bot-reply-tracking.js'
import { replyToUnauthorized } from './bot-unauthorized-reply.js'
import { supportsFileReplies } from './chat/capabilities.js'
import { routeInteraction } from './chat/interaction-router.js'
import { willQueueAuthorizedMessage } from './chat/queue-policy.js'
import { resolveSourceProviderName } from './chat/source-instance.js'
import type { ChatProvider, IncomingInteraction, IncomingMessage, ReplyFn } from './chat/types.js'
import { emitUser } from './debug/event-bus.js'
import { processMessage as defaultProcessMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { onIncomingEdit } from './message-edit/handle.js'
import { enqueueMessage } from './message-queue/index.js'

const initializedChats = new WeakSet<ChatProvider>()
export type { BotDeps } from './bot-message-handler.js'
const defaultBotDeps: BotDeps = {
  processMessage: defaultProcessMessage,
  enqueueMessage,
}
const log = logger.child({ scope: 'bot' })
export { checkAuthorizationExtended, getThreadScopedStorageContextId }
function tryStageGroupCandidates(chat: ChatProvider, msg: IncomingMessage, storageContextId: string): void {
  if (msg.contextType !== 'group' || msg.fileCandidates === undefined || msg.fileCandidates.length === 0) return
  try {
    stageGroupFileCandidates({
      storageContextId,
      msg,
      sourceProvider: toSourceProvider(resolveSourceProviderName(chat, msg.platformInstanceId)),
    })
  } catch (error: unknown) {
    log.warn(
      {
        storageContextId,
        messageId: msg.messageId,
        candidateCount: msg.fileCandidates.length,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to stage group file candidates',
    )
  }
}

async function onIncomingMessage(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  deps: BotDeps,
): Promise<void> {
  const start = Date.now()
  const tracked = trackReplyUsage(reply, supportsFileReplies(chat))
  emitUser('message:received', msg.user.id, {
    contextId: msg.contextId,
    contextType: msg.contextType,
    threadId: msg.threadId,
    textLength: msg.text.length,
    isCommand: msg.text.startsWith('/'),
  })
  const auth = resolveMessageAuth(msg)
  emitUser('auth:check', msg.user.id, {
    allowed: auth.allowed,
    isBotAdmin: auth.isBotAdmin,
    isGroupAdmin: auth.isGroupAdmin,
    storageContextId: auth.storageContextId,
  })
  const observer = deps.analyticsObserver
  if (observer !== undefined) {
    const source = buildAnalyticsSourceContext(msg, auth, 'normal', null)
    if (source !== null) observer.observe(buildAuthCheckedFact(source, auth))
  }
  if (auth.allowed) recordGroupObservation(chat, msg)
  cacheObservedIncomingMessage(msg, auth)
  tryStageGroupCandidates(chat, msg, auth.storageContextId)
  await handleAuthorizedMessage(chat, msg, tracked.reply, auth, deps)
  if (!willQueueAuthorizedMessage(msg, auth))
    emitReplyCompletedIfNeeded(tracked, msg.user.id, auth.storageContextId, start)
}
async function routeIncomingInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<void> {
  try {
    const auth = checkAuthorizationExtended(
      interaction.user.id,
      interaction.user.username,
      interaction.contextId,
      interaction.contextType,
      interaction.threadId,
      interaction.user.isAdmin,
      interaction.platformInstanceId,
    )
    if (!auth.allowed) {
      await replyToUnauthorized(reply, auth, interaction.contextId)
      return
    }
    await routeInteraction(interaction, reply, auth)
  } catch (error) {
    logger.error(
      {
        callbackData: interaction.callbackData,
        userId: interaction.user.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Interaction routing failed',
    )
    await reply.text('❌ Something went wrong processing your action. Please try again.')
  }
}
export function setupBot(chat: ChatProvider, adminUserId: string): void
export function setupBot(chat: ChatProvider, adminUserId: string, depsInput: BotDeps): void
export function setupBot(chat: ChatProvider, adminUserId: string, ...rest: [] | [BotDeps]): void {
  const deps = rest.length === 0 ? defaultBotDeps : rest[0]
  if (initializedChats.has(chat)) return
  registerCommands(chat, adminUserId, deps.analyticsObserver)
  chat.onMessage((msg, reply): Promise<void> => onIncomingMessage(chat, msg, reply, deps))
  if (chat.onMessageEdit !== undefined)
    chat.onMessageEdit((msg, reply): Promise<void> => onIncomingEdit(chat, msg, reply, deps))
  if (chat.onInteraction !== undefined)
    chat.onInteraction((interaction, reply): Promise<void> => routeIncomingInteraction(interaction, reply))
  initializedChats.add(chat)
}
