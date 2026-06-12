// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toSourceProvider, type StagedFileDownloadFn } from './attachments/types.js'
import { checkAuthorizationExtended, getThreadScopedStorageContextId } from './auth.js'
import {
  findVoiceStagedIds,
  resolveMessageAttachments,
  resolveVoiceStagedFiles,
  stageGroupFileCandidates,
} from './bot-attachments.js'
import { recordGroupObservation } from './bot-group-observation.js'
import { emitReplyCompletedIfNeeded, trackReplyUsage } from './bot-reply-tracking.js'
import { supportsFileReplies } from './chat/capabilities.js'
import { routeInteraction } from './chat/interaction-router.js'
import { resolveSourceProviderName } from './chat/source-instance.js'
import type { AuthorizationResult, ChatProvider, IncomingInteraction, IncomingMessage, ReplyFn } from './chat/types.js'
import {
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerDashboardCommand,
  registerHelpCommand,
  registerStartCommand,
} from './commands/index.js'
import { emitUser } from './debug/event-bus.js'
import type { ProcessMessageFn } from './llm-orchestrator-process-args.js'
import { defaultDeps, processMessage as defaultProcessMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { enqueueMessage } from './message-queue/index.js'
import type { CoalescedItem as QueuedCoalescedItem } from './message-queue/index.js'
import { registerPluginCommands } from './plugins/command-contributions.js'
import { buildPromptWithReplyContext } from './reply-context.js'

type EnqueueMessageFn = typeof enqueueMessage
const initializedChats = new WeakSet<ChatProvider>()
export type BotDeps = Readonly<{ processMessage: ProcessMessageFn }> &
  Readonly<Partial<Record<'stagedDownloadFn', StagedFileDownloadFn> & Record<'enqueueMessage', EnqueueMessageFn>>>
const defaultBotDeps: BotDeps = {
  processMessage: defaultProcessMessage,
  enqueueMessage,
}
const log = logger.child({ scope: 'bot' })
export { checkAuthorizationExtended, getThreadScopedStorageContextId }
function getUnauthorizedReplyText(auth: AuthorizationResult, groupId: string): string | null {
  if (auth.reason === 'group_not_allowed')
    return `This group (${groupId}) is not authorized to use this bot. Ask the bot admin to authorize it in the settings web UI — they can open it with \`/config\` in a DM.`
  if (auth.reason === 'group_member_not_allowed')
    return "You're not authorized to use this bot in this group. Ask a group admin to add you in the settings web UI — they can open it with `/config` in a DM."
  if (auth.reason === 'dm_not_allowed') return 'You are not authorized to use this bot.'
  return null
}
async function replyToUnauthorized(reply: ReplyFn, auth: AuthorizationResult, groupId: string): Promise<void> {
  const message = getUnauthorizedReplyText(auth, groupId)
  if (message !== null) await reply.text(message)
}
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
function createObservedCommandHandler(
  chat: ChatProvider,
  handler: (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void>,
): (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void> {
  return async (msg, reply, _auth): Promise<void> => {
    const start = Date.now()
    const tracked = trackReplyUsage(reply, supportsFileReplies(chat))
    const auth = resolveMessageAuth(msg)
    if (!auth.allowed) {
      await replyToUnauthorized(tracked.reply, auth, msg.contextId)
      emitReplyCompletedIfNeeded(tracked, msg.user.id, auth.storageContextId, start)
      return
    }
    if (msg.contextType === 'group' && auth.isGroupAdmin) recordGroupObservation(chat, msg)
    await handler(msg, tracked.reply, auth)
    emitReplyCompletedIfNeeded(tracked, msg.user.id, auth.storageContextId, start)
  }
}
function createObservedChatProvider(chat: ChatProvider): ChatProvider {
  const registerCommand = chat.registerCommand.bind(chat)
  return new Proxy(chat, {
    get(target, prop: keyof ChatProvider) {
      if (prop === 'registerCommand') {
        return (name: string, handler: (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void>) => {
          registerCommand(name, createObservedCommandHandler(chat, handler))
        }
      }
      return target[prop]
    },
  })
}
function registerCommands(chat: ChatProvider, adminUserId: string): void {
  const observedChat = createObservedChatProvider(chat)
  registerHelpCommand(observedChat)
  registerStartCommand(observedChat)
  registerConfigCommand(observedChat)
  registerContextCommand(observedChat)
  registerClearCommand(observedChat, undefined, adminUserId)
  registerDashboardCommand(observedChat)
  registerPluginCommands(observedChat)
}
async function processCoalescedMessage(coalescedItem: QueuedCoalescedItem, deps: BotDeps): Promise<void> {
  const start = Date.now()
  const tracked = trackReplyUsage(coalescedItem.reply, true)
  try {
    const voiceAttachmentIds = await resolveVoiceStagedFiles(
      coalescedItem.storageContextId,
      coalescedItem.voiceStagedIds,
      deps.stagedDownloadFn,
    )
    await deps.processMessage(
      tracked.reply,
      coalescedItem.storageContextId,
      coalescedItem.userId,
      coalescedItem.username,
      coalescedItem.text,
      coalescedItem.contextType,
      coalescedItem.configContextId,
      { ...defaultDeps, stagedDownloadFn: deps.stagedDownloadFn },
      [...voiceAttachmentIds, ...coalescedItem.newAttachmentIds],
      coalescedItem.turnId,
    )
  } finally {
    emitReplyCompletedIfNeeded(tracked, coalescedItem.userId, coalescedItem.storageContextId, start)
  }
}
function shouldIgnoreGroupMessage(msg: IncomingMessage): boolean {
  if (msg.contextType !== 'group') return false
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return false
  return !msg.isMentioned && msg.isReplyToBot !== true
}
async function handleMessage(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: BotDeps,
): Promise<void> {
  if (!auth.allowed) {
    if (msg.isMentioned) await replyToUnauthorized(reply, auth, msg.contextId)
    return
  }
  if (shouldIgnoreGroupMessage(msg)) return
  const voiceStagedIds = findVoiceStagedIds(auth.storageContextId, msg.messageId)
  const { newAttachmentIds, activeAttachments } = await resolveMessageAttachments(chat, msg, auth.storageContextId)
  let queueMessage = enqueueMessage
  if (deps.enqueueMessage !== undefined) queueMessage = deps.enqueueMessage
  queueMessage(
    {
      text: buildPromptWithReplyContext(msg, activeAttachments, auth.storageContextId),
      userId: msg.user.id,
      username: msg.user.username,
      storageContextId: auth.storageContextId,
      configContextId: auth.configContextId,
      contextType: msg.contextType,
      newAttachmentIds,
      voiceStagedIds,
    },
    reply,
    (coalescedItem): Promise<void> => processCoalescedMessage(coalescedItem, deps),
  )
}
function willQueueAuthorizedMessage(msg: IncomingMessage, auth: AuthorizationResult): boolean {
  if (!auth.allowed) return false
  if (msg.contextType !== 'group') return true
  if (msg.commandMatch !== undefined) return true
  return msg.isMentioned || msg.isReplyToBot === true
}
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
  if (auth.allowed) recordGroupObservation(chat, msg)
  tryStageGroupCandidates(chat, msg, auth.storageContextId)
  await handleMessage(chat, msg, tracked.reply, auth, deps)
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
  registerCommands(chat, adminUserId)
  chat.onMessage((msg, reply): Promise<void> => onIncomingMessage(chat, msg, reply, deps))
  if (chat.onInteraction !== undefined)
    chat.onInteraction((interaction, reply): Promise<void> => routeIncomingInteraction(interaction, reply))
  initializedChats.add(chat)
}
