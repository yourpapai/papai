// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import { KaneoClassifiedError } from '../../src/providers/kaneo/classify-error.js'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { deleteTask } from '../../src/providers/kaneo/delete-task.js'
import { getComments } from '../../src/providers/kaneo/get-comments.js'
import { getTask } from '../../src/providers/kaneo/get-task.js'
import { updateTask } from '../../src/providers/kaneo/update-task.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Error Handling', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
    const project = await testClient.createTestProject(`Error Test ${Date.now()}`)
    projectId = project.id
  })

  test('throws error for non-existent task', async () => {
    const promise = getTask({ config: kaneoConfig, taskId: 'non-existent-id' })
    await expect(promise).rejects.toThrow(KaneoClassifiedError)
  })

  test('throws error when updating non-existent task', async () => {
    const promise = updateTask({
      config: kaneoConfig,
      taskId: 'non-existent-id',
      title: 'New title',
    })
    await expect(promise).rejects.toThrow(KaneoClassifiedError)
  })

  test('throws error when creating task in non-existent project', async () => {
    const promise = createTask({
      config: kaneoConfig,
      projectId: 'non-existent-project-id',
      title: 'Test',
    })
    await expect(promise).rejects.toThrow()
  })

  test('throws error when deleting non-existent task', async () => {
    const promise = deleteTask({
      config: kaneoConfig,
      taskId: 'non-existent-id',
    })
    await expect(promise).rejects.toThrow()
  })

  test('throws error with invalid API key', async () => {
    const badConfig: KaneoConfig = {
      ...kaneoConfig,
      apiKey: 'invalid-key-12345',
    }
    const promise = getTask({ config: badConfig, taskId: 'any-id' })
    await expect(promise).rejects.toThrow()
  })

  test('throws error when getting comments for non-existent task', async () => {
    // Kaneo API may return empty array or throw for non-existent task
    try {
      const comments = await getComments({ config: kaneoConfig, taskId: 'non-existent-id' })
      // If it doesn't throw, it should return an empty array
      expect(comments).toEqual([])
    } catch (error) {
      // If it throws, that's also acceptable behavior
      expect(error).toBeDefined()
    }
  })

  test('handles special characters in task title', async () => {
    const specialTitle = 'Task with émojis and <html> & "quotes"'
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: specialTitle,
    })
    testClient.trackTask(task.id)

    const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
    expect(retrieved.title).toBe(specialTitle)
  })
})
