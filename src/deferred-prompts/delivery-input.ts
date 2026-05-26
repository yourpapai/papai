// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseScopedContextId } from '../chat/scoped-context.js'
import { dmTarget, type ContextType } from '../chat/types.js'
import type { DeferredPromptDeliveryInput } from './types.js'

export type CreateDeliveryContext = {
  userId: string
  storageContextId: string
  contextType: ContextType
} & Partial<Readonly<{ username: string | null }>>

export type DeliveryPolicy = Partial<Readonly<{ audience: 'personal' | 'shared'; mention_user_ids: string[] }>>

function nullableUsername(username: string | null | undefined): string | null {
  if (username === undefined) return null
  return username
}

function parseGroupDeliveryContext(storageContextId: string): Readonly<{ contextId: string; threadId: string | null }> {
  const scoped = parseScopedContextId(storageContextId)
  if (scoped !== null) {
    if (scoped.threadId === undefined) return { contextId: scoped.nativeContextId, threadId: null }
    return { contextId: scoped.nativeContextId, threadId: scoped.threadId }
  }
  const colonIdx = storageContextId.indexOf(':')
  if (colonIdx < 0) return { contextId: storageContextId, threadId: null }
  return { contextId: storageContextId.slice(0, colonIdx), threadId: storageContextId.slice(colonIdx + 1) }
}

function deliveryAudience(policy: DeliveryPolicy | undefined): 'personal' | 'shared' {
  if (policy === undefined) return 'personal'
  if (policy.audience === 'shared') return 'shared'
  return 'personal'
}

function mentionUserIds(policy: DeliveryPolicy | undefined, ctxUserId: string): string[] {
  const audience = deliveryAudience(policy)
  if (audience === 'shared') return []
  if (policy === undefined) return [ctxUserId]
  if (policy.mention_user_ids === undefined) return [ctxUserId]
  return policy.mention_user_ids
}

export function buildDeliveryInput(
  ctx: CreateDeliveryContext,
  policy: DeliveryPolicy | undefined,
): DeferredPromptDeliveryInput {
  if (ctx.contextType === 'dm')
    return {
      ...dmTarget(ctx.userId),
      storageContextId: ctx.storageContextId,
      createdByUsername: nullableUsername(ctx.username),
    }

  const parsedContext = parseGroupDeliveryContext(ctx.storageContextId)
  const audience = deliveryAudience(policy)
  return {
    contextId: parsedContext.contextId,
    storageContextId: ctx.storageContextId,
    contextType: 'group',
    threadId: parsedContext.threadId,
    audience,
    mentionUserIds: mentionUserIds(policy, ctx.userId),
    createdByUserId: ctx.userId,
    createdByUsername: nullableUsername(ctx.username),
  }
}
