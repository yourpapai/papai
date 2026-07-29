// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { checkAuthorizationExtended } from './auth.js'
import type { AuthorizationResult, IncomingMessage } from './chat/types.js'

/**
 * Resolve the authorization result for an incoming message by threading the
 * adapter-provided identity + context fields through the central auth checker.
 * Shared by the message and edit intake paths so they apply identical rules.
 */
export function resolveMessageAuth(msg: IncomingMessage): AuthorizationResult {
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

/**
 * Group intake filter: drop group messages that neither mention the bot nor
 * reply to one of its messages, unless they're commands (commands always go
 * through). DMs always pass. Shared by the message and edit intake paths.
 */
export function shouldIgnoreGroupMessage(msg: IncomingMessage): boolean {
  if (msg.contextType !== 'group') return false
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return false
  return !msg.isMentioned && msg.isReplyToBot !== true
}
