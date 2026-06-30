// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { resolveDeliveryPlatformInstanceId } from '../chat/delivery-routing.js'
import {
  getConfigContextIdFromStorageContextId,
  getNativeContextId,
  isScopedThreadContextId,
  parseScopedContextId,
} from '../chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { dmTarget } from '../chat/types.js'
import { logger } from '../logger.js'
import { getNotifyToken } from '../notify-token.js'
import { getRuntimeChatRouter } from './chat-router-runtime.js'
import { jsonResponse } from './json-response.js'

const log = logger.child({ scope: 'debug:notify-route' })

const NotifyBodySchema = z.object({
  contextId: z.string().min(1),
  contextType: z.enum(['dm', 'group']).optional(),
  threadId: z.string().min(1).optional(),
  markdown: z.string().min(1),
})

export type NotifyBody = z.infer<typeof NotifyBodySchema>

const bearerToken = (req: Request): string | null => {
  const header = req.headers.get('authorization')
  if (header === null || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.length === 0 ? null : token
}

const tokensMatch = (provided: string, expected: string): boolean => {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Build a delivery target from the notify payload.
 *
 * Delivery contract: when `contextType` is omitted, a thread-scoped storage
 * context id is treated as a group, everything else as a DM. Callers MUST pass
 * `contextType: 'group'` (and `threadId`) for non-thread group contexts, since a
 * bare context id cannot be disambiguated from a DM user id. `threadId` is
 * ignored for DM targets. `storageContextId` is always set so the platform
 * instance resolves correctly regardless of the addressing fields.
 *
 * The platform-scoped `storageContextId` (e.g. `pi:<inst>:ctx:<user>` for a DM,
 * `pi:<inst>:ctx:<channel>:thread:<thread>` for a group thread) encodes the
 * native ids, so both the DM `contextId` and the group's channel id + thread id
 * are decoded out of it. Callers (e.g. magi's milestone notifier) only know the
 * scoped id; they need not pass a separate native id or `threadId`. A
 * caller-supplied `threadId` still takes precedence when present.
 */
export const buildNotifyTarget = (body: NotifyBody): DeferredDeliveryTarget => {
  const storageContextId = body.contextId
  const isGroup =
    body.contextType === undefined ? isScopedThreadContextId(storageContextId) : body.contextType === 'group'
  if (!isGroup) {
    return { ...dmTarget(getNativeContextId(storageContextId)), storageContextId }
  }
  const groupId = getNativeContextId(getConfigContextIdFromStorageContextId(storageContextId))
  return {
    contextId: groupId,
    contextType: 'group',
    threadId: body.threadId ?? parseScopedContextId(storageContextId)?.threadId ?? null,
    audience: 'shared',
    mentionUserIds: [],
    // service-posted notification: no originating user
    createdByUserId: '',
    createdByUsername: null,
    storageContextId,
  }
}

const checkAuth = (req: Request): Response | null => {
  const provided = bearerToken(req)
  if (provided === null) {
    log.warn('notify auth rejected: missing or invalid bearer token')
    return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  }
  const expected = getNotifyToken()
  if (expected === null) return jsonResponse({ error: 'notify not configured' }, { status: 503 })
  if (!tokensMatch(provided, expected)) {
    log.warn('notify auth rejected: missing or invalid bearer token')
    return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

const sendNotify = async (
  chat: { sendMessage: (id: string, target: DeferredDeliveryTarget, md: string) => Promise<boolean> },
  platformInstanceId: string,
  target: DeferredDeliveryTarget,
  contextId: string,
  markdown: string,
): Promise<Response> => {
  let sent: boolean
  try {
    sent = await chat.sendMessage(platformInstanceId, target, markdown)
  } catch (error: unknown) {
    log.warn(
      { platformInstanceId, contextId, error: error instanceof Error ? error.message : String(error) },
      'notify delivery threw',
    )
    return jsonResponse({ error: 'delivery failed' }, { status: 502 })
  }
  if (!sent) {
    log.warn({ platformInstanceId, contextId }, 'notify delivery failed')
    return jsonResponse({ error: 'delivery failed' }, { status: 502 })
  }
  return jsonResponse({ sent: true })
}

export const handleNotifyRoute = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, { status: 405 })

  const authError = checkAuth(req)
  if (authError !== null) return authError

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, { status: 400 })
  }
  const parsed = NotifyBodySchema.safeParse(raw)
  if (!parsed.success) return jsonResponse({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 })

  const chat = getRuntimeChatRouter()
  if (chat === null) return jsonResponse({ error: 'chat router not running' }, { status: 422 })

  const target = buildNotifyTarget(parsed.data)
  const platformInstanceId = resolveDeliveryPlatformInstanceId(target)
  if (platformInstanceId === null) return jsonResponse({ error: 'context not deliverable' }, { status: 404 })

  return sendNotify(chat, platformInstanceId, target, parsed.data.contextId, parsed.data.markdown)
}
