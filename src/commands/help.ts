// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability, ChatProvider, CommandHandler, ContextType } from '../chat/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:help' })

const DM_USER_HELP = [
  'papai — AI assistant for Kaneo task management',
  '',
  'Commands:',
  '/help — Show this message',
  '/config — Open your settings in the web UI (single-use link)',
  '/clear — Clear conversation history and memory',
  '/context — Show current memory context (summary and known entities)',
  '/stop — stop or steer the running task (send again to stop immediately)',
  '',
  'Any other message is sent to the AI assistant.',
].join('\n')

const DM_ADMIN_HELP = [
  '',
  'Admin commands:',
  "/clear <user_id> — Clear a specific user's history",
  "/clear all — Clear all users' history",
  '/dashboard — Open the operator dashboard (single-use link)',
  '',
  'Authorized users, groups, plugins, and announcements are managed in the web UI — open /config.',
].join('\n')

function getDmHelpText(isAdmin: boolean): string {
  return isAdmin ? DM_USER_HELP + DM_ADMIN_HELP : DM_USER_HELP
}

function getGroupHelpText(isGroupAdmin: boolean): string {
  let text = [
    'papai — AI assistant for Kaneo task management',
    '',
    'Group commands:',
    '/help — Show this message',
    '/context — Show current memory context',
    '/clear — Clear group conversation history',
    '',
    'Mention me with @botname for natural language queries',
  ].join('\n')

  if (isGroupAdmin) {
    text += [
      '',
      'Group settings, membership, and authorization are configured in the web UI.',
      'Open a DM with me and run /config.',
    ].join('\n')
  }

  return text
}

export function buildHelpText(
  _capabilities: ReadonlySet<ChatCapability>,
  contextType: ContextType,
  opts: { isBotAdmin: boolean; isGroupAdmin: boolean },
): string {
  return contextType === 'dm' ? getDmHelpText(opts.isBotAdmin) : getGroupHelpText(opts.isGroupAdmin)
}

export function registerHelpCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    log.info({ userId: msg.user.id, contextType: msg.contextType }, '/help command executed')

    const helpText = buildHelpText(chat.capabilities, msg.contextType, {
      isBotAdmin: auth.isBotAdmin,
      isGroupAdmin: auth.isGroupAdmin,
    })
    await reply.text(helpText)
  }

  chat.registerCommand('help', handler)
}
