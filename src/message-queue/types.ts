// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthorizedTurnSeed } from '../analytics/bot-observer.js'
import type { ActorRole, ContextType, ReplyFn } from '../chat/types.js'
import type { MessageSegment } from '../message-edit/segments.js'

type QueueContextInfo = Readonly<{
  contextType: ContextType
}>

type QueueConfigContextInfo = Partial<
  Readonly<{
    configContextId: string | undefined
  }>
>

type QueueAnalyticsInfo = Partial<
  Readonly<{
    /** In-memory only; the raw source context and source event ID never leave the process. */
    analyticsTurnSeed: AuthorizedTurnSeed
  }>
>

export type QueueItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  newAttachmentIds: readonly string[]
  voiceStagedIds: readonly string[]
  actorRole?: ActorRole
  messageId?: string
  /** Whether the actor of this message is a bot admin; absent means not an admin. */
  isBotAdmin?: boolean
  /** Platform instance the message arrived on; absent when the message carries none. */
  platformInstanceId?: string
}> &
  QueueContextInfo &
  QueueConfigContextInfo &
  QueueAnalyticsInfo

export type CoalescedItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  newAttachmentIds: readonly string[]
  voiceStagedIds: readonly string[]
  reply: ReplyFn
  turnId: string
  actorRole?: ActorRole
  messageIds: readonly string[]
  segments: readonly MessageSegment[]
  /** Whether the actor of the coalesced turn is a bot admin; absent means not an admin. */
  isBotAdmin?: boolean
  /** Platform instance the coalesced turn originated from; absent when unknown. */
  platformInstanceId?: string
}> &
  QueueContextInfo &
  QueueConfigContextInfo &
  QueueAnalyticsInfo
