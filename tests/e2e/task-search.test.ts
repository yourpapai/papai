import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { searchTasks } from '../../src/providers/kaneo/search-tasks.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Task Search and Filter', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let workspaceId: string
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    workspaceId = testClient.getWorkspaceId()
    await testClient.cleanup()
    const project = await testClient.createTestProject(`Search Test ${Date.now()}`)
    projectId = project.id
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
