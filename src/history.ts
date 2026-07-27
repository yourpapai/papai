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
import { rebuildCoalescedText, type PapaiTurnMeta } from './message-edit/segments.js'

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

function papaiMeta(msg: ModelMessage): PapaiTurnMeta | undefined {
  const opts = (msg as { providerOptions?: { papai?: PapaiTurnMeta } }).providerOptions?.papai
  return opts
}

/**
 * Mutate the stored user turn whose `providerOptions.papai.messageIds` contains
 * `messageId`, replacing that segment's text with `newText` and rebuilding the
 * turn's coalesced content. Returns `false` (no-op, never throws) when no turn
 * carries that messageId — e.g. history was compacted, or the turn predates
 * this feature (no `providerOptions.papai`).
 *
 * Only the FIRST matching turn is mutated; later turns are left untouched.
 * Persists via `saveHistory` (in-memory cache + background DB sync).
 */
export function applyEditToHistory(contextId: string, messageId: string, newText: string): boolean {
  const history = [...loadHistory(contextId)]
  let mutated = false
  const next = history.map((msg) => {
    if (mutated) return msg
    if (msg.role !== 'user') return msg
    const meta = papaiMeta(msg)
    if (meta === undefined || !meta.messageIds.includes(messageId)) return msg
    const segments = meta.segments.map((s) => (s.messageId === messageId ? { ...s, text: newText } : s))
    const content = rebuildCoalescedText(segments, { isThread: meta.isThread, isDm: meta.isDm })
    mutated = true
    return {
      ...msg,
      content,
      providerOptions: {
        ...(msg as ModelMessage).providerOptions,
        papai: { ...meta, segments },
      },
    } as ModelMessage
  })
  if (!mutated) {
    log.debug({ contextId, messageId }, 'applyEditToHistory: messageId not found in any user turn')
    return false
  }
  saveHistory(contextId, next)
  log.info({ contextId, messageId }, 'applyEditToHistory: user turn rewritten')
  return true
}
