import { mock, describe, expect, test, beforeEach } from 'bun:test'

import type { LanguageModel, ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'

import * as schema from '../src/db/schema.js'
import {
  buildMemoryContextMessage,
  extractFactsFromSdkResults,
  loadSummary,
  saveSummary,
  loadFacts,
  upsertFact,
  clearSummary,
  clearFacts,
  trimWithMemoryModel,
} from '../src/memory.js'
import { extractFacts } from './helpers/extract-facts.js'
import { clearUserCache } from './utils/test-cache.js'
import { flushMicrotasks, mockLogger, setupTestDb } from './utils/test-helpers.js'

const makeMessages = (count: number): Array<{ role: 'user' | 'assistant'; content: string }> =>
  Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `Message ${i}`,
  }))

describe('memory', () => {
  // Mock getDrizzleDb to return our test database
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  type GenerateTextResult = { text: string }

  let generateTextImpl: () => Promise<GenerateTextResult>

  beforeEach(async () => {
    // Reset mutable state to defaults
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: JSON.stringify({ keep_indices: [0, 1], summary: 'Updated summary text' }) })

    // Register mocks
    mockLogger()

    void mock.module('ai', () => ({
      generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
    }))

    testDb = await setupTestDb()
  })

  describe('loadSummary', () => {
    test('returns null when no row exists', () => {
      expect(loadSummary('999')).toBeNull()
    })

    test('returns summary string when row exists', () => {
      testDb
        .insert(schema.memorySummary)
        .values({ userId: '1', summary: 'Previous conversation summary', updatedAt: new Date().toISOString() })
        .run()
      expect(loadSummary('1')).toBe('Previous conversation summary')
    })
  })

  describe('saveSummary', () => {
    test('persists summary', async () => {
      saveSummary('1', 'Test summary')
      await flushMicrotasks()
      const row = testDb.select().from(schema.memorySummary).where(eq(schema.memorySummary.userId, '1')).get()
      expect(row).toBeDefined()
      expect(row!.summary).toBe('Test summary')
    })

    test('calls INSERT OR REPLACE', async () => {
      saveSummary('1', 'Test')
      await flushMicrotasks()
      const row = testDb.select().from(schema.memorySummary).where(eq(schema.memorySummary.userId, '1')).get()
      expect(row).toBeDefined()
      expect(row!.userId).toBe('1')
    })
  })

  describe('clearSummary', () => {
    test('removes summary', () => {
      testDb
        .insert(schema.memorySummary)
        .values({ userId: '1', summary: 'Summary', updatedAt: new Date().toISOString() })
        .run()
      clearSummary('1')
      const row = testDb.select().from(schema.memorySummary).where(eq(schema.memorySummary.userId, '1')).get()
      expect(row).toBeUndefined()
    })
  })

  describe('clearFacts', () => {
    test('clears facts from database', () => {
      // Insert a fact first
      testDb
        .insert(schema.memoryFacts)
        .values({ userId: '1', identifier: '#42', title: 'Test', url: '', lastSeen: new Date().toISOString() })
        .run()
      clearFacts('1')
      const rows = testDb.select().from(schema.memoryFacts).where(eq(schema.memoryFacts.userId, '1')).all()
      expect(rows).toHaveLength(0)
    })
  })

  describe('buildMemoryContextMessage', () => {
    test('returns null when both summary and facts are empty', () => {
      expect(buildMemoryContextMessage(null, [])).toBeNull()
    })

    test('returns null for empty string summary and no facts', () => {
      expect(buildMemoryContextMessage('', [])).toBeNull()
    })

    test('returns system message with summary only', () => {
      const result = buildMemoryContextMessage('User created #42', [])
      expect(result).not.toBeNull()
      expect(result!.role).toBe('system')
      expect(result!.content).toContain('Summary: User created #42')
      expect(result!.content).toContain('=== Memory context ===')
    })

    test('returns system message with facts only', () => {
      const facts = [
        {
          identifier: '#42',
          title: 'Fix login',
          url: 'https://linear.app/#42',
          last_seen: '2026-03-01T00:00:00Z',
        },
      ]
      const result = buildMemoryContextMessage(null, facts)
      expect(result).not.toBeNull()
      expect(result!.content).toContain('#42')
      expect(result!.content).toContain('Fix login')
      expect(result!.content).toContain('Recently accessed entities')
    })

    test('returns combined message with both summary and facts', () => {
      const facts = [{ identifier: '#42', title: 'Fix login', url: '', last_seen: '2026-03-01T00:00:00Z' }]
      const result = buildMemoryContextMessage('Previous summary', facts)
      expect(result).not.toBeNull()
      expect(result!.content).toContain('Summary: Previous summary')
      expect(result!.content).toContain('#42')
    })

    test('formats last_seen date as YYYY-MM-DD', () => {
      const facts = [{ identifier: '#1', title: 'Test', url: '', last_seen: '2026-03-05T14:30:00Z' }]
      const result = buildMemoryContextMessage(null, facts)
      expect(result!.content).toContain('last seen 2026-03-05')
    })
  })

  describe('extractFacts', () => {
    test('extracts fact from create_task result', () => {
      const results = [
        {
          toolName: 'create_task',
          result: { id: 'task-42', title: 'New task', number: 42 },
        },
      ]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#42')
      expect(facts[0]!.title).toBe('New task')
    })

    test('extracts fact from update_task result', () => {
      const results = [{ toolName: 'update_task', result: { id: 'task-38', number: 38 } }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#38')
      // no title → falls back to identifier
      expect(facts[0]!.title).toBe('#38')
    })

    test('extracts fact from delete_task result', () => {
      const results = [{ toolName: 'delete_task', result: { id: 'task-10', number: 10 } }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#10')
      expect(facts[0]!.title).toBe('#10')
    })

    test('extracts fact from update_project result', () => {
      const results = [{ toolName: 'update_project', result: { id: 'proj-99', name: 'Updated Name' } }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('proj:proj-99')
      expect(facts[0]!.title).toBe('Updated Name')
    })

    test('extracts fact from get_task result', () => {
      const results = [{ toolName: 'get_task', result: { id: 'task-10', title: 'Details', number: 10 } }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#10')
      expect(facts[0]!.title).toBe('Details')
    })

    test('extracts facts from list_projects result', () => {
      const projects = [
        { id: 'proj-1', name: 'Project A', url: 'https://example.com/proj-1' },
        { id: 'proj-2', name: 'Project B' },
        { id: 'proj-3', name: 'Project C' },
      ]
      const results = [{ toolName: 'list_projects', result: projects }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(3)
      expect(facts[0]!.identifier).toBe('proj:proj-1')
      expect(facts[0]!.title).toBe('Project A')
      expect(facts[0]!.url).toBe('https://example.com/proj-1')
      expect(facts[1]!.identifier).toBe('proj:proj-2')
      expect(facts[1]!.title).toBe('Project B')
      expect(facts[2]!.identifier).toBe('proj:proj-3')
      expect(facts[2]!.title).toBe('Project C')
    })

    test('caps list_projects at 10 entries', () => {
      const projects = Array.from({ length: 12 }, (_, i) => ({ id: `proj-${i}`, name: `Project ${i}` }))
      const results = [{ toolName: 'list_projects', result: projects }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(10)
    })

    test('returns empty array for empty list_projects result', () => {
      const results = [{ toolName: 'list_projects', result: [] }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(0)
    })

    test('returns empty array for non-array list_projects result', () => {
      const results = [{ toolName: 'list_projects', result: { id: 'proj-1', name: 'Project' } }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(0)
    })

    test('skips malformed projects in list_projects result', () => {
      const projects = [
        { id: 'proj-1', name: 'Project A' },
        // Missing name - should be skipped
        { id: 'proj-2' },
        // Missing id - should be skipped
        { name: 'Project C' },
      ]
      const results = [{ toolName: 'list_projects', result: projects }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('proj:proj-1')
      expect(facts[0]!.title).toBe('Project A')
    })

    test('does not extract facts from search_tasks result', () => {
      const items = [
        { id: 'task-1', title: 'A', number: 1 },
        { id: 'task-2', title: 'B', number: 2 },
      ]
      const results = [{ toolName: 'search_tasks', result: items }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(0)
    })

    test('returns empty array for unknown tool', () => {
      const results = [{ toolName: 'unknown_tool', result: { id: 'X' } }]
      const facts = extractFacts(results)
      expect(facts).toEqual([])
    })

    test('returns empty array for malformed result', () => {
      const results = [{ toolName: 'create_task', result: { no_id: true } }]
      const facts = extractFacts(results)
      expect(facts).toEqual([])
    })

    test('extracts fact from create_project result', () => {
      const results = [
        {
          toolName: 'create_project',
          result: { id: 'proj-123', name: 'Backend Migration', url: 'https://kaneo.app/project/proj-123' },
        },
      ]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('proj:proj-123')
      expect(facts[0]!.title).toBe('Backend Migration')
      expect(facts[0]!.url).toBe('https://kaneo.app/project/proj-123')
    })

    test('extracts create_project fact without url', () => {
      const results = [{ toolName: 'create_project', result: { id: 'proj-456', name: 'Frontend Refactor' } }]
      const facts = extractFacts(results)
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('proj:proj-456')
      expect(facts[0]!.title).toBe('Frontend Refactor')
      expect(facts[0]!.url).toBe('')
    })

    test('ignores malformed create_project result', () => {
      const results = [{ toolName: 'create_project', result: { no_id: true, name: 'Test' } }]
      const facts = extractFacts(results)
      expect(facts).toEqual([])
    })
  })

  describe('upsertFact eviction', () => {
    beforeEach(async () => {
      clearUserCache('999')
      await flushMicrotasks()
    })

    test('evicts oldest facts when exceeding FACTS_CAP', async () => {
      const userId = '999'
      // Insert 52 facts (over the 50 cap)
      for (let i = 0; i < 52; i++) {
        upsertFact(userId, {
          identifier: `#${i}`,
          title: `Task ${i}`,
          url: `https://kaneo.app/task/${i}`,
        })
      }
      await flushMicrotasks()

      const facts = loadFacts(userId)
      // Should be capped at 50 (FACTS_CAP)
      expect(facts).toHaveLength(50)
      // Verify the facts are returned sorted by last_seen DESC
      for (let i = 1; i < facts.length; i++) {
        expect(facts[i]!.last_seen <= facts[i - 1]!.last_seen).toBe(true)
      }

      // Cleanup
      clearFacts(userId)
      clearUserCache(userId)
      await flushMicrotasks()
    })

    test('updates last_seen on duplicate fact insert', async () => {
      const userId = '999'
      const fact = { identifier: '#100', title: 'Test Task', url: '' }

      upsertFact(userId, fact)
      await flushMicrotasks()
      const firstLoad = loadFacts(userId)
      const firstSeen = firstLoad[0]!.last_seen

      // Small delay to ensure different timestamp
      await Bun.sleep(10)

      upsertFact(userId, fact)
      await flushMicrotasks()
      const secondLoad = loadFacts(userId)
      const secondSeen = secondLoad[0]!.last_seen

      expect(secondSeen).not.toBe(firstSeen)
      expect(secondLoad).toHaveLength(1)

      // Cleanup
      clearFacts(userId)
      clearUserCache(userId)
      await flushMicrotasks()
    })
  })

  describe('trimWithMemoryModel', () => {
    const mockModel: LanguageModel = 'test-model'

    test('returns trimmed messages and summary', async () => {
      const history = makeMessages(5)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0, 2, 4], summary: 'Test summary' }),
        })

      const result = await trimWithMemoryModel(history, 2, 10, null, mockModel)

      expect(result.trimmedMessages).toHaveLength(3)
      expect(result.trimmedMessages[0]).toEqual(history[0])
      expect(result.trimmedMessages[1]).toEqual(history[2])
      expect(result.trimmedMessages[2]).toEqual(history[4])
      expect(result.summary).toBe('Test summary')
    })

    test('filters out-of-range indices', async () => {
      const history = makeMessages(3)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0, 1, 99], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 1, 10, null, mockModel)

      // 99 is out of range — filtered out
      expect(result.trimmedMessages).toHaveLength(2)
    })

    test('deduplicates indices', async () => {
      const history = makeMessages(5)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [1, 1, 2], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 1, 10, null, mockModel)

      expect(result.trimmedMessages).toHaveLength(2)
      expect(result.trimmedMessages[0]).toEqual(history[1])
      expect(result.trimmedMessages[1]).toEqual(history[2])
    })

    test('pads to trimMin when model returns too few indices', async () => {
      const history = makeMessages(10)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0, 1], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 5, 10, null, mockModel)

      expect(result.trimmedMessages.length).toBeGreaterThanOrEqual(5)
    })

    test('caps at trimMax when model returns too many indices', async () => {
      const history = makeMessages(10)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 1, 3, null, mockModel)

      expect(result.trimmedMessages).toHaveLength(3)
    })

    test('does not trim when indices equal trimMax', async () => {
      const history = makeMessages(5)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0, 1, 2], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 1, 3, null, mockModel)

      expect(result.trimmedMessages).toHaveLength(3)
      expect(result.trimmedMessages[0]).toEqual(history[0])
    })

    test('does not pad when indices equal trimMin', async () => {
      const history = makeMessages(10)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0, 1, 2, 3, 4], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 5, 10, null, mockModel)

      expect(result.trimmedMessages).toHaveLength(5)
    })

    test('padded indices are sorted in ascending order', async () => {
      const history = makeMessages(10)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 4, 10, null, mockModel)

      expect(result.trimmedMessages.length).toBeGreaterThanOrEqual(4)
      // Verify sorted: each message should appear later in history than the previous
      for (let i = 1; i < result.trimmedMessages.length; i++) {
        const prevIdx = history.findIndex((m) => m === result.trimmedMessages[i - 1])
        const currIdx = history.findIndex((m) => m === result.trimmedMessages[i])
        expect(currIdx).toBeGreaterThan(prevIdx)
      }
    })

    test('slices most recent indices when capping at trimMax', async () => {
      const history = makeMessages(10)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0, 1, 2, 3, 4, 5], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 1, 3, null, mockModel)

      expect(result.trimmedMessages).toHaveLength(3)
      // The clamping takes the LAST trimMax items from sorted list
      expect(result.trimmedMessages[0]).toEqual(history[3])
      expect(result.trimmedMessages[1]).toEqual(history[4])
      expect(result.trimmedMessages[2]).toEqual(history[5])
    })

    test('padding fills from highest indices first', async () => {
      const history = makeMessages(6)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [0], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 4, 10, null, mockModel)

      expect(result.trimmedMessages.length).toBeGreaterThanOrEqual(4)
      // Padding takes from candidates.reverse() = highest indices first
      // So we expect index 0 (kept) plus indices 5, 4, 3 (padded from highest)
      expect(result.trimmedMessages[0]).toEqual(history[0])
      // Last three should be the highest indices
      const lastThree = result.trimmedMessages.slice(-3)
      expect(lastThree[0]).toEqual(history[3])
      expect(lastThree[1]).toEqual(history[4])
      expect(lastThree[2]).toEqual(history[5])
    })

    test('negative indices are filtered out', async () => {
      const history = makeMessages(5)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [-1, 0, 2], summary: 'Summary' }),
        })

      const result = await trimWithMemoryModel(history, 1, 10, null, mockModel)

      expect(result.trimmedMessages).toHaveLength(2)
      expect(result.trimmedMessages[0]).toEqual(history[0])
      expect(result.trimmedMessages[1]).toEqual(history[2])
    })

    test('trimWithMemoryModel with empty history returns empty', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: JSON.stringify({ keep_indices: [], summary: 'Empty conversation' }),
        })

      const result = await trimWithMemoryModel([], 0, 10, null, mockModel)
      expect(result.trimmedMessages).toEqual([])
      expect(result.summary).toBe('Empty conversation')
    })

    test('trimWithMemoryModel throws when generateText fails', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM API failure'))

      const history: ModelMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ]

      await expect(trimWithMemoryModel(history, 0, 10, null, mockModel)).rejects.toThrow('LLM API failure')
    })
  })

  // ============================================================================
  // Tests: extractFactsFromSdkResults (actual source function)
  // ============================================================================

  describe('extractFactsFromSdkResults', () => {
    test('extracts fact from create_task result', () => {
      const facts = extractFactsFromSdkResults(
        [],
        [{ toolName: 'create_task', output: { id: 'task-1', title: 'New task', number: 42 } }],
      )
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#42')
      expect(facts[0]!.title).toBe('New task')
      expect(facts[0]!.url).toBe('')
    })

    test('extracts task fact from proxied create_task result', () => {
      const facts = extractFactsFromSdkResults(
        [{ toolName: 'papai_tool', input: { tool: 'create_task', args: '{"title":"New task"}' } }],
        [{ toolName: 'papai_tool', output: { id: 'task-1', title: 'New task', number: 42 } }],
      )

      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#42')
      expect(facts[0]!.title).toBe('New task')
      expect(facts[0]!.url).toBe('')
    })

    test('extracts fact from get_task result', () => {
      const facts = extractFactsFromSdkResults(
        [],
        [{ toolName: 'get_task', output: { id: 'task-10', title: 'Details', number: 10 } }],
      )
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#10')
    })

    test('extracts fact from delete_task result', () => {
      const facts = extractFactsFromSdkResults([], [{ toolName: 'delete_task', output: { id: 'task-5', number: 5 } }])
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#5')
    })

    test('extracts fact from update_task result', () => {
      const facts = extractFactsFromSdkResults(
        [],
        [{ toolName: 'update_task', output: { id: 'task-3', number: 3, title: 'Updated' } }],
      )
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('#3')
      expect(facts[0]!.title).toBe('Updated')
    })

    test('uses id as identifier when number is missing', () => {
      const facts = extractFactsFromSdkResults([], [{ toolName: 'create_task', output: { id: 'task-99' } }])
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('task-99')
      expect(facts[0]!.title).toBe('task-99')
    })

    test('extracts fact from create_project result', () => {
      const facts = extractFactsFromSdkResults(
        [],
        [{ toolName: 'create_project', output: { id: 'proj-1', name: 'Backend' } }],
      )
      expect(facts).toHaveLength(1)
      expect(facts[0]!.identifier).toBe('proj:proj-1')
      expect(facts[0]!.title).toBe('Backend')
      expect(facts[0]!.url).toBe('')
    })

    test('extracts fact from update_project with url', () => {
      const facts = extractFactsFromSdkResults(
        [],
        [{ toolName: 'update_project', output: { id: 'proj-2', name: 'Frontend', url: 'https://example.com' } }],
      )
      expect(facts).toHaveLength(1)
      expect(facts[0]!.url).toBe('https://example.com')
    })

    test('does not extract fact from delete_project result', () => {
      const facts = extractFactsFromSdkResults([], [{ toolName: 'delete_project', output: { id: 'proj-3' } }])
      expect(facts).toHaveLength(0)
    })

    test('extracts facts from list_projects result capped at 10', () => {
      const projects = Array.from({ length: 12 }, (_, i) => ({ id: `proj-${i}`, name: `Project ${i}` }))
      const facts = extractFactsFromSdkResults([], [{ toolName: 'list_projects', output: projects }])
      expect(facts).toHaveLength(10)
      expect(facts[0]!.identifier).toBe('proj:proj-0')
      expect(facts[9]!.identifier).toBe('proj:proj-9')
    })

    test('extracts project facts from proxied list_projects result', () => {
      const facts = extractFactsFromSdkResults(
        [{ toolName: 'papai_tool', input: { tool: 'list_projects', args: '{}' } }],
        [
          {
            toolName: 'papai_tool',
            output: [
              { id: 'proj-1', name: 'Backend' },
              { id: 'proj-2', name: 'Frontend', url: 'https://example.com' },
            ],
          },
        ],
      )

      expect(facts).toHaveLength(2)
      expect(facts[0]).toMatchObject({ identifier: 'proj:proj-1', title: 'Backend', url: '' })
      expect(facts[1]).toMatchObject({
        identifier: 'proj:proj-2',
        title: 'Frontend',
        url: 'https://example.com',
      })
    })

    test('does not extract facts from papai_tool without internal tool name', () => {
      const facts = extractFactsFromSdkResults(
        [{ toolName: 'papai_tool', input: { args: '{"title":"New task"}' } }],
        [{ toolName: 'papai_tool', output: { id: 'task-1', title: 'New task', number: 42 } }],
      )

      expect(facts).toHaveLength(0)
    })

    test('returns empty for non-array list_projects output', () => {
      const facts = extractFactsFromSdkResults([], [{ toolName: 'list_projects', output: { id: 'x', name: 'Y' } }])
      expect(facts).toHaveLength(0)
    })

    test('ignores unknown tool names', () => {
      const facts = extractFactsFromSdkResults(
        [],
        [{ toolName: 'search_tasks', output: { id: 'task-1', title: 'A', number: 1 } }],
      )
      expect(facts).toHaveLength(0)
    })

    test('handles multiple tool results', () => {
      const facts = extractFactsFromSdkResults(
        [],
        [
          { toolName: 'create_task', output: { id: 'task-1', title: 'Task', number: 1 } },
          { toolName: 'create_project', output: { id: 'proj-1', name: 'Proj' } },
        ],
      )
      expect(facts).toHaveLength(2)
      expect(facts[0]!.identifier).toBe('#1')
      expect(facts[1]!.identifier).toBe('proj:proj-1')
    })

    test('skips malformed results', () => {
      const facts = extractFactsFromSdkResults([], [{ toolName: 'create_task', output: { no_id: true } }])
      expect(facts).toHaveLength(0)
    })
  })

  // ============================================================================
  // Tests: buildMemoryContextMessage format details
  // ============================================================================

  describe('buildMemoryContextMessage format details', () => {
    test('separates summary and facts sections with double newline', () => {
      const facts = [{ identifier: '#1', title: 'T', url: '', last_seen: '2026-01-01T00:00:00Z' }]
      const result = buildMemoryContextMessage('My summary', facts)
      expect(result!.content).toContain('Summary: My summary\n\nRecently accessed entities')
    })

    test('separates fact lines with single newline', () => {
      const facts = [
        { identifier: '#1', title: 'First', url: '', last_seen: '2026-01-01T00:00:00Z' },
        { identifier: '#2', title: 'Second', url: '', last_seen: '2026-02-01T00:00:00Z' },
      ]
      const result = buildMemoryContextMessage(null, facts)
      const content = result!.content
      // Lines should be separated by \n NOT \n\n within the facts section
      expect(content).toContain('- #1: "First" — last seen 2026-01-01\n- #2: "Second" — last seen 2026-02-01')
    })

    test('slices last_seen to exactly 10 characters', () => {
      const facts = [{ identifier: '#1', title: 'T', url: '', last_seen: '2026-03-15T14:30:00.000Z' }]
      const result = buildMemoryContextMessage(null, facts)
      expect(result!.content).toContain('last seen 2026-03-15')
      expect(result!.content).not.toContain('T14:30')
    })
  })
})
