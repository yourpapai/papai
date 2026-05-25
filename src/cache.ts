// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'
import { sql } from 'drizzle-orm'

import { syncConfigToDb, syncFactToDb, syncHistoryToDb, syncSummaryToDb, syncWorkspaceToDb } from './cache-db.js'
import { parseHistoryFromDb } from './cache-helpers.js'
import type { CachedFact, UserCache } from './cache-types.js'
import { getDrizzleDb } from './db/drizzle.js'
import { conversationHistory, memoryFacts, memorySummary, userConfig } from './db/schema.js'
import { emitUser } from './debug/event-bus.js'
import { logger } from './logger.js'

export { addCachedInstruction, deleteCachedInstruction, getCachedInstructions } from './cache-instructions.js'

const log = logger.child({ scope: 'cache' })
const KANEO_WORKSPACE_CONFIG_KEY = 'kaneo_workspace_id'

// --- User Session Cache ---

const userCaches = new Map<string, UserCache>()

// Exported for testing purposes only.
export const userCachesForTesting = userCaches

const SESSION_TTL_MS = 30 * 60 * 1000

export function cleanupExpiredCaches(): void {
  const now = Date.now()
  const expired: string[] = []
  for (const [userId, cache] of userCaches) {
    if (now - cache.lastAccessed > SESSION_TTL_MS) {
      expired.push(userId)
    }
  }
  for (const userId of expired) {
    userCaches.delete(userId)
    emitUser('cache:expire', userId, {})
    log.debug({ userId }, 'Expired user cache removed')
  }
  if (expired.length > 0) {
    log.info({ expiredCount: expired.length }, 'Cleaned up expired user caches')
  }
}

export function getOrCreateCache(userId: string): UserCache {
  let cache = userCaches.get(userId)
  if (cache === undefined) {
    cache = {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map(),
      workspaceId: null,
      tools: null,
      lastAccessed: Date.now(),
    }
    userCaches.set(userId, cache)
  }
  cache.lastAccessed = Date.now()
  return cache
}

export function getCachedHistory(userId: string): readonly ModelMessage[] {
  const cache = getOrCreateCache(userId)
  if (cache.history.length === 0 && !cache.config.has('history_loaded')) {
    log.debug({ userId }, 'Loading history from DB into cache')
    const row = getDrizzleDb()
      .select({ messages: conversationHistory.messages })
      .from(conversationHistory)
      .where(sql`${conversationHistory.userId} = ${userId}`)
      .get()
    if (row !== undefined) {
      const parsed = parseHistoryFromDb(row.messages)
      if (parsed !== null) {
        cache.history = parsed
      }
    }
    cache.config.set('history_loaded', 'true')
    emitUser('cache:load', userId, { field: 'history' })
  }
  return [...cache.history]
}

export function setCachedHistory(userId: string, messages: readonly ModelMessage[]): void {
  const cache = getOrCreateCache(userId)
  cache.history = [...messages]
  syncHistoryToDb(userId, cache.history)
  emitUser('cache:sync', userId, { field: 'history', operation: 'set' })
}

export function appendToCachedHistory(userId: string, messages: readonly ModelMessage[]): void {
  const cache = getOrCreateCache(userId)
  cache.history.push(...messages)
  syncHistoryToDb(userId, cache.history)
  emitUser('cache:sync', userId, { field: 'history', operation: 'append' })
}

export function getCachedSummary(userId: string): string | null {
  const cache = getOrCreateCache(userId)
  if (cache.summary === null && !cache.config.has('summary_loaded')) {
    log.debug({ userId }, 'Loading summary from DB into cache')
    const row = getDrizzleDb()
      .select({ summary: memorySummary.summary })
      .from(memorySummary)
      .where(sql`${memorySummary.userId} = ${userId}`)
      .get()
    cache.summary = row === undefined ? null : row.summary
    cache.config.set('summary_loaded', 'true')
    emitUser('cache:load', userId, { field: 'summary' })
  }
  return cache.summary
}

export function setCachedSummary(userId: string, summary: string): void {
  const cache = getOrCreateCache(userId)
  cache.summary = summary
  syncSummaryToDb(userId, summary)
  emitUser('cache:sync', userId, { field: 'summary', operation: 'set' })
}

export function getCachedFacts(userId: string): readonly CachedFact[] {
  const cache = getOrCreateCache(userId)
  if (cache.facts.length === 0 && !cache.config.has('facts_loaded')) {
    log.debug({ userId }, 'Loading facts from DB into cache')
    const rows = getDrizzleDb()
      .select({
        identifier: memoryFacts.identifier,
        title: memoryFacts.title,
        url: memoryFacts.url,
        last_seen: memoryFacts.lastSeen,
      })
      .from(memoryFacts)
      .where(sql`${memoryFacts.userId} = ${userId}`)
      .orderBy(sql`${memoryFacts.lastSeen} DESC`)
      .all()
    cache.facts = rows
    cache.config.set('facts_loaded', 'true')
    emitUser('cache:load', userId, { field: 'facts' })
  }
  return cache.facts
}

export function upsertCachedFact(userId: string, fact: { identifier: string; title: string; url: string }): void {
  const cache = getOrCreateCache(userId)
  const now = new Date().toISOString()
  const existingIndex = cache.facts.findIndex((f) => f.identifier === fact.identifier)
  if (existingIndex >= 0) {
    cache.facts[existingIndex] = { ...fact, last_seen: now }
  } else {
    cache.facts.unshift({ ...fact, last_seen: now })
    if (cache.facts.length > 50) {
      cache.facts = cache.facts.slice(0, 50)
    }
  }
  syncFactToDb(userId, fact, now)
  emitUser('cache:sync', userId, { field: 'facts', operation: 'upsert' })
}

export function getCachedConfig(userId: string, key: string): string | null {
  const cache = getOrCreateCache(userId)
  if (!cache.config.has(key)) {
    log.debug('Loading config from DB into cache')
    const row = getDrizzleDb()
      .select({ value: userConfig.value })
      .from(userConfig)
      .where(sql`${userConfig.userId} = ${userId} AND ${userConfig.key} = ${key}`)
      .get()
    cache.config.set(key, row === undefined ? null : row.value)
    emitUser('cache:load', userId, { field: 'config' })
  }
  const value = cache.config.get(key)
  if (value === undefined) {
    return null
  }
  return value
}

export function setCachedConfig(userId: string, key: string, value: string): void {
  const cache = getOrCreateCache(userId)
  cache.config.set(key, value)
  syncConfigToDb(userId, key, value)
  emitUser('cache:sync', userId, { field: 'config', operation: 'set' })
}

export function getCachedWorkspace(userId: string): string | null {
  const cache = getOrCreateCache(userId)
  if (cache.workspaceId === null && !cache.config.has('workspace_loaded')) {
    log.debug({ userId }, 'Loading workspace from DB into cache')
    const row = getDrizzleDb()
      .select({ value: userConfig.value })
      .from(userConfig)
      .where(sql`${userConfig.userId} = ${userId} AND ${userConfig.key} = ${KANEO_WORKSPACE_CONFIG_KEY}`)
      .get()
    if (row === undefined) {
      cache.workspaceId = null
    } else {
      cache.workspaceId = row.value
    }
    cache.config.set('workspace_loaded', 'true')
    emitUser('cache:load', userId, { field: 'workspace' })
  }
  return cache.workspaceId
}

export function setCachedWorkspace(userId: string, workspaceId: string): void {
  const cache = getOrCreateCache(userId)
  cache.workspaceId = workspaceId
  syncWorkspaceToDb(userId, workspaceId)
  emitUser('cache:sync', userId, { field: 'workspace', operation: 'set' })
}

export function getCachedTools(userId: string): unknown {
  const tools = getOrCreateCache(userId).tools
  return tools === null ? undefined : tools
}

export function setCachedTools(userId: string, tools: unknown): void {
  getOrCreateCache(userId).tools = tools
}

export function clearCachedTools(userId: string): void {
  getOrCreateCache(userId).tools = null
}

/**
 * Clear cached tools for a context id and all of its derived group cache keys.
 * DM cache key is the bare contextId; group cache keys are `${contextId}:${chatUserId}:${username}`.
 */
export function clearCachedToolsByPrefix(contextId: string): void {
  const prefix = `${contextId}:`
  for (const [key, cache] of userCaches) {
    if (key === contextId || key.startsWith(prefix)) {
      cache.tools = null
    }
  }
  log.debug({ contextId }, 'Cleared cached tools by prefix')
}

export function evictUser(userId: string): void {
  userCaches.delete(userId)
  emitUser('cache:expire', userId, {})
  log.debug({ userId }, 'User cache evicted')
}

export function clearCachedFacts(userId: string): void {
  const cache = userCaches.get(userId)
  if (cache === undefined) {
    log.debug({ userId }, 'No facts cache to clear (cache not initialized)')
    return
  }
  cache.facts = []
  cache.config.delete('facts_loaded')
  log.debug({ userId }, 'Facts cache cleared')
}

export function clearCachedHistoryFlag(userId: string): void {
  const cache = userCaches.get(userId)
  if (cache === undefined) {
    log.debug({ userId }, 'No history cache to clear flag (cache not initialized)')
    return
  }
  cache.config.delete('history_loaded')
  log.debug({ userId }, 'History loaded flag cleared')
}
