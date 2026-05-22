// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { getCachedMessage } from '../../message-cache/index.js'
import { buildReplyContextChain } from '../../reply-context.js'
import type { ReplyContext } from '../types.js'
import { type MattermostPost, MattermostPostSchema } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost:reply-context' })

export async function buildMattermostReplyContext(
  post: MattermostPost,
  replyToMessageId: string,
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
): Promise<ReplyContext> {
  const threadId = post.root_id === undefined || post.root_id === '' ? replyToMessageId : post.root_id
  const { chain, chainSummary } = buildReplyContextChain(post.channel_id, replyToMessageId)

  const parentMsg = getCachedMessage(post.channel_id, replyToMessageId)
  if (parentMsg !== undefined) {
    return {
      messageId: replyToMessageId,
      threadId,
      text: parentMsg.text,
      authorId: parentMsg.authorId,
      authorUsername: parentMsg.authorUsername ?? null,
      chain,
      chainSummary,
    }
  }

  // Parent not in cache — fetch via API
  try {
    const parentPost = await apiFetch('GET', `/api/v4/posts/${replyToMessageId}`, undefined)
    const parsed = MattermostPostSchema.safeParse(parentPost)
    if (parsed.success) {
      return {
        messageId: replyToMessageId,
        threadId,
        text: parsed.data.message,
        authorId: parsed.data.user_id,
        authorUsername: parsed.data.user_name ?? null,
        chain,
        chainSummary,
      }
    }
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), replyToMessageId },
      'Failed to fetch parent post for reply context',
    )
  }

  return { messageId: replyToMessageId, threadId }
}
