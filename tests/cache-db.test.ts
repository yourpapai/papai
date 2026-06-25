// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import {
  deleteConfigFromDb,
  deleteInstructionFromDb,
  syncConfigToDb,
  syncFactToDb,
  syncHistoryToDb,
  syncInstructionToDb,
  syncSummaryToDb,
} from '../src/cache-db.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { conversationHistory, memoryFacts, memorySummary, userConfig, userInstructions } from '../src/db/schema.js'
import { mockLogger, setupTestDb, waitFor } from './utils/test-helpers.js'

function requireDefined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected value to be defined')
  return value
}

describe('cache-db', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('syncHistoryToDb', () => {
    test('syncs conversation history to DB', async () => {
      const userId = 'user-history-123'
      const messages = [{ role: 'user', content: 'Hello' }]
      const db = getDrizzleDb()
      const getRow = (): typeof conversationHistory.$inferSelect | undefined =>
        db.select().from(conversationHistory).where(eq(conversationHistory.userId, userId)).get()

      syncHistoryToDb(userId, messages)
      await waitFor(() => getRow() !== undefined)

      const result = getRow()
      expect(result).not.toBeUndefined()
      expect(requireDefined(result).messages).toBe(JSON.stringify(messages))
    })

    test('updates existing history', async () => {
      const userId = 'user-history-456'
      const initialMessages = [{ role: 'user', content: 'First' }]
      const updatedMessages = [{ role: 'user', content: 'Second' }]
      const db = getDrizzleDb()
      const getRow = (): typeof conversationHistory.$inferSelect | undefined =>
        db.select().from(conversationHistory).where(eq(conversationHistory.userId, userId)).get()

      syncHistoryToDb(userId, initialMessages)
      await waitFor(() => getRow()?.messages === JSON.stringify(initialMessages))

      syncHistoryToDb(userId, updatedMessages)
      await waitFor(() => getRow()?.messages === JSON.stringify(updatedMessages))

      expect(requireDefined(getRow()).messages).toBe(JSON.stringify(updatedMessages))
    })
  })

  describe('syncSummaryToDb', () => {
    test('syncs summary to DB', async () => {
      const userId = 'user-summary-123'
      const summary = 'This is a test summary'
      const db = getDrizzleDb()
      const getRow = (): typeof memorySummary.$inferSelect | undefined =>
        db.select().from(memorySummary).where(eq(memorySummary.userId, userId)).get()

      syncSummaryToDb(userId, summary)
      await waitFor(() => getRow() !== undefined)

      const result = getRow()
      expect(result).not.toBeUndefined()
      expect(requireDefined(result).summary).toBe(summary)
    })
  })

  describe('syncFactToDb', () => {
    test('syncs fact to DB', async () => {
      const userId = 'user-fact-123'
      const fact = { identifier: 'fact-1', title: 'Test Fact', url: 'https://example.com' }
      const now = new Date().toISOString()
      const db = getDrizzleDb()
      const getRow = (): typeof memoryFacts.$inferSelect | undefined =>
        db
          .select()
          .from(memoryFacts)
          .where(and(eq(memoryFacts.userId, userId), eq(memoryFacts.identifier, 'fact-1')))
          .get()

      syncFactToDb(userId, fact, now)
      await waitFor(() => getRow() !== undefined)

      const result = getRow()
      expect(result).not.toBeUndefined()
      const definedResult = requireDefined(result)
      expect(definedResult.title).toBe('Test Fact')
      expect(definedResult.url).toBe('https://example.com')
    })

    test('updates lastSeen for existing fact', async () => {
      const userId = 'user-fact-456'
      const fact = { identifier: 'fact-2', title: 'Test Fact', url: 'https://example.com' }
      const firstSeen = new Date(Date.now() - 86400000).toISOString()
      const db = getDrizzleDb()
      const getRow = (): typeof memoryFacts.$inferSelect | undefined =>
        db
          .select()
          .from(memoryFacts)
          .where(and(eq(memoryFacts.userId, userId), eq(memoryFacts.identifier, 'fact-2')))
          .get()

      syncFactToDb(userId, fact, firstSeen)
      await waitFor(() => getRow()?.lastSeen === firstSeen)

      const updatedNow = new Date().toISOString()
      syncFactToDb(userId, fact, updatedNow)
      await waitFor(() => getRow()?.lastSeen === updatedNow)

      expect(requireDefined(getRow()).lastSeen).toBe(updatedNow)
    })
  })

  describe('syncConfigToDb', () => {
    test('syncs config to DB', async () => {
      const userId = 'user-config-123'
      const key = 'test_key'
      const value = 'test_value'
      const db = getDrizzleDb()
      const getRow = (): typeof userConfig.$inferSelect | undefined =>
        db
          .select()
          .from(userConfig)
          .where(and(eq(userConfig.userId, userId), eq(userConfig.key, key)))
          .get()

      syncConfigToDb(userId, key, value)
      await waitFor(() => getRow() !== undefined)

      const result = getRow()
      expect(result).not.toBeUndefined()
      expect(requireDefined(result).value).toBe(value)
    })

    test('updates existing config', async () => {
      const userId = 'user-config-456'
      const key = 'test_key'
      const db = getDrizzleDb()
      const getRow = (): typeof userConfig.$inferSelect | undefined =>
        db
          .select()
          .from(userConfig)
          .where(and(eq(userConfig.userId, userId), eq(userConfig.key, key)))
          .get()

      syncConfigToDb(userId, key, 'initial_value')
      await waitFor(() => getRow()?.value === 'initial_value')

      syncConfigToDb(userId, key, 'updated_value')
      await waitFor(() => getRow()?.value === 'updated_value')

      expect(requireDefined(getRow()).value).toBe('updated_value')
    })
  })

  describe('syncInstructionToDb', () => {
    test('syncs instruction to DB', async () => {
      const contextId = 'ctx-123'
      const instruction = {
        id: 'inst-1',
        text: 'Do something',
        createdAt: new Date().toISOString(),
      }

      const db = getDrizzleDb()
      const getRow = (): typeof userInstructions.$inferSelect | undefined =>
        db.select().from(userInstructions).where(eq(userInstructions.id, instruction.id)).get()

      syncInstructionToDb(contextId, instruction)
      await waitFor(() => getRow() !== undefined)

      const result = getRow()
      expect(result).not.toBeUndefined()
      const definedResult = requireDefined(result)
      expect(definedResult.text).toBe(instruction.text)
      expect(definedResult.contextId).toBe(contextId)
    })
  })

  describe('deleteConfigFromDb', () => {
    test('removes the config row for the user+key', async () => {
      const userId = 'user-del-cfg-1'
      const db = getDrizzleDb()
      db.insert(userConfig).values({ userId, key: 'timezone', value: 'UTC' }).run()

      deleteConfigFromDb(userId, 'timezone')

      await waitFor(() => {
        const row = db
          .select()
          .from(userConfig)
          .where(and(eq(userConfig.userId, userId), eq(userConfig.key, 'timezone')))
          .get()
        return row === undefined
      })
    })

    test('is a no-op when the row does not exist', async () => {
      deleteConfigFromDb('user-del-cfg-missing', 'timezone')
      await waitFor(() => true)
    })
  })

  describe('deleteInstructionFromDb', () => {
    test('deletes instruction from DB', async () => {
      const contextId = 'ctx-456'
      const instruction = {
        id: 'inst-2',
        text: 'To be deleted',
        createdAt: new Date().toISOString(),
      }

      const db = getDrizzleDb()
      const getRow = (): typeof userInstructions.$inferSelect | undefined =>
        db.select().from(userInstructions).where(eq(userInstructions.id, instruction.id)).get()

      syncInstructionToDb(contextId, instruction)
      await waitFor(() => getRow() !== undefined)
      expect(getRow()).not.toBeUndefined()

      deleteInstructionFromDb(contextId, instruction.id)
      await waitFor(() => getRow() === undefined)

      expect(getRow()).toBeUndefined()
    })
  })
})
