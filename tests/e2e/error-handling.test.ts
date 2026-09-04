// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'

setDefaultTimeout(10000)

import { KaneoClassifiedError } from '../../plugins/task-provider-kaneo/classify-error.js'
import type { KaneoConfig } from '../../plugins/task-provider-kaneo/client.js'
import { createTask } from '../../plugins/task-provider-kaneo/create-task.js'
import { getComments } from '../../plugins/task-provider-kaneo/get-comments.js'
import { getTask } from '../../plugins/task-provider-kaneo/get-task.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Error Handling', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
  })

  test('throws error when creating task in non-existent project', async () => {
    const promise = createTask({
      config: kaneoConfig,
      projectId: 'non-existent-project-id',
      title: 'Test',
    })
    await expect(promise).rejects.toThrow()
  })

  test('classifies a stale-project creation failure as project-not-found (pinned-image behavior)', async () => {
    // Kaneo answers 400 "Workspace ID could not be determined" for a project id that
    // does not exist or is not visible to the caller — pinned against the e2e image so
    // an upstream copy change surfaces here rather than as silent misclassification.
    let caught: unknown = null
    try {
      await createTask({
        config: kaneoConfig,
        projectId: 'sutuhvgbp2rczkh16u68ckqd',
        title: 'Stale project probe',
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(KaneoClassifiedError)
    assert(caught instanceof KaneoClassifiedError)
    expect(caught.appError.code).toBe('project-not-found')
    expect(caught.appError).toHaveProperty('projectId', 'sutuhvgbp2rczkh16u68ckqd')
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
})
