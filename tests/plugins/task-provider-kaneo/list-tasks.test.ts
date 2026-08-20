// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { KaneoClassifiedError } from '../../../plugins/task-provider-kaneo/classify-error.js'
import type { KaneoConfig } from '../../../plugins/task-provider-kaneo/client.js'
import { listTasks } from '../../../plugins/task-provider-kaneo/list-tasks.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const config: KaneoConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://api.test.com',
}

const makeGroupedResponse = (taskOverrides: Array<Record<string, unknown>>): unknown => ({
  data: {
    id: 'proj-1',
    name: 'Project 1',
    slug: 'project-1',
    icon: '',
    description: null,
    isPublic: false,
    workspaceId: 'ws-1',
    columns: [
      {
        id: 'col-1',
        slug: 'to-do',
        name: 'Todo',
        icon: null,
        color: null,
        isFinal: false,
        tasks: taskOverrides.map((overrides, index) => ({
          id: `task-${index + 1}`,
          title: `Task ${index + 1}`,
          number: index + 1,
          status: 'col-1',
          priority: 'medium',
          dueDate: null,
          position: index + 1,
          userId: null,
          projectId: 'proj-1',
          labels: [],
          externalLinks: [],
          ...overrides,
        })),
      },
    ],
    archivedTasks: [],
    plannedTasks: [],
  },
  pagination: {
    total: taskOverrides.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  },
})

describe('kaneo listTasks', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('preserves createdAt from the grouped task list response', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            makeGroupedResponse([{ id: 'task-1', createdAt: '2026-03-01T00:00:00.000Z' }, { id: 'task-2' }]),
          ),
          { status: 200 },
        ),
      ),
    )

    const result = await listTasks({ config, projectId: 'proj-1' })

    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('task-1')
    expect(result[0]?.createdAt).toBe('2026-03-01T00:00:00.000Z')
    expect(result[1]?.id).toBe('task-2')
    expect(result[1]?.createdAt).toBe(undefined)
  })

  test('classifies HTTP failures', async () => {
    setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })))

    let thrownError: unknown
    try {
      await listTasks({ config, projectId: 'proj-1' })
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).toBeInstanceOf(KaneoClassifiedError)
  })
})
