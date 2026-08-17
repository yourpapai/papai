// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TaskRelation } from 'papai/plugin-types'

import type { TaskDetails } from '../../../plugins/task-provider-kaneo/get-task.js'
import type { KaneoTaskListItem } from '../../../plugins/task-provider-kaneo/list-tasks.js'
import {
  mapColumn,
  mapComment,
  mapCreateTaskResponse,
  mapGlobalSearchTaskResults,
  mapLabel,
  mapProject,
  mapTaskDetails,
  mapTaskListItem,
  mapTaskSearchResult,
} from '../../../plugins/task-provider-kaneo/mappers.js'
import type { CreateTaskResponse } from '../../../plugins/task-provider-kaneo/schemas/create-task.js'

const URL = 'https://kaneo.test/workspace/ws-1/project/p-1/task/t-1'

const createResponse = (): CreateTaskResponse => ({
  id: 't-1',
  projectId: 'p-1',
  position: 1,
  number: 7,
  userId: 'u-1',
  title: 'Task title',
  description: 'desc',
  status: 'in progress',
  priority: 'high',
  startDate: '2024-01-02T00:00:00.000Z',
  dueDate: '2024-03-04T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
})

describe('mapCreateTaskResponse', () => {
  test('maps every field and passes string dates through unchanged', () => {
    const result = mapCreateTaskResponse(createResponse(), URL)

    expect(result.id).toBe('t-1')
    expect(result.title).toBe('Task title')
    expect(result.description).toBe('desc')
    expect(result.status).toBe('in progress')
    expect(result.priority).toBe('high')
    expect(result.assignee).toBe('u-1')
    expect(result.startDate).toBe('2024-01-02T00:00:00.000Z')
    expect(result.dueDate).toBe('2024-03-04T00:00:00.000Z')
    expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z')
    expect(result.projectId).toBe('p-1')
    expect(result.url).toBe(URL)
  })
})

describe('mapTaskDetails', () => {
  test('maps every field including relations', () => {
    const relations: TaskRelation[] = [{ type: 'blocks', taskId: 't-9' }]
    const details: TaskDetails = {
      id: 't-2',
      title: 'Details',
      description: 'body',
      number: 9,
      status: 'open',
      priority: 'low',
      startDate: '2024-02-02T00:00:00.000Z',
      dueDate: null,
      createdAt: '2024-02-01T00:00:00.000Z',
      projectId: 'p-2',
      userId: null,
      relations,
    }
    const result = mapTaskDetails(details, URL)

    expect(result.id).toBe('t-2')
    expect(result.title).toBe('Details')
    expect(result.description).toBe('body')
    expect(result.status).toBe('open')
    expect(result.priority).toBe('low')
    expect(result.assignee).toBe(null)
    expect(result.startDate).toBe('2024-02-02T00:00:00.000Z')
    expect(result.dueDate).toBe(null)
    expect(result.createdAt).toBe('2024-02-01T00:00:00.000Z')
    expect(result.projectId).toBe('p-2')
    expect(result.url).toBe(URL)
    expect(result.relations).toBe(relations)
  })
})

describe('mapTaskListItem', () => {
  test('maps list item fields', () => {
    const item: KaneoTaskListItem = {
      id: 't-3',
      title: 'List item',
      number: 3,
      status: 'done',
      priority: 'urgent',
      dueDate: '2024-04-04T00:00:00.000Z',
    }
    const result = mapTaskListItem(item, URL)

    expect(result.id).toBe('t-3')
    expect(result.title).toBe('List item')
    expect(result.number).toBe(3)
    expect(result.status).toBe('done')
    expect(result.priority).toBe('urgent')
    expect(result.dueDate).toBe('2024-04-04T00:00:00.000Z')
    expect(result.url).toBe(URL)
  })

  test('passes a null dueDate through as null', () => {
    const item: KaneoTaskListItem = {
      id: 't-3',
      title: 'List item',
      number: 3,
      status: 'done',
      priority: 'urgent',
      dueDate: null,
    }
    const result = mapTaskListItem(item, URL)

    expect(result.dueDate).toBe(null)
  })

  test('preserves createdAt from the list item', () => {
    const item: KaneoTaskListItem = {
      id: 't-6',
      title: 'List item',
      number: 6,
      status: 'in progress',
      priority: 'high',
      dueDate: '2024-04-04T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const result = mapTaskListItem(item, URL)

    expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z')
  })
})

describe('mapProject', () => {
  test('includes a non-empty description', () => {
    const result = mapProject({ id: 'p-1', name: 'Project', description: 'A description' }, URL)

    expect(result.id).toBe('p-1')
    expect(result.name).toBe('Project')
    expect(result.url).toBe(URL)
    expect(result.description).toBe('A description')
  })

  test('omits the description key when it is null', () => {
    const result = mapProject({ id: 'p-1', name: 'Project', description: null }, URL)

    expect('description' in result).toBe(false)
  })

  test('omits the description key when it is undefined', () => {
    const result = mapProject({ id: 'p-1', name: 'Project' }, URL)

    expect('description' in result).toBe(false)
  })

  test('omits the description key when it is an empty string', () => {
    const result = mapProject({ id: 'p-1', name: 'Project', description: '' }, URL)

    expect('description' in result).toBe(false)
  })
})

describe('mapComment', () => {
  test('maps comment fields', () => {
    const result = mapComment({
      id: 'c-1',
      comment: 'Body text',
      createdAt: '2024-06-01T00:00:00.000Z',
    })

    expect(result.id).toBe('c-1')
    expect(result.body).toBe('Body text')
    expect(result.createdAt).toBe('2024-06-01T00:00:00.000Z')
  })
})

describe('mapLabel', () => {
  test('maps label fields including color', () => {
    const result = mapLabel({ id: 'l-1', name: 'bug', color: '#ff0000' })

    expect(result.id).toBe('l-1')
    expect(result.name).toBe('bug')
    expect(result.color).toBe('#ff0000')
  })

  test('passes an absent color through as undefined', () => {
    const result = mapLabel({ id: 'l-2', name: 'docs' })

    expect(result.color).toBe(undefined)
  })
})

describe('mapColumn', () => {
  test('maps column fields', () => {
    const result = mapColumn({ id: 'col-1', name: 'Done', isFinal: true })

    expect(result.id).toBe('col-1')
    expect(result.name).toBe('Done')
    expect(result.isFinal).toBe(true)
  })
})

describe('mapTaskSearchResult', () => {
  test('coerces a null number to undefined', () => {
    const result = mapTaskSearchResult(
      {
        id: 't-4',
        title: 'Search',
        number: null,
        status: 'open',
        priority: 'medium',
        projectId: 'p-1',
      },
      URL,
    )

    expect(result.id).toBe('t-4')
    expect(result.title).toBe('Search')
    expect(result.number).toBe(undefined)
    expect(result.status).toBe('open')
    expect(result.priority).toBe('medium')
    expect(result.projectId).toBe('p-1')
    expect(result.url).toBe(URL)
  })

  test('keeps a present number', () => {
    const result = mapTaskSearchResult(
      {
        id: 't-5',
        title: 'Search',
        number: 42,
        status: 'open',
        priority: 'low',
        projectId: 'p-1',
      },
      URL,
    )

    expect(result.number).toBe(42)
  })
})

describe('mapGlobalSearchTaskResults', () => {
  test('parses the response and maps each task to a search result', () => {
    const result = mapGlobalSearchTaskResults(
      {
        tasks: [
          {
            id: 't-1',
            projectId: 'p-1',
            position: 1,
            number: 11,
            userId: null,
            title: 'First',
            description: null,
            status: 'todo',
            priority: 'high',
            startDate: null,
            dueDate: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 't-2',
            projectId: 'p-1',
            position: 2,
            number: null,
            userId: 'u-1',
            title: 'Second',
            description: null,
            status: 'done',
            priority: 'no-priority',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        projects: [],
        workspaces: [],
        comments: [],
        activities: [],
      },
      (task) => `https://kaneo.test/p/${task.projectId}/t/${task.id}`,
    )

    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('t-1')
    expect(result[0]?.title).toBe('First')
    expect(result[0]?.number).toBe(11)
    expect(result[0]?.status).toBe('todo')
    expect(result[0]?.priority).toBe('high')
    expect(result[0]?.projectId).toBe('p-1')
    expect(result[0]?.url).toBe('https://kaneo.test/p/p-1/t/t-1')
    expect(result[1]?.id).toBe('t-2')
    expect(result[1]?.number).toBe(undefined)
    expect(result[1]?.priority).toBe('no-priority')
    expect(result[1]?.url).toBe('https://kaneo.test/p/p-1/t/t-2')
  })
})
