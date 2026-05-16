// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, test, expect, beforeEach, mock } from 'bun:test'

import { z } from 'zod'

import { userCachesForTesting } from '../../src/cache.js'
import { setConfig } from '../../src/config.js'
import { saveMemo } from '../../src/memos.js'
import { makeArchiveMemosTool } from '../../src/tools/archive-memos.js'
import { makeListMemosTool } from '../../src/tools/list-memos.js'
import { makePromoteMemoTool } from '../../src/tools/promote-memo.js'
import { makeSaveMemoTool } from '../../src/tools/save-memo.js'
import { makeSearchMemosTool } from '../../src/tools/search-memos.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider, createMockYouTrackProvider } from './mock-provider.js'

beforeEach(() => {
  mockLogger()
})

async function exec(
  toolInstance: ReturnType<typeof makeSaveMemoTool>,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!toolInstance.execute) throw new Error('Tool execute is undefined')
  const result: unknown = await toolInstance.execute(input, { toolCallId: '1', messages: [] })
  return result
}

function getInputFieldDescription(schema: unknown, fieldName: string): string | undefined {
  if (!(schema instanceof z.ZodType)) return undefined
  const jsonSchema = z.toJSONSchema(schema)
  if (!('properties' in jsonSchema) || jsonSchema.properties === undefined) return undefined
  const property = jsonSchema.properties[fieldName]
  if (property === undefined || typeof property !== 'object' || property === null) return undefined
  return 'description' in property && typeof property.description === 'string' ? property.description : undefined
}

describe('save_memo tool', () => {
  beforeEach(async () => {
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('saves memo and returns confirmation', async () => {
    const result = await exec(makeSaveMemoTool('user1'), { content: 'test note', tags: ['tag1'] })
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('content', 'test note')
    expect(result).toHaveProperty('tags', ['tag1'])
  })

  test('saves without tags', async () => {
    const result = await exec(makeSaveMemoTool('user1'), { content: 'no tags' })
    expect(result).toHaveProperty('tags', [])
  })
})

describe('search_memos tool', () => {
  beforeEach(async () => {
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('keyword search returns matching memos', async () => {
    saveMemo('user1', 'lease renewal deadline', ['landlord'])
    saveMemo('user1', 'buy groceries', ['shopping'])

    const result = await exec(makeSearchMemosTool('user1'), { query: 'lease', mode: 'keyword' })
    expect(result).toHaveProperty('mode', 'keyword')
    expect(result).toHaveProperty('results')
  })

  test('falls back to keyword when embedding unavailable', async () => {
    saveMemo('user1', 'important project deadline', [])

    const result = await exec(makeSearchMemosTool('user1'), { query: 'deadline', mode: 'auto' })
    expect(result).toHaveProperty('mode', 'keyword_fallback')
  })

  test('returns empty for no matches', async () => {
    saveMemo('user1', 'some content', [])

    const result = await exec(makeSearchMemosTool('user1'), { query: 'nonexistent', mode: 'keyword' })
    expect(result).toHaveProperty('results', [])
  })
})

describe('list_memos tool', () => {
  beforeEach(async () => {
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('lists memos', async () => {
    saveMemo('user1', 'first', [])
    saveMemo('user1', 'second', [])

    const result = await exec(makeListMemosTool('user1'), {})
    expect(result).toHaveProperty('memos')
  })

  test('respects limit', async () => {
    for (let i = 0; i < 5; i++) saveMemo('user1', `note ${i}`, [])

    const result = await exec(makeListMemosTool('user1'), { limit: 2 })
    expect(result).toHaveProperty('memos')
  })
})

describe('archive_memos tool', () => {
  beforeEach(async () => {
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('rejects when no filter provided', async () => {
    const result = await exec(makeArchiveMemosTool('user1'), { confidence: 1.0 })
    expect(result).toHaveProperty('status', 'error')
  })

  test('requires confirmation when confidence is low for non-ID archive', async () => {
    saveMemo('user1', 'note', ['tag'])
    const result = await exec(makeArchiveMemosTool('user1'), { tag: 'tag', confidence: 0.5 })
    expect(result).toHaveProperty('status', 'confirmation_required')
  })

  test('archives by tag with high confidence', async () => {
    saveMemo('user1', 'tagged note', ['cleanup'])
    saveMemo('user1', 'other note', ['keep'])

    const result = await exec(makeArchiveMemosTool('user1'), { tag: 'cleanup', confidence: 1.0 })
    expect(result).toHaveProperty('status', 'archived')
    expect(result).toHaveProperty('count', 1)
  })

  test('archives by memo IDs without confirmation gate', async () => {
    const memo = saveMemo('user1', 'specific note', [])
    saveMemo('user1', 'other', [])

    const result = await exec(makeArchiveMemosTool('user1'), { memoIds: [memo.id], confidence: 0.5 })
    expect(result).toHaveProperty('status', 'archived')
    expect(result).toHaveProperty('count', 1)
  })
})

describe('promote_memo tool', () => {
  beforeEach(async () => {
    userCachesForTesting.clear()
    await setupTestDb()
    setConfig('user1', 'timezone', 'UTC')
  })

  test('promotes memo to task', async () => {
    const memo = saveMemo('user1', 'lease renewal deadline June 15', ['landlord'])
    const provider = createMockProvider()

    const result = await exec(makePromoteMemoTool(provider, 'user1'), { memoId: memo.id, projectId: 'proj-1' })
    expect(result).toHaveProperty('status', 'promoted')
    expect(result).toHaveProperty('taskId', 'task-1')
    expect(result).toHaveProperty('memoId', memo.id)
  })

  test('returns error for nonexistent memo', async () => {
    const provider = createMockProvider()
    const result = await exec(makePromoteMemoTool(provider, 'user1'), {
      memoId: 'nonexistent',
      projectId: 'proj-1',
    })
    expect(result).toHaveProperty('status', 'error')
  })

  test('returns error when provider.createTask fails', async () => {
    const memo = saveMemo('user1', 'will fail', [])
    const provider = createMockProvider({
      createTask: () => Promise.reject(new Error('API unavailable')),
    })

    const result = await exec(makePromoteMemoTool(provider, 'user1'), {
      memoId: memo.id,
      projectId: 'proj-1',
    })
    expect(result).toHaveProperty('status', 'error')
    expect(result).toHaveProperty('message')
  })

  test('uses date-only dueDate semantics for YouTrack', async () => {
    const memo = saveMemo('user1', 'promote with date', [])
    let capturedDueDate: string | undefined
    const provider = createMockYouTrackProvider({
      createTask: mock((params: Readonly<{ dueDate?: string; title: string }>) => {
        capturedDueDate = params.dueDate
        return Promise.resolve({
          id: 'task-1',
          title: params.title,
          status: 'todo',
          dueDate: '2026-03-25',
          url: 'https://test.com/task/1',
        })
      }),
    })

    const result = await exec(makePromoteMemoTool(provider, 'user1'), {
      memoId: memo.id,
      projectId: 'proj-1',
      dueDate: { date: '2026-03-25', time: '23:45' },
    })

    expect(capturedDueDate).toBe('2026-03-25')
    expect(result).toHaveProperty('dueDate', '2026-03-25')
  })

  test('keeps datetime behavior for non-YouTrack providers', async () => {
    const memo = saveMemo('user1', 'promote with datetime', [])
    setConfig('user1', 'timezone', 'Asia/Karachi')
    let capturedDueDate: string | undefined
    const provider = createMockProvider({
      createTask: mock((params: Readonly<{ dueDate?: string; title: string }>) => {
        capturedDueDate = params.dueDate
        return Promise.resolve({
          id: 'task-1',
          title: params.title,
          status: 'todo',
          dueDate: '2026-03-25T18:45:00.000Z',
          url: 'https://test.com/task/1',
        })
      }),
    })

    const result = await exec(makePromoteMemoTool(provider, 'user1'), {
      memoId: memo.id,
      projectId: 'proj-1',
      dueDate: { date: '2026-03-25', time: '23:45' },
    })

    expect(capturedDueDate).toBe('2026-03-25T18:45:00.000Z')
    expect(result).toHaveProperty('dueDate', '2026-03-25T23:45:00')
  })

  test('describes YouTrack promote due dates as date-only', () => {
    const provider = createMockYouTrackProvider()
    const tool = makePromoteMemoTool(provider, 'user1')
    const dueDateDescription = getInputFieldDescription(tool.inputSchema, 'dueDate')

    expect(dueDateDescription).toContain('For YouTrack, due dates are date-only and time-of-day is ignored')
  })
})
