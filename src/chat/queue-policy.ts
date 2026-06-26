// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthorizationResult, IncomingMessage } from './types.js'

// Decides whether an authorized message should start an LLM turn. DMs always queue;
// in groups only commands, @mentions, or replies to the bot do.
export function willQueueAuthorizedMessage(msg: IncomingMessage, auth: AuthorizationResult): boolean {
  if (!auth.allowed) return false
  if (msg.contextType !== 'group') return true
  if (msg.commandMatch !== undefined) return true
  return msg.isMentioned || msg.isReplyToBot === true
}
