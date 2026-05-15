// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeCountTasksTool } from '../../src/tools/count-tasks.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('Count Tasks Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeCountTasksTool(createMockProvider())

    expect(tool.description).toContain('Count tasks')
  })

  test('counts tasks with query and optional project id', async () => {
    const countTasks = mock(() => Promise.resolve(17))
    const tool = makeCountTasksTool(createMockProvider({ countTasks }))

    const result = await getToolExecutor(tool)(
      { query: 'State: Open', projectId: '0-1' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toEqual({ count: 17, query: 'State: Open', projectId: '0-1' })
    expect(countTasks).toHaveBeenCalledWith({ query: 'State: Open', projectId: '0-1' })
  })

  test('throws when countTasks is not supported', async () => {
    const tool = makeCountTasksTool(createMockProvider({ countTasks: undefined }))

    await expect(getToolExecutor(tool)({ query: 'State: Open' }, { toolCallId: '1', messages: [] })).rejects.toThrow(
      'countTasks not supported',
    )
  })

  test('validates required query and optional projectId', () => {
    const tool = makeCountTasksTool(createMockProvider())

    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { query: 'State: Open' })).toBe(true)
    expect(schemaValidates(tool, { query: 'State: Open', projectId: '0-1' })).toBe(true)
  })
})
