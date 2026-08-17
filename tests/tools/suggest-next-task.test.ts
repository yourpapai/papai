// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { TaskListItem } from '../../src/providers/domain-types.js'
import type { Project } from '../../src/providers/types.js'
import { makeSuggestNextTaskTool } from '../../src/tools/suggest-next-task.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const DAY = 24 * 60 * 60 * 1000

type ToolTask = TaskListItem & { createdAt?: string | null }

type Suggestion = {
  id: string
  title: string
  number?: number
  url: string
  projectId: string
  dueDate?: string | null
  priority?: string
  score: number
  reason: string
}

type SuggestResult = { suggestions: Suggestion[]; considered: number }

function toolTask(id: string, overrides: Partial<ToolTask> = {}): ToolTask {
  return {
    id,
    title: `Task ${id}`,
    url: `https://tracker.example/tasks/${id}`,
    ...overrides,
  }
}

/** ISO timestamp relative to the real current time — the tool ranks against `new Date()`. */
function fromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function isSuggestResult(value: unknown): value is SuggestResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'suggestions' in value &&
    'considered' in value &&
    typeof (value as Record<string, unknown>)['considered'] === 'number'
  )
}

async function executeSuggest(tool: unknown, input: Record<string, unknown>): Promise<SuggestResult> {
  const result = await getToolExecutor(tool)(input, { toolCallId: '1', messages: [], context: {} })
  if (!isSuggestResult(result)) {
    throw new Error(`expected a suggestion result, got ${JSON.stringify(result)}`)
  }
  return result
}

const projects = (): Project[] => [
  { id: 'proj-a', name: 'Project A', url: 'https://tracker.example/a' },
  { id: 'proj-b', name: 'Project B', url: 'https://tracker.example/b' },
]

/** Fan-out stub: serve each project's tasks from a lookup table (no conditional in the test body). */
function listTasksFromTable(table: Record<string, ToolTask[]>): (projectId: string) => Promise<ToolTask[]> {
  return (projectId: string): Promise<ToolTask[]> => Promise.resolve(table[projectId] ?? [])
}

describe('suggest_next_task tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('fans out over listProjects, merges ranked suggestions, and drops resolved tasks from candidates', async () => {
    const tasksByProject: Record<string, ToolTask[]> = {
      'proj-a': [
        toolTask('a-plain', { createdAt: fromNow(-30 * DAY) }),
        toolTask('a-overdue', { dueDate: fromNow(-5 * DAY), priority: 'urgent', number: 11 }),
      ],
      'proj-b': [
        toolTask('b-resolved', { dueDate: fromNow(-9 * DAY), resolved: '2026-01-01T00:00:00.000Z' }),
        toolTask('b-due-soon', { dueDate: fromNow(DAY) }),
        toolTask('b-plain', { createdAt: fromNow(-60 * DAY) }),
      ],
    }
    const listTasks = mock(listTasksFromTable(tasksByProject))
    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve(projects())),
      listTasks,
    })
    const tool = makeSuggestNextTaskTool(provider)

    const result = await executeSuggest(tool, {})

    expect(listTasks).toHaveBeenCalledTimes(2)
    expect(listTasks).toHaveBeenCalledWith('proj-a', { limit: 50, sortBy: 'dueDate', sortOrder: 'asc' })
    expect(listTasks).toHaveBeenCalledWith('proj-b', { limit: 50, sortBy: 'dueDate', sortOrder: 'asc' })

    expect(result.considered).toBe(4)
    expect(result.suggestions.map((suggestion): string => suggestion.id)).toEqual([
      'a-overdue',
      'b-due-soon',
      'a-plain',
    ])

    const top = result.suggestions[0]!
    expect(top).toMatchObject({
      id: 'a-overdue',
      title: 'Task a-overdue',
      number: 11,
      url: 'https://tracker.example/tasks/a-overdue',
      projectId: 'proj-a',
      priority: 'urgent',
    })
    expect(Object.keys(top).sort()).toEqual([
      'dueDate',
      'id',
      'number',
      'priority',
      'projectId',
      'reason',
      'score',
      'title',
      'url',
    ])
    expect(top.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u)
    expect(typeof top.score).toBe('number')
    expect(top.reason).toMatch(/overdue/iu)

    const second = result.suggestions[1]
    expect(second?.projectId).toBe('proj-b')
    expect(second?.priority).toBeUndefined()
  })

  test('scopes to the explicit projectId without enumerating projects', async () => {
    const listProjects = mock(() => Promise.resolve(projects()))
    const listTasks = mock((_projectId: string): Promise<ToolTask[]> =>
      Promise.resolve([
        toolTask('solo-plain', { createdAt: fromNow(-30 * DAY) }),
        toolTask('solo-overdue', { dueDate: fromNow(-2 * DAY) }),
      ]),
    )
    const provider = createMockProvider({ listProjects, listTasks })
    const tool = makeSuggestNextTaskTool(provider)

    const result = await executeSuggest(tool, { projectId: 'proj-solo' })

    expect(listProjects).not.toHaveBeenCalled()
    expect(listTasks).toHaveBeenCalledTimes(1)
    expect(listTasks).toHaveBeenCalledWith('proj-solo', { limit: 50, sortBy: 'dueDate', sortOrder: 'asc' })

    expect(result.considered).toBe(2)
    expect(result.suggestions.map((suggestion): string => suggestion.id)).toEqual(['solo-overdue', 'solo-plain'])
    for (const suggestion of result.suggestions) {
      expect(suggestion.projectId).toBe('proj-solo')
    }
  })

  test('respects an explicit limit while counting the wider candidate set', async () => {
    const listTasks = mock((_projectId: string): Promise<ToolTask[]> =>
      Promise.resolve([
        toolTask('d1', { dueDate: fromNow(-1 * DAY) }),
        toolTask('d2', { dueDate: fromNow(-2 * DAY) }),
        toolTask('d3', { dueDate: fromNow(-3 * DAY) }),
        toolTask('d4', { dueDate: fromNow(-4 * DAY) }),
      ]),
    )
    const provider = createMockProvider({ listTasks })
    const tool = makeSuggestNextTaskTool(provider)

    const result = await executeSuggest(tool, { projectId: 'proj-x', limit: 2 })

    expect(result.considered).toBe(4)
    expect(result.suggestions.map((suggestion): string => suggestion.id)).toEqual(['d4', 'd3'])
  })
})
