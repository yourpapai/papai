// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthorizationResult, ReplyFn } from './chat/types.js'

export function getUnauthorizedReplyText(auth: AuthorizationResult, groupId: string): string | null {
  if (auth.reason === 'group_not_allowed')
    return `This group (${groupId}) is not authorized to use this bot. Ask the bot admin to authorize it in the settings web UI — they can open it with \`/config\` in a DM.`
  if (auth.reason === 'group_member_not_allowed')
    return "You're not authorized to use this bot in this group. Ask a group admin to add you in the settings web UI — they can open it with `/config` in a DM."
  if (auth.reason === 'dm_not_allowed') return 'You are not authorized to use this bot.'
  if (auth.reason === 'user_blocked') return 'You are not authorized to use this bot.'
  return null
}

export async function replyToUnauthorized(reply: ReplyFn, auth: AuthorizationResult, groupId: string): Promise<void> {
  const message = getUnauthorizedReplyText(auth, groupId)
  if (message !== null) await reply.text(message)
}
