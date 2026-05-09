import { checkAuthorizationExtended, getThreadScopedStorageContextId } from './auth.js'
import { emitReplyCompletedIfNeeded, trackReplyUsage } from './bot-reply-tracking.js'
import { maybeInterceptWizard } from './bot-settings.js'
import { supportsFileReplies, supportsInteractiveButtons } from './chat/capabilities.js'
import { routeInteraction } from './chat/interaction-router.js'
import type { AuthorizationResult, ChatProvider, IncomingFile, IncomingMessage, ReplyFn } from './chat/types.js'
import {
  registerAdminCommands,
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerGroupCommand,
  registerHelpCommand,
  registerSetupCommand,
  registerStartCommand,
} from './commands/index.js'
import { getAllConfig } from './config.js'
import { emit } from './debug/event-bus.js'
import { clearIncomingFiles, storeIncomingFiles } from './file-relay.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from './group-settings/registry.js'
import { processMessage as defaultProcessMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { enqueueMessage } from './message-queue/index.js'
import type { CoalescedItem as QueuedCoalescedItem } from './message-queue/index.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'
import { createWizard, hasActiveWizard } from './wizard/index.js'
import { getWizardSteps } from './wizard/steps.js'
type ProcessMessageFn = (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  userText: string,
  contextType: 'dm' | 'group',
  configContextId: string | undefined,
) => Promise<void>
export interface BotDeps {
  processMessage: ProcessMessageFn
}
const defaultBotDeps: BotDeps = { processMessage: defaultProcessMessage }
const log = logger.child({ scope: 'bot' })
const checkAuthorization = (userId: string, username: string | null | undefined): boolean => {
  log.debug({ userId }, 'Checking authorization')
  if (isAuthorized(userId)) return true
  if (username !== undefined && username !== null && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}
export { checkAuthorizationExtended, getThreadScopedStorageContextId }
function getUnauthorizedReplyText(auth: AuthorizationResult): string | null {
  if (auth.reason === 'group_not_allowed')
    return 'This group is not authorized to use this bot. Ask the bot admin to run `/group add <group-id>` in a DM with the bot.'
  if (auth.reason === 'group_member_not_allowed')
    return "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser <user-id|@username>`"
  if (auth.reason === 'dm_not_allowed') return 'You are not authorized to use this bot.'
  return null
}
async function replyToUnauthorized(reply: ReplyFn, auth: AuthorizationResult): Promise<void> {
  const message = getUnauthorizedReplyText(auth)
  if (message !== null) await reply.text(message)
}
function shouldDeferUnauthorizedDmCommand(commandName: string, msg: IncomingMessage): boolean {
  if (msg.contextType !== 'dm') return false
  if (commandName === 'group') return true
  if (commandName === 'groups') return true
  return false
}
function resolveMessageAuth(msg: IncomingMessage): AuthorizationResult {
  return checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.threadId,
    msg.user.isAdmin,
  )
}
function createObservedCommandHandler(
  chat: ChatProvider,
  commandName: string,
  handler: (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void>,
): (m: IncomingMessage, r: ReplyFn, a: AuthorizationResult) => Promise<void> {
  return async (msg, reply, _auth): Promise<void> => {
    const start = Date.now()
    const tracked = trackReplyUsage(reply, supportsFileReplies(chat))
    const auth = resolveMessageAuth(msg)
    if (!auth.allowed) {
      if (shouldDeferUnauthorizedDmCommand(commandName, msg)) await handler(msg, tracked.reply, auth)
      else await replyToUnauthorized(tracked.reply, auth)
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
          registerCommand(name, createObservedCommandHandler(chat, name, handler))
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
  registerSetupCommand(observedChat, checkAuthorization)
  registerConfigCommand(observedChat, checkAuthorization)
  registerContextCommand(observedChat)
  registerClearCommand(observedChat, checkAuthorization, adminUserId)
  registerAdminCommands(observedChat, adminUserId)
  registerGroupCommand(observedChat)
}
function userNeedsSetup(storageContextId: string, taskProvider: 'kaneo' | 'youtrack'): boolean {
  const config = getAllConfig(storageContextId)
  return getWizardSteps(taskProvider).some((step) => {
    if (step.isOptional === true) return false
    const value = config[step.key]
    if (value === undefined) return true
    if (value === '') return true
    return false
  })
}
async function autoStartWizardIfNeeded(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  if (hasActiveWizard(userId, storageContextId)) return false
  if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false
  const taskProvider = process.env['TASK_PROVIDER'] === 'youtrack' ? 'youtrack' : 'kaneo'
  if (!userNeedsSetup(storageContextId, taskProvider)) return false
  const result = createWizard(userId, storageContextId, taskProvider)
  if (result.success) await reply.text(result.prompt)
  return result.success
}
async function processCoalescedMessage(coalescedItem: QueuedCoalescedItem, deps: BotDeps): Promise<void> {
  const start = Date.now()
  const tracked = trackReplyUsage(coalescedItem.reply, true)
  if (coalescedItem.files.length > 0) storeIncomingFiles(coalescedItem.storageContextId, coalescedItem.files)
  else clearIncomingFiles(coalescedItem.storageContextId)
  try {
    await deps.processMessage(
      tracked.reply,
      coalescedItem.storageContextId,
      coalescedItem.userId,
      coalescedItem.username,
      coalescedItem.text,
      coalescedItem.contextType,
      coalescedItem.configContextId,
    )
  } finally {
    clearIncomingFiles(coalescedItem.storageContextId)
    emitReplyCompletedIfNeeded(tracked, coalescedItem.userId, coalescedItem.storageContextId, start)
  }
}
function shouldIgnoreGroupMessage(msg: IncomingMessage): boolean {
  if (msg.contextType !== 'group') return false
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return false
  return !msg.isMentioned
}
async function handleMessage(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: BotDeps,
): Promise<void> {
  if (!auth.allowed) {
    if (msg.isMentioned) await replyToUnauthorized(reply, auth)
    return
  }
  if (shouldIgnoreGroupMessage(msg)) return
  let files: readonly IncomingFile[] = []
  if (msg.files !== undefined) files = msg.files
  enqueueMessage(
    {
      text: buildPromptWithReplyContext(msg),
      userId: msg.user.id,
      username: msg.user.username,
      storageContextId: auth.storageContextId,
      configContextId: auth.configContextId,
      contextType: msg.contextType,
      files,
    },
    reply,
    (coalescedItem): Promise<void> => processCoalescedMessage(coalescedItem, deps),
  )
}
function recordGroupObservation(chat: ChatProvider, msg: IncomingMessage): void {
  if (msg.contextType !== 'group' || shouldIgnoreGroupMessage(msg)) return
  let displayName = msg.contextId
  if (msg.contextName !== undefined) displayName = msg.contextName
  let parentName: string | null = null
  if (msg.contextParentName !== undefined) parentName = msg.contextParentName
  upsertKnownGroupContext({ contextId: msg.contextId, provider: chat.name, displayName, parentName })
  upsertGroupAdminObservation({
    provider: chat.name,
    contextId: msg.contextId,
    userId: msg.user.id,
    username: msg.user.username,
    isAdmin: msg.user.isAdmin,
  })
}
function willQueueAuthorizedMessage(msg: IncomingMessage, auth: AuthorizationResult): boolean {
  if (!auth.allowed) return false
  if (msg.contextType !== 'group') return true
  if (msg.commandMatch !== undefined) return true
  return msg.isMentioned
}
async function onIncomingMessage(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  deps: BotDeps,
): Promise<void> {
  const start = Date.now()
  const tracked = trackReplyUsage(reply, supportsFileReplies(chat))
  emit('message:received', {
    userId: msg.user.id,
    contextId: msg.contextId,
    contextType: msg.contextType,
    threadId: msg.threadId,
    textLength: msg.text.length,
    isCommand: msg.text.startsWith('/'),
  })
  const auth = resolveMessageAuth(msg)
  emit('auth:check', {
    userId: msg.user.id,
    allowed: auth.allowed,
    isBotAdmin: auth.isBotAdmin,
    isGroupAdmin: auth.isGroupAdmin,
    storageContextId: auth.storageContextId,
  })
  if (auth.allowed) recordGroupObservation(chat, msg)
  if (await maybeInterceptWizard(msg, tracked.reply, auth, supportsInteractiveButtons(chat), autoStartWizardIfNeeded)) {
    emitReplyCompletedIfNeeded(tracked, msg.user.id, auth.storageContextId, start)
    return
  }
  const willQueue = willQueueAuthorizedMessage(msg, auth)
  await handleMessage(msg, tracked.reply, auth, deps)
  if (!willQueue) emitReplyCompletedIfNeeded(tracked, msg.user.id, auth.storageContextId, start)
}
type InteractionHandler = NonNullable<ChatProvider['onInteraction']>
type IncomingInteractionHandler = Parameters<InteractionHandler>[0]
type IncomingInteraction = Parameters<IncomingInteractionHandler>[0]
async function routeIncomingInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<void> {
  try {
    const auth = checkAuthorizationExtended(
      interaction.user.id,
      interaction.user.username,
      interaction.contextId,
      interaction.contextType,
      interaction.threadId,
      interaction.user.isAdmin,
    )
    if (!auth.allowed) {
      await replyToUnauthorized(reply, auth)
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
  registerCommands(chat, adminUserId)
  chat.onMessage((msg, reply): Promise<void> => onIncomingMessage(chat, msg, reply, deps))
  if (chat.onInteraction !== undefined)
    chat.onInteraction((interaction, reply): Promise<void> => routeIncomingInteraction(interaction, reply))
}
