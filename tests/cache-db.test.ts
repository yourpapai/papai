// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import {
  deleteInstructionFromDb,
  syncConfigToDb,
  syncFactToDb,
  syncHistoryToDb,
  syncInstructionToDb,
  syncSummaryToDb,
  syncWorkspaceToDb,
} from '../src/cache-db.js'
import { userCachesForTesting } from '../src/cache.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import {
  conversationHistory,
  memoryFacts,
  memorySummary,
  userConfig,
  userInstructions,
  users,
} from '../src/db/schema.js'
import { addUser, getKaneoWorkspace, setKaneoWorkspace } from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

function requireDefined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected value to be defined')
  return value
}

describe('cache-db', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
  })

  describe('syncHistoryToDb', () => {
    test('syncs conversation history to DB', async () => {
      const userId = 'user-history-123'
      const messages = [{ role: 'user', content: 'Hello' }]

      syncHistoryToDb(userId, messages)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db.select().from(conversationHistory).where(eq(conversationHistory.userId, userId)).get()

      expect(result).not.toBeUndefined()
      expect(requireDefined(result).messages).toBe(JSON.stringify(messages))
    })

    test('updates existing history', async () => {
      const userId = 'user-history-456'
      const initialMessages = [{ role: 'user', content: 'First' }]
      const updatedMessages = [{ role: 'user', content: 'Second' }]

      syncHistoryToDb(userId, initialMessages)
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      syncHistoryToDb(userId, updatedMessages)
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db.select().from(conversationHistory).where(eq(conversationHistory.userId, userId)).get()

      expect(requireDefined(result).messages).toBe(JSON.stringify(updatedMessages))
    })
  })

  describe('syncSummaryToDb', () => {
    test('syncs summary to DB', async () => {
      const userId = 'user-summary-123'
      const summary = 'This is a test summary'

      syncSummaryToDb(userId, summary)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db.select().from(memorySummary).where(eq(memorySummary.userId, userId)).get()

      expect(result).not.toBeUndefined()
      expect(requireDefined(result).summary).toBe(summary)
    })
  })

  describe('syncFactToDb', () => {
    test('syncs fact to DB', async () => {
      const userId = 'user-fact-123'
      const fact = { identifier: 'fact-1', title: 'Test Fact', url: 'https://example.com' }
      const now = new Date().toISOString()

      syncFactToDb(userId, fact, now)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db
        .select()
        .from(memoryFacts)
        .where(and(eq(memoryFacts.userId, userId), eq(memoryFacts.identifier, 'fact-1')))
        .get()

      expect(result).not.toBeUndefined()
      const definedResult = requireDefined(result)
      expect(definedResult.title).toBe('Test Fact')
      expect(definedResult.url).toBe('https://example.com')
    })

    test('updates lastSeen for existing fact', async () => {
      const userId = 'user-fact-456'
      const fact = { identifier: 'fact-2', title: 'Test Fact', url: 'https://example.com' }
      const firstSeen = new Date(Date.now() - 86400000).toISOString()

      syncFactToDb(userId, fact, firstSeen)
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const updatedNow = new Date().toISOString()
      syncFactToDb(userId, fact, updatedNow)
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db
        .select()
        .from(memoryFacts)
        .where(and(eq(memoryFacts.userId, userId), eq(memoryFacts.identifier, 'fact-2')))
        .get()

      expect(requireDefined(result).lastSeen).toBe(updatedNow)
    })
  })

  describe('syncConfigToDb', () => {
    test('syncs config to DB', async () => {
      const userId = 'user-config-123'
      const key = 'test_key'
      const value = 'test_value'

      syncConfigToDb(userId, key, value)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db
        .select()
        .from(userConfig)
        .where(and(eq(userConfig.userId, userId), eq(userConfig.key, key)))
        .get()

      expect(result).not.toBeUndefined()
      expect(requireDefined(result).value).toBe(value)
    })

    test('updates existing config', async () => {
      const userId = 'user-config-456'
      const key = 'test_key'

      syncConfigToDb(userId, key, 'initial_value')
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      syncConfigToDb(userId, key, 'updated_value')
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db
        .select()
        .from(userConfig)
        .where(and(eq(userConfig.userId, userId), eq(userConfig.key, key)))
        .get()

      expect(requireDefined(result).value).toBe('updated_value')
    })
  })

  describe('syncWorkspaceToDb', () => {
    test('does not create a users row when syncing workspace for an unknown context', async () => {
      const groupId = 'new-group-123'
      const workspaceId = 'workspace-abc'

      expect(getKaneoWorkspace(groupId)).toBeNull()

      setKaneoWorkspace(groupId, workspaceId)
      expect(getKaneoWorkspace(groupId)).toBe(workspaceId)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      userCachesForTesting.delete(groupId)
      expect(getKaneoWorkspace(groupId)).toBe(workspaceId)

      const db = getDrizzleDb()
      const result = db.select().from(users).where(eq(users.platformUserId, groupId)).get()
      expect(result).toBeUndefined()
    })

    test('syncs workspace for an existing scoped user when the user id is unambiguous', async () => {
      const groupId = 'existing-group-456'
      const initialWorkspace = 'workspace-initial'
      const updatedWorkspace = 'workspace-updated'
      addUser({ userId: groupId, platformInstanceId: 'telegram-default', addedBy: 'admin' })

      setKaneoWorkspace(groupId, initialWorkspace)
      expect(getKaneoWorkspace(groupId)).toBe(initialWorkspace)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      setKaneoWorkspace(groupId, updatedWorkspace)
      expect(getKaneoWorkspace(groupId)).toBe(updatedWorkspace)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      userCachesForTesting.delete(groupId)
      expect(getKaneoWorkspace(groupId)).toBe(updatedWorkspace)
    })

    test('does not update workspace when a user id exists on multiple platform instances', async () => {
      const userId = 'ambiguous-workspace-user'
      addUser({ userId, platformInstanceId: 'telegram-default', addedBy: 'admin' })
      addUser({ userId, platformInstanceId: 'discord-default', addedBy: 'admin' })

      syncWorkspaceToDb(userId, 'workspace-ambiguous')

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const rows = getDrizzleDb().select().from(users).where(eq(users.platformUserId, userId)).all()
      expect(rows.map((row) => row.kaneoWorkspaceId)).toEqual([null, null])
    })

    test('directly calls syncWorkspaceToDb for new user without manufacturing a users row', async () => {
      const userId = 'direct-user-123'
      const workspaceId = 'workspace-direct'

      syncWorkspaceToDb(userId, workspaceId)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db.select().from(users).where(eq(users.platformUserId, userId)).get()

      expect(result).toBeUndefined()
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

      syncInstructionToDb(contextId, instruction)

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const result = db.select().from(userInstructions).where(eq(userInstructions.id, instruction.id)).get()

      expect(result).not.toBeUndefined()
      const definedResult = requireDefined(result)
      expect(definedResult.text).toBe(instruction.text)
      expect(definedResult.contextId).toBe(contextId)
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

      syncInstructionToDb(contextId, instruction)
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const db = getDrizzleDb()
      const before = db.select().from(userInstructions).where(eq(userInstructions.id, instruction.id)).get()
      expect(before).not.toBeUndefined()

      deleteInstructionFromDb(contextId, instruction.id)
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 50)
      })

      const after = db.select().from(userInstructions).where(eq(userInstructions.id, instruction.id)).get()
      expect(after).toBeUndefined()
    })
  })
})
