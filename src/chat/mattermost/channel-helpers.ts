// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { ChannelMemberSchema } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost:channel' })

export async function checkChannelAdmin(
  channelId: string,
  userId: string,
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
): Promise<boolean> {
  try {
    const data = await apiFetch('GET', `/api/v4/channels/${channelId}/members/${userId}`, undefined)
    const parsed = ChannelMemberSchema.safeParse(data)
    if (!parsed.success) {
      log.warn({ channelId, userId, error: parsed.error }, 'Failed to parse channel member')
      return false
    }
    return parsed.data.roles.includes('channel_admin')
  } catch {
    return false
  }
}
