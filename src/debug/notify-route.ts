// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { resolveDeliveryPlatformInstanceId } from '../chat/delivery-routing.js'
import { getConfigContextIdFromStorageContextId, isScopedThreadContextId } from '../chat/scoped-context.js'
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
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const buildNotifyTarget = (body: NotifyBody): DeferredDeliveryTarget => {
  const storageContextId = body.contextId
  const isGroup =
    body.contextType === undefined ? isScopedThreadContextId(storageContextId) : body.contextType === 'group'
  if (!isGroup) {
    return { ...dmTarget(storageContextId), storageContextId }
  }
  const groupId = getConfigContextIdFromStorageContextId(storageContextId)
  return {
    contextId: groupId,
    contextType: 'group',
    threadId: body.threadId ?? null,
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: '',
    createdByUsername: null,
    storageContextId,
  }
}

export const handleNotifyRoute = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, { status: 405 })

  const expected = getNotifyToken()
  if (expected === null) return jsonResponse({ error: 'notify not configured' }, { status: 503 })

  const provided = bearerToken(req)
  if (provided === null || !tokensMatch(provided, expected)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  }

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
  if (platformInstanceId === null) {
    return jsonResponse({ error: 'context not deliverable' }, { status: 404 })
  }

  const sent = await chat.sendMessage(platformInstanceId, target, parsed.data.markdown)
  if (!sent) {
    log.warn({ platformInstanceId, contextId: parsed.data.contextId }, 'notify delivery failed')
    return jsonResponse({ error: 'delivery failed' }, { status: 502 })
  }
  return jsonResponse({ sent: true })
}
