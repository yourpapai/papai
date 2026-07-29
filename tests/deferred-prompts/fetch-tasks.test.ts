// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { enrichTasks } from '../../src/deferred-prompts/fetch-tasks.js'
import type { Task } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger } from '../utils/test-helpers.js'

const lightTasks: Task[] = [
  { id: 'task-1', title: 'One', url: 'http://test/1' },
  { id: 'task-2', title: 'Two', url: 'http://test/2' },
]

/** getTask mock that rejects for a specific task id — kept at module scope so the
 *  linter's no-conditional-in-test rule doesn't flag the branch. */
const createFailingGetTask =
  (failId: string) =>
  (taskId: string): Promise<Task> =>
    taskId === failId
      ? Promise.reject(new Error('getTask boom'))
      : Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` })

beforeEach(() => {
  mockLogger()
})

describe('enrichTasks', () => {
  test('returns full details for all tasks', async () => {
    const provider = createMockProvider({
      getTask: mock((taskId: string) =>
        Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}`, assignee: 'alice' }),
      ),
    })

    const result = await enrichTasks(provider, lightTasks)
    expect(result).toHaveLength(2)
    expect(result[0]!.assignee).toBe('alice')
  })

  test('rejects when any getTask call fails', async () => {
    const provider = createMockProvider({
      getTask: mock(createFailingGetTask('task-2')),
    })

    await expect(enrichTasks(provider, lightTasks)).rejects.toThrow('getTask boom')
  })
})
