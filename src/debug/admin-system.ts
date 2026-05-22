// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { listRecentRequests } from '../usage/recent-requests.js'
import { RecentRequestsResponseSchema } from './admin-schemas.js'

const CHAT_PROVIDERS = ['telegram', 'mattermost', 'discord'] as const
const TASK_PROVIDERS = ['kaneo', 'youtrack'] as const

type AdminChatProvider = (typeof CHAT_PROVIDERS)[number] | 'unknown'
type AdminTaskProvider = (typeof TASK_PROVIDERS)[number] | 'unknown'

const safeProviderValue = <const T extends readonly string[]>(
  value: string | undefined,
  known: T,
): T[number] | 'unknown' => (value !== undefined && known.includes(value) ? value : 'unknown')

const safeChatProvider = (): AdminChatProvider => safeProviderValue(process.env['CHAT_PROVIDER'], CHAT_PROVIDERS)

const safeTaskProvider = (): AdminTaskProvider => safeProviderValue(process.env['TASK_PROVIDER'], TASK_PROVIDERS)

const adminUserSet = (): boolean => {
  const adminUserId = process.env['ADMIN_USER_ID']
  return adminUserId !== undefined && adminUserId !== ''
}

export const handleAdminSystem = (): Response =>
  new Response(
    JSON.stringify({
      chatProvider: safeChatProvider(),
      taskProvider: safeTaskProvider(),
      debugServer: process.env['DEBUG_SERVER'] === 'true',
      adminUserSet: adminUserSet(),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )

const DEFAULT_RECENT_LIMIT = 25
const MAX_RECENT_LIMIT = 200

const parseLimit = (raw: string | null): number => {
  if (raw === null) return DEFAULT_RECENT_LIMIT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_RECENT_LIMIT
  return Math.max(0, Math.min(MAX_RECENT_LIMIT, Math.floor(parsed)))
}

export const handleAdminRecentRequests = (url: URL): Response => {
  const match = /^\/admin\/subjects\/(?<id>[^/]+)\/recent-requests$/u.exec(url.pathname)
  const rawId = match?.groups?.['id']
  if (rawId === undefined || rawId === '') {
    return new Response(JSON.stringify({ error: 'missing subject id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const subjectId = decodeURIComponent(rawId)
  const limit = parseLimit(url.searchParams.get('limit'))
  const requests = listRecentRequests(subjectId, limit)
  const parsed = RecentRequestsResponseSchema.safeParse({ subjectId, limit, requests })
  if (!parsed.success) {
    logger.warn({ scope: 'debug:admin-system' }, 'recent-requests response failed schema validation')
    return new Response(JSON.stringify({ error: 'internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify(parsed.data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
