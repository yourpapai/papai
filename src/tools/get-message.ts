// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getScopeKey } from '../chat/context-scope.js'
import type { ContextType } from '../chat/types.js'
import { logger } from '../logger.js'
import { type MessageScope, getMessage } from '../message-cache/index.js'

const log = logger.child({ scope: 'tool:get-message' })

const toScope = (storageContextId: string, chatUserId: string, contextType: ContextType): MessageScope =>
  contextType === 'group'
    ? { kind: 'group', groupContextId: getScopeKey('group', { storageContextId, chatUserId, contextType }) }
    : { kind: 'dm', contextId: storageContextId }

export function makeGetMessageTool(chatUserId: string, storageContextId: string, contextType: ContextType): Tool {
  const scope = toScope(storageContextId, chatUserId, contextType)
  return tool({
    description:
      'Fetch a single chat message by its messageId (as returned by search_chat_history or get_message_context). Use to read the full text of a referenced message. Respects the current scope — out-of-scope ids return not_found.',
    inputSchema: z.object({
      messageId: z.string().min(1).describe('The message id to fetch'),
    }),
    execute: ({ messageId }): Record<string, unknown> => {
      log.debug({ messageId }, 'get_message called')
      const m = getMessage(scope, messageId)
      if (m === undefined) {
        log.info({ found: false }, 'get_message completed')
        return { not_found: true }
      }
      log.info({ found: true }, 'get_message completed')
      return {
        messageId: m.messageId,
        authorUsername: m.authorUsername ?? null,
        text: m.text ?? '',
        timestamp: m.timestamp,
        contextId: m.contextId,
        ...(m.replyToMessageId === undefined ? {} : { replyToMessageId: m.replyToMessageId }),
      }
    },
  })
}
