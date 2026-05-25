// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type ContextType = 'dm' | 'group'

export type DeferredAudience = 'personal' | 'shared'

export type DeferredDeliveryTarget = {
  contextId: string
  contextType: ContextType
  threadId: string | null
  audience: DeferredAudience
  mentionUserIds: string[]
  createdByUserId: string
  createdByUsername: string | null
} & Partial<Readonly<{ storageContextId: string }>>

export function dmTarget(userId: string): DeferredDeliveryTarget {
  return {
    contextId: userId,
    contextType: 'dm',
    threadId: null,
    audience: 'personal',
    mentionUserIds: [],
    createdByUserId: userId,
    createdByUsername: null,
  }
}
