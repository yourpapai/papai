// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listActivePlatformInstancesSafe } from '../instances/platform-store.js'
import { listTaskInstancesSafe } from '../instances/task-store.js'
import { logger } from '../logger.js'
import { listRecentRequests } from '../usage/recent-requests.js'
import { RecentRequestsResponseSchema } from './admin-schemas.js'

type AdminChatProvider = 'telegram' | 'mattermost' | 'discord' | 'kontur-talk' | 'unknown'
type AdminTaskProvider = string

const singleKnownProvider = <T extends string>(values: readonly T[]): T | 'unknown' => {
  const unique = [...new Set(values)].toSorted((a, b) => a.localeCompare(b))
  return unique.length === 1 ? unique[0]! : 'unknown'
}

const safeChatProvider = (): AdminChatProvider =>
  singleKnownProvider(listActivePlatformInstancesSafe().instances.map((instance) => instance.type))

const safeTaskProvider = (): AdminTaskProvider => {
  const activeTypes = listTaskInstancesSafe()
    .instances.filter((instance) => instance.status === 'active')
    .map((instance) => instance.type)
  return singleKnownProvider(activeTypes)
}

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
  const rawId = match === null || match.groups === undefined ? undefined : match.groups['id']
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
