// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CommandHandler, ContextType, IncomingMessage, ReplyFn } from '../types.js'
import { checkChannelAdmin } from './channel-helpers.js'
import { fetchMattermostChannelInfo, fetchMattermostTeamInfo, type MattermostChannelInfo } from './context-metadata.js'
import { downloadMattermostFile, resolveMattermostPostFiles } from './file-helpers.js'
import { determineMattermostThreadId, normalizeMattermostMessageText } from './message-normalization.js'
import type { PostedMessageResult } from './process-post.js'
import { buildMattermostReplyContext } from './reply-context.js'
import type { MattermostPost } from './schema.js'

export interface BuildPostedMessageDeps {
  platformInstanceId: string
  botUsername: string | null
  baseUrl: string
  token: string
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>
  buildReplyFn: (channelId: string, postId: string | undefined, threadId: string | undefined) => ReplyFn
  matchCommand: (text: string) => { handler: CommandHandler; match: string } | null
}

/** Builds the normalized `IncomingMessage` + reply/command context for a live or catch-up Mattermost post. */
export async function buildMattermostPostedMessage(
  post: MattermostPost,
  senderName: string | undefined,
  replyToMessageId: string | undefined,
  deps: BuildPostedMessageDeps,
): Promise<PostedMessageResult> {
  const api = deps.apiFetch
  const replyContext =
    replyToMessageId === undefined ? undefined : await buildMattermostReplyContext(post, replyToMessageId, api)
  const channelInfo: MattermostChannelInfo = await fetchMattermostChannelInfo(api, post.channel_id)
  const contextType: ContextType = channelInfo.type === 'D' ? 'dm' : 'group'
  const teamId = contextType === 'group' ? channelInfo.team_id : undefined
  const teamInfo = teamId === undefined ? null : await fetchMattermostTeamInfo(api, teamId)
  const isAdmin = await checkChannelAdmin(post.channel_id, post.user_id, api)
  const normalized = normalizeMattermostMessageText(post.message, deps.botUsername)
  const isMentioned = normalized.isMentioned
  const threadId = determineMattermostThreadId(post, isMentioned, contextType, replyToMessageId)
  const reply = deps.buildReplyFn(post.channel_id, post.id, threadId)
  const command = normalized.commandInput === null ? null : deps.matchCommand(normalized.commandInput)
  const uname = post.user_name
  const username = typeof uname === 'string' ? uname : typeof senderName === 'string' ? senderName : null
  const dispName = typeof channelInfo.display_name === 'string' ? channelInfo.display_name : channelInfo.name
  const contextName = contextType === 'group' ? (typeof dispName === 'string' ? dispName : post.channel_id) : undefined
  const pt = contextType === 'group' ? teamInfo : null
  const contextParentName = pt === null ? undefined : typeof pt.display_name === 'string' ? pt.display_name : pt.name
  const { files, fileCandidates } = await resolveMattermostPostFiles(
    post.file_ids,
    contextType === 'group',
    api,
    (fid) => downloadMattermostFile(deps.baseUrl, deps.token, fid),
  )
  const msg: IncomingMessage = {
    user: { id: post.user_id, username, isAdmin },
    contextId: post.channel_id,
    contextType,
    contextName,
    contextParentName,
    isMentioned,
    text: normalized.text,
    platformInstanceId: deps.platformInstanceId,
    commandMatch: command === null ? undefined : command.match,
    messageId: post.id,
    replyToMessageId,
    replyContext,
    threadId,
    ...(files ? { files } : {}),
    ...(fileCandidates ? { fileCandidates } : {}),
  }
  return { msg, reply, command, isAdmin }
}
