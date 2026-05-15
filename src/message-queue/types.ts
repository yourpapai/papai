// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextType, ReplyFn } from '../chat/types.js'

type QueueContextInfo = Readonly<{
  contextType: ContextType
}>

type QueueConfigContextInfo = Partial<
  Readonly<{
    configContextId: string | undefined
  }>
>

export type QueueItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  newAttachmentIds: readonly string[]
}> &
  QueueContextInfo &
  QueueConfigContextInfo

export type CoalescedItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  newAttachmentIds: readonly string[]
  reply: ReplyFn
}> &
  QueueContextInfo &
  QueueConfigContextInfo
