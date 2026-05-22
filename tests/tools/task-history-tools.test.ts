// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeGetTaskHistoryTool } from '../../src/tools/get-task-history.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('Task history tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('requires taskId', () => {
    const tool = makeGetTaskHistoryTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { taskId: 'TEST-1' })).toBe(true)
  })

  test('rejects invalid start and end timestamps', () => {
    const tool = makeGetTaskHistoryTool(createMockProvider())

    expect(schemaValidates(tool, { taskId: 'TEST-1', start: 'not-a-date' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'TEST-1', end: '2026-13-99T00:00:00Z' })).toBe(false)
    expect(
      schemaValidates(tool, {
        taskId: 'TEST-1',
        start: '2026-04-01T00:00:00.000Z',
        end: '2026-04-15T00:00:00.000Z',
      }),
    ).toBe(true)
  })

  test('forwards history filters', async () => {
    const getTaskHistory = mock(() =>
      Promise.resolve([{ id: 'act-1', timestamp: '2026-04-15T00:00:00.000Z', category: 'CommentsCategory' }]),
    )
    const tool = makeGetTaskHistoryTool(createMockProvider({ getTaskHistory }))
    const result = await getToolExecutor(tool)({
      taskId: 'TEST-1',
      categories: ['CommentsCategory'],
      limit: 20,
      offset: 0,
      reverse: true,
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-04-15T00:00:00.000Z',
      author: 'alice',
    })

    expect(result).toEqual([{ id: 'act-1', timestamp: '2026-04-15T00:00:00.000Z', category: 'CommentsCategory' }])
    expect(getTaskHistory).toHaveBeenCalledWith('TEST-1', {
      categories: ['CommentsCategory'],
      limit: 20,
      offset: 0,
      reverse: true,
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-04-15T00:00:00.000Z',
      author: 'alice',
    })
  })
})
