import type { AuthorizationResult, ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { clearHistory } from '../history.js'
import { logger } from '../logger.js'
import { clearFacts, clearSummary } from '../memory.js'
import { listUsers } from '../users.js'

const log = logger.child({ scope: 'commands:clear' })

function clearContext(contextId: string): void {
  clearHistory(contextId)
  clearSummary(contextId)
  clearFacts(contextId)
}

async function clearSelf(msg: { user: { id: string } }, reply: ReplyFn, auth: AuthorizationResult): Promise<boolean> {
  clearContext(auth.storageContextId)
  log.info(
    { userId: msg.user.id, storageContextId: auth.storageContextId },
    '/clear command executed — conversation history, memory, and facts cleared',
  )
  await reply.text('Conversation history, memory, and facts cleared.')
  return true
}

async function clearAll(msg: { user: { id: string } }, reply: ReplyFn): Promise<boolean> {
  const users = listUsers()
  for (const user of users) {
    clearContext(user.platform_user_id)
  }
  log.info({ userId: msg.user.id, clearedCount: users.length }, '/clear all executed')
  await reply.text(`Cleared history, memory, and facts for all ${users.length} users.`)
  return true
}

async function clearUser(msg: { user: { id: string } }, reply: ReplyFn, targetId: string): Promise<boolean> {
  clearContext(targetId)
  log.info({ userId: msg.user.id, targetId }, '/clear <user_id> executed')
  await reply.text(`Cleared history, memory, and facts for user ${targetId}.`)
  return true
}

export function registerClearCommand(
  chat: ChatProvider,
  _checkAuthorization: (userId: string, username?: string | null) => boolean,
  adminUserId: string,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType === 'group' && !auth.isBotAdmin && !auth.isGroupAdmin) {
      await reply.text('Only group admins can run this command.')
      return
    }

    log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/clear command called')
    const arg = (msg.commandMatch ?? '').trim()

    if (arg === '') {
      await clearSelf(msg, reply, auth)
      return
    }

    if (msg.user.id !== adminUserId) {
      await reply.text("Only the admin can clear other users' history.")
      return
    }

    if (arg === 'all') {
      await clearAll(msg, reply)
      return
    }

    await clearUser(msg, reply, arg)
  }

  chat.registerCommand('clear', handler)
}
