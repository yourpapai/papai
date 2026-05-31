// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler, IncomingMessage, ReplyFn } from '../chat/types.js'
import { logger } from '../logger.js'
import { maybeAutoProvisionProvider } from '../providers/auto-provision.js'
import { addUser, isAuthorized } from '../users.js'

const log = logger.child({ scope: 'commands:start' })

export type StartCommandDeps = {
  maybeAutoProvision: (
    reply: ReplyFn,
    contextId: string,
    chatUserId: string,
    username: string | null,
  ) => Promise<boolean>
}

const defaultDeps: StartCommandDeps = {
  maybeAutoProvision: maybeAutoProvisionProvider,
}

const maybeAddDemoUser = async (msg: IncomingMessage, reply: ReplyFn, deps: StartCommandDeps): Promise<void> => {
  if (process.env['DEMO_MODE'] !== 'true') return
  if (msg.contextType !== 'dm') return
  if (isAuthorized(msg.user.id, msg.platformInstanceId)) return

  if (msg.user.username === undefined || msg.user.username === null) {
    addUser({ userId: msg.user.id, platformInstanceId: msg.platformInstanceId, addedBy: 'demo-auto' })
  } else {
    addUser({
      userId: msg.user.id,
      platformInstanceId: msg.platformInstanceId,
      addedBy: 'demo-auto',
      username: msg.user.username,
    })
  }
  log.info({ userId: msg.user.id }, 'Demo mode: auto-added user via /start')
  await deps.maybeAutoProvision(reply, msg.user.id, msg.user.id, msg.user.username)
}

export function registerStartCommand(chat: ChatProvider, deps: StartCommandDeps = defaultDeps): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    await maybeAddDemoUser(msg, reply, deps)

    if (!auth.allowed) {
      await reply.text('You are not authorized to use this bot.')
      return
    }

    log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/start command executed')

    const welcomeMessage = `👋 **Welcome to papai!**

I'm your task management assistant. I can help you:

📋 **Create and manage tasks** via natural language
🔍 **Search and update** existing tasks
⚙️ **Configure integrations** with your task tracker

**Get Started:**
🚀 **/setup** - Configure your settings (API keys, models, etc.)
📊 **/config** - View your current configuration
❓ **/help** - Show available commands

**Quick Tips:**
• Type your requests naturally (e.g., "create task: review PR #123")
• I'll remember our conversation context
• Use "/clear" to reset conversation history

Let's get you set up! 🎯`

    await reply.formatted(welcomeMessage)
  }

  chat.registerCommand('start', handler)
}
