// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { getCachedHistory, setCachedHistory, appendToCachedHistory, clearCachedHistoryFlag } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { conversationHistory } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'history' })

export function loadHistory(userId: string): readonly ModelMessage[] {
  log.debug({ userId }, 'loadHistory called')
  return getCachedHistory(userId)
}

export function saveHistory(userId: string, messages: readonly ModelMessage[]): void {
  log.debug({ userId, messageCount: messages.length }, 'saveHistory called')
  setCachedHistory(userId, messages)
  log.info({ userId, messageCount: messages.length }, 'History saved to cache (DB sync in background)')
}

export function appendHistory(userId: string, messages: readonly ModelMessage[]): void {
  log.debug({ userId, appendCount: messages.length }, 'appendHistory called')
  appendToCachedHistory(userId, messages)
}

export function clearHistory(userId: string): void {
  log.debug({ userId }, 'clearHistory called')
  setCachedHistory(userId, [])
  clearCachedHistoryFlag(userId)

  const db = getDrizzleDb()
  db.delete(conversationHistory).where(eq(conversationHistory.userId, userId)).run()

  log.info({ userId }, 'History cleared')
}
