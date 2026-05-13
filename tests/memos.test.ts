import { describe, expect, test, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { _userCaches } from '../src/cache.js'
import {
  saveMemo,
  getMemo,
  listMemos,
  updateMemoEmbedding,
  keywordSearchMemos,
  loadEmbeddingsForUser,
  archiveMemos,
  addMemoLink,
} from '../src/memos.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

beforeEach(() => {
  mockLogger()
})

describe('saveMemo', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('inserts a memo and returns it', () => {
    const memo = saveMemo('user1', 'lease renewal deadline is June 15', ['landlord', 'deadline'])
    expect(memo.id).toBeTruthy()
    expect(memo.content).toBe('lease renewal deadline is June 15')
    expect(memo.tags).toEqual(['landlord', 'deadline'])
    expect(memo.status).toBe('active')
    expect(memo.userId).toBe('user1')
  })

  test('getMemo retrieves exact content', () => {
    const saved = saveMemo('user1', 'test content', ['test'])
    const retrieved = getMemo('user1', saved.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.content).toBe('test content')
    expect(retrieved?.tags).toEqual(['test'])
  })

  test('getMemo returns null for wrong user', () => {
    const saved = saveMemo('user1', 'private note', [])
    const retrieved = getMemo('user2', saved.id)
    expect(retrieved).toBeNull()
  })

  test('getMemo returns null for nonexistent id', () => {
    expect(getMemo('user1', 'nonexistent')).toBeNull()
  })
})

describe('listMemos', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('returns newest first', async () => {
    saveMemo('user1', 'first', [])
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
    saveMemo('user1', 'second', [])
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
    saveMemo('user1', 'third', [])
    const list = listMemos('user1')
    expect(list.length).toBe(3)
    expect(list[0]?.content).toBe('third')
    expect(list[2]?.content).toBe('first')
  })

  test('respects status filter', () => {
    saveMemo('user1', 'active note', [])
    const archived = saveMemo('user1', 'will archive', ['old'])
    archiveMemos('user1', { memoIds: [archived.id] })
    const activeList = listMemos('user1', 10, 'active')
    const archivedList = listMemos('user1', 10, 'archived')
    expect(activeList.length).toBe(1)
    expect(archivedList.length).toBe(1)
    expect(archivedList[0]?.content).toBe('will archive')
  })

  test('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      saveMemo('user1', `note ${i}`, [])
    }
    const list = listMemos('user1', 3)
    expect(list.length).toBe(3)
  })

  test('per-user isolation', () => {
    saveMemo('user1', 'user1 note', [])
    saveMemo('user2', 'user2 note', [])
    const list1 = listMemos('user1')
    const list2 = listMemos('user2')
    expect(list1.length).toBe(1)
    expect(list1[0]?.content).toBe('user1 note')
    expect(list2.length).toBe(1)
    expect(list2[0]?.content).toBe('user2 note')
  })
})

describe('keywordSearchMemos (FTS5)', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    _userCaches.clear()
    testDb = await setupTestDb()
  })

  test('finds memos by content keyword', () => {
    saveMemo('user1', 'lease renewal deadline is June 15', ['landlord'])
    saveMemo('user1', 'buy groceries tomorrow', ['shopping'])
    const results = keywordSearchMemos('user1', 'lease')
    expect(results.length).toBe(1)
    expect(results[0]?.content).toContain('lease')
  })

  test('excludes archived memos', () => {
    const memo = saveMemo('user1', 'old lease info', ['landlord'])
    archiveMemos('user1', { memoIds: [memo.id] })
    const results = keywordSearchMemos('user1', 'lease')
    expect(results.length).toBe(0)
  })

  test('FTS trigger: insert a memo, search immediately finds it', () => {
    saveMemo('user1', 'unique keyword xylophone', [])
    const results = keywordSearchMemos('user1', 'xylophone')
    expect(results.length).toBe(1)
  })

  test('returns empty for no matches', () => {
    saveMemo('user1', 'some content', [])
    const results = keywordSearchMemos('user1', 'nonexistent')
    expect(results.length).toBe(0)
  })

  test('FTS trigger: update content, search finds new content', () => {
    const memo = saveMemo('user1', 'original content about apples', [])
    expect(keywordSearchMemos('user1', 'apples').length).toBe(1)
    expect(keywordSearchMemos('user1', 'bananas').length).toBe(0)

    // Update content directly to trigger FTS update trigger
    const rawDb = testDb.$client
    rawDb.prepare(`UPDATE memos SET content = 'updated content about bananas' WHERE id = ?`).run(memo.id)

    expect(keywordSearchMemos('user1', 'bananas').length).toBe(1)
    expect(keywordSearchMemos('user1', 'apples').length).toBe(0)
  })

  test('handles special characters in query without crashing', () => {
    saveMemo('user1', 'meeting notes AND action items', [])
    const results = keywordSearchMemos('user1', 'AND OR "special*')
    expect(Array.isArray(results)).toBe(true)
  })

  test('per-user isolation in search', () => {
    saveMemo('user1', 'shared keyword alpha', [])
    saveMemo('user2', 'shared keyword alpha', [])
    const results = keywordSearchMemos('user1', 'alpha')
    expect(results.length).toBe(1)
    expect(results[0]?.userId).toBe('user1')
  })
})

describe('updateMemoEmbedding and loadEmbeddingsForUser', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('stores and retrieves Float32Array correctly', () => {
    const memo = saveMemo('user1', 'test embedding', [])
    const vec = new Float32Array([0.1, 0.2, 0.3, 0.4])
    updateMemoEmbedding('user1', memo.id, vec)

    const loaded = loadEmbeddingsForUser('user1')
    expect(loaded.length).toBe(1)
    expect(loaded[0]?.id).toBe(memo.id)
    assert(loaded[0] !== undefined)
    const { embedding } = loaded[0]
    expect(embedding.length).toBe(4)
    const first = embedding[0]
    const last = embedding[3]
    assert(first !== undefined)
    assert(last !== undefined)
    expect(Math.abs(first - 0.1)).toBeLessThan(0.001)
    expect(Math.abs(last - 0.4)).toBeLessThan(0.001)
  })

  test('only loads active memos with embeddings', () => {
    const memo1 = saveMemo('user1', 'has embedding', [])
    saveMemo('user1', 'no embedding', [])
    const memo3 = saveMemo('user1', 'will be archived', [])
    updateMemoEmbedding('user1', memo1.id, new Float32Array([1, 2]))
    updateMemoEmbedding('user1', memo3.id, new Float32Array([3, 4]))
    archiveMemos('user1', { memoIds: [memo3.id] })

    const loaded = loadEmbeddingsForUser('user1')
    expect(loaded.length).toBe(1)
    expect(loaded[0]?.id).toBe(memo1.id)
  })
})

describe('archiveMemos', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('archives by tag only matching rows', () => {
    saveMemo('user1', 'landlord note', ['landlord'])
    saveMemo('user1', 'shopping note', ['shopping'])
    saveMemo('user1', 'another landlord note', ['landlord', 'urgent'])
    const count = archiveMemos('user1', { tag: 'landlord' })
    expect(count).toBe(2)
    const active = listMemos('user1')
    expect(active.length).toBe(1)
    expect(active[0]?.content).toBe('shopping note')
  })

  test('archives by date', () => {
    saveMemo('user1', 'old note', [])
    saveMemo('user1', 'new note', [])
    const count = archiveMemos('user1', { beforeDate: '2099-01-01T00:00:00.000Z' })
    expect(count).toBe(2)
    expect(listMemos('user1').length).toBe(0)
  })

  test('archives by specific memo IDs', () => {
    const memo1 = saveMemo('user1', 'note one', [])
    saveMemo('user1', 'note two', [])
    const count = archiveMemos('user1', { memoIds: [memo1.id] })
    expect(count).toBe(1)
    expect(listMemos('user1').length).toBe(1)
  })

  test('returns 0 when no memos match', () => {
    saveMemo('user1', 'some note', ['tag1'])
    const count = archiveMemos('user1', { tag: 'nonexistent' })
    expect(count).toBe(0)
  })
})

describe('addMemoLink', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('creates a link between memo and task', () => {
    const memo = saveMemo('user1', 'promote this', [])
    const link = addMemoLink(memo.id, 'task-123', 'action_for')
    expect(link.id).toBeTruthy()
    expect(link.sourceMemoId).toBe(memo.id)
    expect(link.targetTaskId).toBe('task-123')
    expect(link.relationType).toBe('action_for')
  })
})
