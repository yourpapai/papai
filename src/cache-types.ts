// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

export type CachedFact = { identifier: string; title: string; url: string; last_seen: string }

export type CachedInstruction = { id: string; text: string; createdAt: string }

export type UserCache = {
  history: ModelMessage[]
  summary: string | null
  facts: CachedFact[]
  instructions: CachedInstruction[] | null
  config: Map<string, string | null>
  workspaceId: string | null
  tools: unknown
  lastAccessed: number
}
