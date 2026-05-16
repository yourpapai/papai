// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { maybeProvisionKaneo } from '../providers/kaneo/provision.js'
import { addUser, isAuthorized } from '../users.js'

const log = logger.child({ scope: 'commands:start' })

export function registerStartCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (process.env['DEMO_MODE'] === 'true' && msg.contextType === 'dm' && !isAuthorized(msg.user.id)) {
      addUser(msg.user.id, 'demo-auto', msg.user.username ?? undefined)
      log.info({ userId: msg.user.id }, 'Demo mode: auto-added user via /start')
      await maybeProvisionKaneo(reply, msg.user.id, msg.user.username)
    }

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
