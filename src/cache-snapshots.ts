// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { _userCaches } from './cache.js'

export type SessionSnapshot = {
  userId: string
  lastAccessed: number
  historyLength: number
  summary: string | null
  factsCount: number
  facts: ReadonlyArray<{ identifier: string; title: string; url: string; lastSeen: string }>
  configKeys: string[]
  workspaceId: string | null
  hasTools: boolean
  instructionsCount: number
  // Full data for debug dashboard
  config: Record<string, string | null>
  instructions: ReadonlyArray<{ id: string; text: string; createdAt: string }> | null
  history: ReadonlyArray<{
    role: string
    content: string
    tool_calls?: unknown
    tool_call_id?: string
  }>
}

type UserCacheEntry = {
  history: ModelMessage[]
  summary: string | null
  facts: Array<{ identifier: string; title: string; url: string; last_seen: string }>
  instructions: Array<{ id: string; text: string; createdAt: string }> | null
  config: Map<string, string | null>
  workspaceId: string | null
  tools: unknown
  lastAccessed: number
}

function buildConfigData(cache: UserCacheEntry): {
  configKeys: string[]
  config: Record<string, string | null>
} {
  const configKeys: string[] = []
  const config: Record<string, string | null> = {}
  for (const [key, value] of cache.config) {
    if (value !== null && !key.endsWith('_loaded')) {
      configKeys.push(key)
      config[key] = value
    }
  }
  return { configKeys, config }
}

function mapHistoryEntry(m: ModelMessage): {
  role: string
  content: string
  tool_calls?: unknown
  tool_call_id?: string
} {
  const result: {
    role: string
    content: string
    tool_calls?: unknown
    tool_call_id?: string
  } = {
    role: m.role ?? 'unknown',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }
  if ('tool_calls' in m) {
    result.tool_calls = m.tool_calls
  }
  if ('tool_call_id' in m && typeof m.tool_call_id === 'string') {
    result.tool_call_id = m.tool_call_id
  }
  return result
}

function buildSnapshot(id: string, cache: UserCacheEntry): SessionSnapshot {
  const { configKeys, config } = buildConfigData(cache)

  return {
    userId: id,
    lastAccessed: cache.lastAccessed,
    historyLength: cache.history.length,
    summary: cache.summary,
    factsCount: cache.facts.length,
    facts: cache.facts.map((f) => ({
      identifier: f.identifier,
      title: f.title,
      url: f.url,
      lastSeen: f.last_seen,
    })),
    configKeys,
    config,
    workspaceId: cache.workspaceId,
    hasTools: cache.tools !== null,
    instructionsCount: cache.instructions?.length ?? 0,
    instructions: cache.instructions ?? null,
    history: cache.history.map(mapHistoryEntry),
  }
}

export function getSessionSnapshots(userId: string): SessionSnapshot[] {
  const snapshots: SessionSnapshot[] = []
  for (const [id, cache] of _userCaches) {
    if (id !== userId) continue
    snapshots.push(buildSnapshot(id, cache as UserCacheEntry))
  }
  return snapshots
}
