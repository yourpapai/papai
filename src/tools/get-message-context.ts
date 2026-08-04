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
import { type MessageScope, type CachedMessage, getMessageContext } from '../message-cache/index.js'

const log = logger.child({ scope: 'tool:get-message-context' })

const toScope = (storageContextId: string, chatUserId: string, contextType: ContextType): MessageScope =>
  contextType === 'group'
    ? { kind: 'group', groupContextId: getScopeKey('group', { storageContextId, chatUserId, contextType }) }
    : { kind: 'dm', contextId: storageContextId }

const summarize = (m: CachedMessage): Record<string, unknown> => ({
  messageId: m.messageId,
  authorUsername: m.authorUsername ?? null,
  text: m.text ?? '',
  timestamp: m.timestamp,
  contextId: m.contextId,
  ...(m.replyToMessageId === undefined ? {} : { replyToMessageId: m.replyToMessageId }),
})

export function makeGetMessageContextTool(
  chatUserId: string,
  storageContextId: string,
  contextType: ContextType,
): Tool {
  const scope = toScope(storageContextId, chatUserId, contextType)
  return tool({
    description:
      'Read the conversation around a message. temporal (default) = N messages each side by time within scope; thread = same thread; reply_chain = the reply-parent chain. Use to understand the context of a referenced message.',
    inputSchema: z.object({
      messageId: z.string().min(1).describe('The anchor message id'),
      before: z.number().int().min(0).max(50).default(5).describe('Messages before the anchor (default 5)'),
      after: z.number().int().min(0).max(50).default(5).describe('Messages after the anchor (default 5)'),
      mode: z
        .enum(['temporal', 'thread', 'reply_chain'])
        .default('temporal')
        .describe('Window mode (default temporal)'),
    }),
    execute: ({ messageId, before, after, mode }): Record<string, unknown> => {
      log.debug({ messageId, before, after, mode }, 'get_message_context called')
      const result = getMessageContext(scope, messageId, before, after, mode)
      if (result.target === undefined) {
        log.info({ found: false }, 'get_message_context completed')
        return { not_found: true }
      }
      const out: Record<string, unknown> = {
        target: summarize(result.target),
        before: result.before.map(summarize),
        after: result.after.map(summarize),
      }
      if (result.replyChain !== undefined) out['replyChain'] = result.replyChain
      log.info(
        {
          beforeCount: result.before.length,
          afterCount: result.after.length,
          hasReplyChain: result.replyChain !== undefined,
        },
        'get_message_context completed',
      )
      return out
    },
  })
}
