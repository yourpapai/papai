// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:mattermost:reactions' })

/** Maps the unicode emoji chars papai uses for reactions to Mattermost's emoji names. */
const MM_EMOJI_NAME: Record<string, string> = {
  '⏳': 'hourglass_flowing_sand',
  '👀': 'eyes',
  '✅': 'white_check_mark',
  '❌': 'x',
  '🚫': 'no_entry_sign',
}

/**
 * Sets or clears a Mattermost reaction on an existing post, keyed by the bot's own user id.
 * Mattermost reactions are addressed by emoji name (not the unicode char), so unmapped emoji
 * are silently skipped. Best-effort: never throws, returns false on any failure or when the
 * bot hasn't started (no `botUserId` yet).
 */
export async function setMattermostReaction(
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
  botUserId: string | null,
  messageId: string,
  emoji: string | null,
  previousEmoji: string | null | undefined,
): Promise<boolean> {
  if (botUserId === null) return false
  try {
    if (previousEmoji !== undefined && previousEmoji !== null) {
      const previousName = MM_EMOJI_NAME[previousEmoji]
      if (previousName !== undefined) {
        await apiFetch('DELETE', `/api/v4/users/${botUserId}/posts/${messageId}/reactions/${previousName}`, undefined)
      }
    }
    if (emoji !== null) {
      const name = MM_EMOJI_NAME[emoji]
      if (name !== undefined) {
        await apiFetch('POST', '/api/v4/reactions', { user_id: botUserId, post_id: messageId, emoji_name: name })
      }
    }
    return true
  } catch (error: unknown) {
    log.warn(
      { messageId, error: error instanceof Error ? error.message : String(error) },
      'Mattermost setReaction failed',
    )
    return false
  }
}
