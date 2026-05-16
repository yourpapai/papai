// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** TTL for message cache entries: 1 week in milliseconds */
export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface CachedMessage {
  messageId: string
  contextId: string
  authorId?: string
  authorUsername?: string
  text?: string
  replyToMessageId?: string
  timestamp: number
}
