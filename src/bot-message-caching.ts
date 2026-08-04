// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getScopeKey } from './chat/context-scope.js'
import type { AuthorizationResult, IncomingMessage } from './chat/types.js'
import { cacheMessage } from './message-cache/index.js'

/**
 * Persist every allowed observed non-command message to message_metadata.
 * Runs for the full observable history (not just bot-addressed messages) so
 * group-wide search sees all traffic; commands are excluded via commandMatch.
 */
export function cacheObservedIncomingMessage(msg: IncomingMessage, auth: AuthorizationResult): void {
  if (!auth.allowed) return
  if (msg.messageId === undefined) return
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return
  cacheMessage({
    messageId: msg.messageId,
    contextId: auth.storageContextId,
    groupContextId:
      msg.contextType === 'group'
        ? getScopeKey('group', {
            storageContextId: auth.storageContextId,
            chatUserId: msg.user.id,
            contextType: 'group',
          })
        : undefined,
    authorId: msg.user.id,
    authorUsername: msg.user.username ?? undefined,
    text: msg.text,
    replyToMessageId: msg.replyToMessageId,
    timestamp: Date.now(),
  })
}
