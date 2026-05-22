// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogEntry } from '../../src/debug/schemas.js'

export type SessionDetail = {
  userId: string
  lastAccessed: number
  historyLength: number
  factsCount: number
  summary: string | null
  configKeys: string[]
  workspaceId: string | null
  hasTools?: boolean
  instructionsCount?: number
  facts?: Array<{ identifier: string; title: string; url: string; lastSeen: string }>
  config?: Record<string, string | null>
  instructions?: Array<{ id: string; text: string; createdAt: string }> | null
  history?: Array<{ role: string; content: string; tool_call_id?: string }>
}

export type FuseResult<T> = { item: T }

export type SearchableLogEntry = LogEntry & { _searchText: string }
