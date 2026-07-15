// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getMattermostLastEventAt, setMattermostLastEventAt } from '../../instances/platform-store.js'
import { buildScopedCommandAuth } from '../command-auth.js'
import type { CommandHandler, IncomingMessage, ReplyFn } from '../types.js'
import { cacheIncomingPost } from './file-helpers.js'
import { extractReplyId, type MattermostPost } from './schema.js'

export type PostedMessageResult = {
  msg: IncomingMessage
  reply: ReplyFn
  command: { handler: CommandHandler; match: string } | null
  isAdmin: boolean
}

export interface ProcessPostDeps {
  platformInstanceId: string
  botUserId: string | null
  botUsername: string | null
  buildPostedMessage: (
    post: MattermostPost,
    senderName: string | undefined,
    replyToMessageId: string | undefined,
  ) => Promise<PostedMessageResult>
  messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null
}

/**
 * Advances the Mattermost catch-up cursor to the post's `create_at`, keyed by platform
 * instance. Never regresses: a post older than the stored cursor is a no-op. Posts without
 * `create_at` (e.g. some test harnesses) leave the cursor untouched.
 */
function advanceMattermostCursor(platformInstanceId: string, post: MattermostPost): void {
  if (post.create_at === undefined) return
  const prev = getMattermostLastEventAt(platformInstanceId) ?? 0
  if (post.create_at > prev) setMattermostLastEventAt(platformInstanceId, post.create_at)
}

/**
 * Full live-post pipeline: bot-self filter, catch-up cursor advance, dedupe cache write,
 * message build, and dispatch to the mention-help / command / message handler.
 */
export async function processPost(
  post: MattermostPost,
  senderName: string | undefined,
  deps: ProcessPostDeps,
): Promise<void> {
  if (post.user_id === deps.botUserId) return
  advanceMattermostCursor(deps.platformInstanceId, post)
  const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
  cacheIncomingPost(post, replyToMessageId, senderName)
  const { msg, reply, command, isAdmin } = await deps.buildPostedMessage(post, senderName, replyToMessageId)
  if (msg.isMentioned && msg.text === '') {
    const mentionHelp =
      deps.botUsername === null ? 'Use `/help` to see commands' : `Use \`@${deps.botUsername} /help\` to see commands`
    await reply.text(`${mentionHelp}, or mention me with a question.`)
    return
  }
  if (command !== null) {
    const auth = buildScopedCommandAuth(msg, isAdmin, deps.platformInstanceId)
    await command.handler(msg, reply, auth)
    return
  }
  if (deps.messageHandler !== null) await deps.messageHandler(msg, reply)
}

/**
 * Cache-only path for catch-up's stale branch: bot-self filter, cursor advance, and the
 * dedupe/context cache write, without building a message or dispatching to handlers.
 */
export function cachePostOnly(
  post: MattermostPost,
  senderName: string | undefined,
  deps: Pick<ProcessPostDeps, 'platformInstanceId' | 'botUserId'>,
): void {
  if (post.user_id === deps.botUserId) return
  advanceMattermostCursor(deps.platformInstanceId, post)
  const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
  cacheIncomingPost(post, replyToMessageId, senderName)
}
