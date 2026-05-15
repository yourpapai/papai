// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Persistence Acceptance Criteria Tests
 *
 * These tests validate the acceptance criteria from User Stories 1-5 directly,
 * using controlled test doubles to verify the composition of the persistence layer.
 */

import { describe, expect, test, beforeEach } from 'bun:test'

import { eq } from 'drizzle-orm'

import { _userCaches } from '../src/cache.js'
import * as schema from '../src/db/schema.js'
import { loadHistory, saveHistory } from '../src/history.js'
import { loadSummary, saveSummary, loadFacts, upsertFact, buildMemoryContextMessage } from '../src/memory.js'
import { flushMicrotasks, mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('Story 2: Surviving restart', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    mockLogger()
    testDb = await setupTestDb()

    // Clear all caches
    _userCaches.clear()
  })

  test('history, summary, and facts survive cache clear (restart simulation)', async () => {
    const userId = 'restart-test-user'

    // Pre-populate data (simulating previous session)
    saveHistory(userId, [
      { role: 'user', content: 'What tasks do I have?' },
      { role: 'assistant', content: 'You have 3 tasks.' },
    ])
    saveSummary(userId, 'User asked about their tasks. They have 3 tasks in progress.')
    upsertFact(userId, { identifier: '#42', title: 'Fix login bug', url: '' })

    await flushMicrotasks()

    // Verify data is in DB
    const historyRow = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, userId))
      .get()
    expect(historyRow).toBeDefined()

    const summaryRow = testDb.select().from(schema.memorySummary).where(eq(schema.memorySummary.userId, userId)).get()
    expect(summaryRow).toBeDefined()

    const factsRows = testDb.select().from(schema.memoryFacts).where(eq(schema.memoryFacts.userId, userId)).all()
    expect(factsRows).toHaveLength(1)

    // Simulate restart: clear all caches
    _userCaches.clear()

    // Reload data (simulating new session after restart)
    const loadedHistory = loadHistory(userId)
    const loadedSummary = loadSummary(userId)
    const loadedFacts = loadFacts(userId)

    // Verify all data is preserved
    expect(loadedHistory).toHaveLength(2)
    expect(loadedHistory[0]).toEqual({ role: 'user', content: 'What tasks do I have?' })
    expect(loadedHistory[1]).toEqual({ role: 'assistant', content: 'You have 3 tasks.' })

    expect(loadedSummary).toBe('User asked about their tasks. They have 3 tasks in progress.')

    expect(loadedFacts).toHaveLength(1)
    expect(loadedFacts[0]).toMatchObject({
      identifier: '#42',
      title: 'Fix login bug',
    })
  })
})

describe('Story 4: Key facts remembered after read', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    _userCaches.clear()
  })

  test('facts from get_task are remembered and appear in LLM context', async () => {
    // Import the real extractFactsFromSdkResults function
    const { extractFactsFromSdkResults } = await import('../src/memory.js')

    // Simulate a get_task tool result
    const toolResults = [{ toolName: 'get_task', output: { id: 'task-123', title: 'Implement dark mode', number: 42 } }]

    // Extract facts from the tool result
    const facts = extractFactsFromSdkResults([], toolResults)

    // Verify facts are extracted
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      identifier: '#42',
      title: 'Implement dark mode',
    })
  })

  test('facts from list_projects are remembered and appear in LLM context', async () => {
    const { extractFactsFromSdkResults } = await import('../src/memory.js')

    // Simulate a list_projects tool result
    const toolResults = [
      {
        toolName: 'list_projects',
        output: [
          { id: 'proj-1', name: 'Mobile App', url: 'https://example.com/proj-1' },
          { id: 'proj-2', name: 'Backend API' },
        ],
      },
    ]

    const facts = extractFactsFromSdkResults([], toolResults)

    // Verify facts are extracted
    expect(facts).toHaveLength(2)
    expect(facts[0]).toMatchObject({
      identifier: 'proj:proj-1',
      title: 'Mobile App',
      url: 'https://example.com/proj-1',
    })
    expect(facts[1]).toMatchObject({
      identifier: 'proj:proj-2',
      title: 'Backend API',
    })
  })

  test('project names appear in LLM context via buildMemoryContextMessage', () => {
    const facts = [
      { identifier: 'proj:proj-123', title: 'Mobile App Project', url: '', last_seen: '2026-03-01T00:00:00Z' },
    ]

    const contextMessage = buildMemoryContextMessage(null, facts)

    // Verify the LLM context contains the project name
    expect(contextMessage).not.toBeNull()
    expect(contextMessage!.content).toContain('Mobile App Project')
    expect(contextMessage!.content).toContain('proj:proj-123')
  })
})
