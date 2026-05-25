// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseScopedContextId } from '../chat/scoped-context.js'
import { dmTarget } from '../chat/types.js'
import type { DeferredPromptDelivery } from './types.js'

type DeliveryRow = Readonly<{
  createdByUserId: string
  createdByUsername: string | null
  deliveryContextId: string | null
  deliveryContextType: string | null
  deliveryThreadId: string | null
  audience: string
  mentionUserIds: string
}>

export function nativeIdFromScoped(id: string): string {
  const parsed = parseScopedContextId(id)
  if (parsed === null) return id
  return parsed.nativeContextId
}

function parseMentionUserIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string').map((value) => nativeIdFromScoped(value))
  } catch {
    return []
  }
}

function contextType(raw: string | null): 'dm' | 'group' {
  if (raw === 'group') return 'group'
  return 'dm'
}

function nativeContextId(storageContextId: string, rawContextType: string | null): string {
  const scoped = parseScopedContextId(storageContextId)
  if (scoped === null && rawContextType === 'group') {
    const colonIndex = storageContextId.indexOf(':')
    if (colonIndex >= 0) return storageContextId.slice(0, colonIndex)
  }
  if (scoped === null) return storageContextId
  return scoped.nativeContextId
}

function deliveryThreadId(storageContextId: string, threadId: string | null): string | null {
  if (threadId !== null) return threadId
  const scoped = parseScopedContextId(storageContextId)
  if (scoped === null) {
    const colonIndex = storageContextId.indexOf(':')
    if (colonIndex < 0) return null
    return storageContextId.slice(colonIndex + 1)
  }
  if (scoped.threadId === undefined) return null
  return scoped.threadId
}

export function rowToDeliveryTarget(row: DeliveryRow): DeferredPromptDelivery {
  if (row.deliveryContextId === null) {
    return {
      ...dmTarget(nativeIdFromScoped(row.createdByUserId)),
      createdByUsername: row.createdByUsername,
    }
  }
  return {
    contextId: nativeContextId(row.deliveryContextId, row.deliveryContextType),
    storageContextId: row.deliveryContextId,
    contextType: contextType(row.deliveryContextType),
    threadId: deliveryThreadId(row.deliveryContextId, row.deliveryThreadId),
    audience: row.audience === 'shared' ? 'shared' : 'personal',
    mentionUserIds: parseMentionUserIds(row.mentionUserIds),
    createdByUserId: nativeIdFromScoped(row.createdByUserId),
    createdByUsername: row.createdByUsername,
  }
}

export function defaultDeliveryTarget(ownerId: string): DeferredPromptDelivery {
  return { ...dmTarget(nativeIdFromScoped(ownerId)), storageContextId: ownerId }
}

export function storageContextIdForTarget(target: DeferredPromptDelivery): string {
  if (target.storageContextId !== undefined) return target.storageContextId
  if (target.contextType === 'group' && target.threadId !== null) return `${target.contextId}:${target.threadId}`
  return target.contextId
}
