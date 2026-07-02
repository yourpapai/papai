// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type SessionDetail = {
  userId: string
  lastAccessed: number
  historyLength: number
  factsCount: number
  summary: string | null
  configKeys: string[]
  hasTools?: boolean
  instructionsCount?: number
  facts?: Array<{ identifier: string; title: string; url: string; lastSeen: string }>
  config?: Record<string, string | null>
  instructions?: Array<{ id: string; text: string; createdAt: string }> | null
  history?: Array<{ role: string; content: string; tool_call_id?: string }>
}
