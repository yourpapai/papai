// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getScopeKey } from './chat/context-scope.js'
import type { AuthorizationResult, IncomingMessage } from './chat/types.js'
import { logger } from './logger.js'
import { cacheMessage } from './message-cache/cache.js'
import { embedAndStoreMessage } from './message-cache/embed-message.js'

const log = logger.child({ scope: 'bot-message-caching' })

/**
 * Persist every allowed observed non-command message to message_metadata,
 * then fire-and-forget an embedding (semantic search). Runs for the full
 * observable history (not just bot-addressed messages) so group-wide search
 * sees all traffic; commands are excluded via commandMatch.
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
  if (msg.text.trim() !== '' && auth.configContextId !== undefined) {
    void embedAndStoreMessage({
      text: msg.text,
      contextId: auth.storageContextId,
      messageId: msg.messageId,
      configContextId: auth.configContextId,
      embeddingCtx: {
        storageContextId: auth.storageContextId,
        contextType: msg.contextType,
        chatUserId: msg.user.id,
      },
    }).catch((error: unknown) => {
      log.warn(
        { messageId: msg.messageId, error: error instanceof Error ? error.message : String(error) },
        'embedAndStoreMessage rejected',
      )
    })
  }
}
