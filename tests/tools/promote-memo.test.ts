// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { saveMemo } from '../../src/memos.js'
import { makePromoteMemoTool } from '../../src/tools/promote-memo.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('promote_memo', () => {
  const testUserId = 'test-user-123'

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('promotes memo to task', async () => {
    const createTask = mock(() =>
      Promise.resolve({ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }),
    )
    const provider = createMockProvider({ createTask })
    const tool = makePromoteMemoTool(provider, testUserId)

    const memo = saveMemo(testUserId, 'Buy milk', [])

    const result = await getToolExecutor(tool)(
      { memoId: memo.id, projectId: 'proj-1' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'promoted')
    expect(result).toHaveProperty('taskId', 'task-1')
    expect(createTask).toHaveBeenCalled()
  })

  test('returns error when memo not found', async () => {
    const provider = createMockProvider()
    const tool = makePromoteMemoTool(provider, testUserId)

    const result = await getToolExecutor(tool)(
      { memoId: 'nonexistent', projectId: 'proj-1' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'error')
    expect(result).toHaveProperty('message')
  })
})
