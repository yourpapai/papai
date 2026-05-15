// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { fetchMattermostChannelInfo } from './context-metadata.js'
import { MattermostUserSchema } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost:labels' })

type ApiFetchFn = (method: string, path: string, body: unknown) => Promise<unknown>

export function formatMattermostUserLabel(
  username: string,
  firstName: string,
  lastName: string,
  nickname: string,
): string | null {
  const parts: string[] = []
  if (firstName !== '') parts.push(firstName)
  if (lastName !== '') parts.push(lastName)
  const display = parts.join(' ')
  const bestName = display.length > 0 ? display : nickname === '' ? null : nickname
  const at = username === '' ? null : `@${username}`
  if (bestName === null) return at
  if (at === null) return bestName
  return `${bestName} (${at})`
}

export async function resolveMattermostGroupLabel(apiFetch: ApiFetchFn, groupId: string): Promise<string | null> {
  try {
    const info = await fetchMattermostChannelInfo(apiFetch, groupId)
    if (info.display_name !== undefined && info.display_name !== '') return info.display_name
    if (info.name !== undefined && info.name !== '') return info.name
    return null
  } catch (e) {
    log.warn({ groupId, error: e instanceof Error ? e.message : String(e) }, 'Mattermost group label lookup failed')
    return null
  }
}

export async function resolveMattermostUserLabel(apiFetch: ApiFetchFn, userId: string): Promise<string | null> {
  try {
    const data = await apiFetch('GET', `/api/v4/users/${encodeURIComponent(userId)}`, void 0)
    const parsed = MattermostUserSchema.safeParse(data)
    if (!parsed.success) {
      log.warn({ userId, error: parsed.error }, 'Failed to parse Mattermost user label response')
      return null
    }
    const u = parsed.data
    return formatMattermostUserLabel(
      typeof u.username === 'string' ? u.username : '',
      typeof u.first_name === 'string' ? u.first_name : '',
      typeof u.last_name === 'string' ? u.last_name : '',
      typeof u.nickname === 'string' ? u.nickname : '',
    )
  } catch (e) {
    log.warn({ userId, error: e instanceof Error ? e.message : String(e) }, 'Mattermost user label lookup failed')
    return null
  }
}
