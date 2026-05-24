// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { conversationHistory, memorySummary, memoryFacts, userConfig, userInstructions, users } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'cache-db' })

export function syncHistoryToDb(userId: string, messages: unknown[]): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(conversationHistory)
        .values({ userId, messages: JSON.stringify(messages) })
        .onConflictDoUpdate({
          target: conversationHistory.userId,
          set: { messages: JSON.stringify(messages) },
        })
        .run()
      log.debug({ userId, messageCount: messages.length }, 'History synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync history to DB',
      )
    }
  })
}

export function syncSummaryToDb(userId: string, summary: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(memorySummary)
        .values({ userId, summary, updatedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: memorySummary.userId,
          set: { summary, updatedAt: new Date().toISOString() },
        })
        .run()
      log.debug({ userId, summaryLength: summary.length }, 'Summary synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync summary to DB',
      )
    }
  })
}

export function syncFactToDb(
  userId: string,
  fact: { identifier: string; title: string; url: string },
  now: string,
): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()

      db.transaction((tx) => {
        // Insert or update the fact
        tx.insert(memoryFacts)
          .values({
            userId,
            identifier: fact.identifier,
            title: fact.title,
            url: fact.url,
            lastSeen: now,
          })
          .onConflictDoUpdate({
            target: [memoryFacts.userId, memoryFacts.identifier],
            set: { lastSeen: now },
          })
          .run()

        // Keep only 50 most recent facts per user
        tx.delete(memoryFacts)
          .where(
            and(
              eq(memoryFacts.userId, userId),
              sql`${memoryFacts.identifier} NOT IN (
                SELECT identifier FROM memory_facts 
                WHERE user_id = ${userId} 
                ORDER BY last_seen DESC LIMIT 50
              )`,
            ),
          )
          .run()
      })

      log.debug({ userId, identifier: fact.identifier }, 'Fact synced to DB')
    } catch (error) {
      log.error({ userId, error: error instanceof Error ? error.message : String(error) }, 'Failed to sync fact to DB')
    }
  })
}

export function syncConfigToDb(userId: string, key: string, value: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(userConfig)
        .values({ userId, key, value })
        .onConflictDoUpdate({
          target: [userConfig.userId, userConfig.key],
          set: { value },
        })
        .run()
      log.debug({ userId, key }, 'Config synced to DB')
    } catch (error) {
      log.error(
        { userId, key, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync config to DB',
      )
    }
  })
}

export function syncWorkspaceToDb(userId: string, workspaceId: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      // Check if user/group exists first
      const existing = db
        .select({ platformUserId: users.platformUserId })
        .from(users)
        .where(eq(users.platformUserId, userId))
        .get()
      if (existing === undefined) {
        // Insert new row for groups that don't exist in users table yet
        db.insert(users)
          .values({
            platformUserId: userId,
            platformInstanceId: 'legacy-single',
            addedAt: new Date().toISOString(),
            // System-provisioned workspace
            addedBy: 'system',
            kaneoWorkspaceId: workspaceId,
          })
          .run()
        log.debug({ userId }, 'Workspace synced to DB (new row)')
      } else {
        db.update(users).set({ kaneoWorkspaceId: workspaceId }).where(eq(users.platformUserId, userId)).run()
        log.debug({ userId }, 'Workspace synced to DB (updated)')
      }
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync workspace to DB',
      )
    }
  })
}

export function syncInstructionToDb(
  contextId: string,
  instruction: { id: string; text: string; createdAt: string },
): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(userInstructions)
        .values({ id: instruction.id, contextId, text: instruction.text, createdAt: instruction.createdAt })
        .onConflictDoNothing()
        .run()
      log.debug({ contextId, id: instruction.id }, 'Instruction synced to DB')
    } catch (error) {
      log.error(
        { contextId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync instruction to DB',
      )
    }
  })
}

export function deleteInstructionFromDb(contextId: string, id: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.delete(userInstructions)
        .where(and(eq(userInstructions.id, id), eq(userInstructions.contextId, contextId)))
        .run()
      log.debug({ contextId, id }, 'Instruction deleted from DB')
    } catch (error) {
      log.error(
        { contextId, error: error instanceof Error ? error.message : String(error) },
        'Failed to delete instruction from DB',
      )
    }
  })
}
