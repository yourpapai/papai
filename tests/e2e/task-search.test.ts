// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { z } from 'zod'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../plugins/task-provider-kaneo/client.js'
import { createTask } from '../../plugins/task-provider-kaneo/create-task.js'
import { searchTasks } from '../../plugins/task-provider-kaneo/search-tasks.js'
import { getCurrentKaneoUserId, kaneoApiJsonParsed } from './kaneo-api-helpers.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

const NullableDateSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

const RawSearchTaskSchema = z.object({
  id: z.string(),
  startDate: NullableDateSchema,
  dueDate: NullableDateSchema,
})

const RawSearchResponseSchema = z.object({
  results: z.array(RawSearchTaskSchema),
  searchQuery: z.string(),
  totalCount: z.number(),
})

type RawSearchTask = z.infer<typeof RawSearchTaskSchema>

function requireRawSearchTask(results: readonly RawSearchTask[], taskId: string): RawSearchTask {
  const result = results.find((entry) => entry.id === taskId)
  if (result === undefined) {
    throw new Error(`Expected raw search result for task ${taskId}`)
  }

  return result
}

function requireSingleTask<T>(tasks: readonly T[]): T {
  const [task] = tasks
  if (task === undefined) {
    throw new Error('Expected exactly one task result')
  }

  return task
}

function createRawSearchPath({
  query,
  workspaceId,
  projectId,
  limit,
}: {
  query: string
  workspaceId: string
  projectId?: string
  limit?: number
}): string {
  const searchParams = new URLSearchParams({
    q: query,
    type: 'tasks',
    workspaceId,
  })

  if (projectId !== undefined) {
    searchParams.set('projectId', projectId)
  }

  if (limit !== undefined) {
    searchParams.set('limit', String(limit))
  }

  return `/search?${searchParams.toString()}`
}

describe('E2E: Task Search and Filter', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let workspaceId: string
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    workspaceId = testClient.getWorkspaceId()
    const project = await testClient.createTestProject(`Search Test ${Date.now()}`)
    projectId = project.id
  })

  afterEach(async () => {
    await testClient.cleanup()
  })

  test('searches tasks by title keyword', async () => {
    const uniqueKeyword = `searchable${Date.now()}`
    const task1 = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Task with ${uniqueKeyword}`,
    })
    const task2 = await createTask({
      config: kaneoConfig,
      projectId,
      title: 'Regular task',
    })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    const results = await searchTasks({
      config: kaneoConfig,
      query: uniqueKeyword,
      workspaceId,
      projectId,
    })

    expect(results.tasks.length).toBeGreaterThan(0)
    const found = results.tasks.find((t) => t.id === task1.id)
    expect(found?.id).toBe(task1.id)
  })

  test('searches across all projects', async () => {
    const uniqueKeyword = `crossproject${Date.now()}`
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Cross project ${uniqueKeyword}`,
    })
    testClient.trackTask(task.id)

    const results = await searchTasks({
      config: kaneoConfig,
      query: uniqueKeyword,
      workspaceId,
    })

    expect(results.tasks.length).toBeGreaterThan(0)
    const found = results.tasks.find((t) => t.id === task.id)
    expect(found?.id).toBe(task.id)
  })

  test('returns empty results for non-matching search', async () => {
    const results = await searchTasks({
      config: kaneoConfig,
      query: `nonexistent${Date.now()}`,
      workspaceId,
      projectId,
    })

    expect(results.tasks.length).toBe(0)
  })

  test('adapts the live search envelope and still finds tasks with null dates', async () => {
    const uniqueKeyword = `nulldates${Date.now()}`
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Null dates ${uniqueKeyword}`,
    })
    testClient.trackTask(task.id)

    const rawSearch = await kaneoApiJsonParsed(
      createRawSearchPath({
        query: uniqueKeyword,
        workspaceId,
        projectId,
      }),
      RawSearchResponseSchema,
    )

    expect(rawSearch.searchQuery).toBeString()
    expect(rawSearch.totalCount).toBeNumber()
    expect(rawSearch.results).toBeArray()

    expect(rawSearch.results.some((result) => result.id === task.id)).toBe(true)

    const matchingRawTask = requireRawSearchTask(rawSearch.results, task.id)
    expect(matchingRawTask.startDate).toBeNull()
    expect(matchingRawTask.dueDate).toBeNull()

    const results = await searchTasks({
      config: kaneoConfig,
      query: uniqueKeyword,
      workspaceId,
      projectId,
    })

    expect(results.tasks.some((result) => result.id === task.id)).toBe(true)
  })

  test('respects projectId and limit together', async () => {
    const uniqueKeyword = `projectlimit${Date.now()}`
    const otherProject = await testClient.createTestProject(`Other Search Project ${Date.now()}`)
    const targetTaskOne = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Project limit one ${uniqueKeyword}`,
    })
    const targetTaskTwo = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Project limit two ${uniqueKeyword}`,
    })
    const otherProjectTask = await createTask({
      config: kaneoConfig,
      projectId: otherProject.id,
      title: `Project limit other ${uniqueKeyword}`,
    })
    testClient.trackTask(targetTaskOne.id)
    testClient.trackTask(targetTaskTwo.id)
    testClient.trackTask(otherProjectTask.id)

    const results = await searchTasks({
      config: kaneoConfig,
      query: uniqueKeyword,
      workspaceId,
      projectId,
      limit: 1,
    })

    expect(results.tasks).toHaveLength(1)
    const listedTask = requireSingleTask(results.tasks)
    expect(listedTask.projectId).toBe(projectId)
    expect([targetTaskOne.id, targetTaskTwo.id]).toContain(listedTask.id)
    expect(listedTask.id).not.toBe(otherProjectTask.id)
  })

  test('filters locally by assigneeId without dropping the assigned task', async () => {
    const assigneeId = await getCurrentKaneoUserId()
    const uniqueKeyword = `assigneefilter${Date.now()}`
    const assignedTask = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Assigned ${uniqueKeyword}`,
      userId: assigneeId,
    })
    const unassignedTaskOne = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Unassigned one ${uniqueKeyword}`,
    })
    const unassignedTaskTwo = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Unassigned two ${uniqueKeyword}`,
    })
    testClient.trackTask(assignedTask.id)
    testClient.trackTask(unassignedTaskOne.id)
    testClient.trackTask(unassignedTaskTwo.id)

    const rawLimitedSearch = await kaneoApiJsonParsed(
      createRawSearchPath({
        query: uniqueKeyword,
        workspaceId,
        projectId,
        limit: 1,
      }),
      RawSearchResponseSchema,
    )

    expect(rawLimitedSearch.results).toHaveLength(1)

    const filteredResults = await searchTasks({
      config: kaneoConfig,
      query: uniqueKeyword,
      workspaceId,
      projectId,
      assigneeId,
      limit: 1,
    })

    expect(filteredResults.tasks).toHaveLength(1)
    expect(filteredResults.tasks[0]?.id).toBe(assignedTask.id)
    expect(filteredResults.tasks[0]?.userId).toBe(assigneeId)
  })

  test('search with invalid workspace returns empty or throws', async () => {
    // Kaneo API may return empty results or throw for invalid workspace
    try {
      const results = await searchTasks({
        config: kaneoConfig,
        query: 'test',
        workspaceId: 'non-existent-workspace-id',
      })
      // If it doesn't throw, it should return empty results
      expect(results.tasks.length).toBe(0)
    } catch (error) {
      // If it throws, that's also acceptable behavior
      expect(error).toBeDefined()
    }
  })
})
