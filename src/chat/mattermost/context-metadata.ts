// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { ChannelInfoSchema, TeamInfoSchema } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost:context-metadata' })

export type MattermostApiFetch = (method: string, path: string, body: unknown) => Promise<unknown>

export type MattermostChannelInfo = {
  readonly type: string
  readonly display_name?: string
  readonly name?: string
  readonly team_id?: string
}

export type MattermostTeamInfo = {
  readonly display_name?: string
  readonly name?: string
}

export async function fetchMattermostChannelInfo(
  apiFetch: MattermostApiFetch,
  channelId: string,
): Promise<MattermostChannelInfo> {
  const data = await apiFetch('GET', `/api/v4/channels/${channelId}`, undefined)
  const parsed = ChannelInfoSchema.safeParse(data)
  if (!parsed.success) {
    log.warn({ channelId, error: parsed.error }, 'Failed to parse channel info')
    return { type: '' }
  }
  return parsed.data
}

export async function fetchMattermostTeamInfo(
  apiFetch: MattermostApiFetch,
  teamId: string,
): Promise<MattermostTeamInfo | null> {
  try {
    const data = await apiFetch('GET', `/api/v4/teams/${teamId}`, undefined)
    const parsed = TeamInfoSchema.safeParse(data)
    if (!parsed.success) {
      log.warn({ teamId, error: parsed.error }, 'Failed to parse team info')
      return null
    }
    return parsed.data
  } catch (error) {
    log.warn({ teamId, error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch team info')
    return null
  }
}
