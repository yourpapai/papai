// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { z } from 'zod'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../plugins/task-provider-kaneo/client.js'
import { createTask } from '../../plugins/task-provider-kaneo/create-task.js'
import { getTask } from '../../plugins/task-provider-kaneo/get-task.js'
import { updateTask } from '../../plugins/task-provider-kaneo/update-task.js'
import { getCurrentKaneoUserId, kaneoApiJsonParsed } from './kaneo-api-helpers.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

const NullableStringSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

const RawTaskDatesSchema = z.object({
  startDate: NullableStringSchema,
  dueDate: NullableStringSchema,
  userId: NullableStringSchema,
})

const RawTaskStartDateSchema = z.object({
  startDate: NullableStringSchema,
})

describe('E2E: Task Lifecycle', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    const project = await testClient.createTestProject(`E2E Test ${Date.now()}`)
    projectId = project.id
  })

  afterEach(async () => {
    await testClient.cleanup()
  })

  test('creates and retrieves a task with startDate, dueDate, and assignee', async () => {
    const assigneeId = await getCurrentKaneoUserId()
    const startDate = '2026-05-20T09:00:00.000Z'
    const dueDate = '2026-05-21T17:00:00.000Z'

    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Dated Task ${Date.now()}`,
      startDate,
      dueDate,
      userId: assigneeId,
    })
    testClient.trackTask(task.id)

    const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
    const rawTask = await kaneoApiJsonParsed(`/task/${task.id}`, RawTaskDatesSchema)

    expect(retrieved.startDate).toBe(startDate)
    expect(retrieved.dueDate).toBe(dueDate)
    expect(retrieved.userId).toBe(assigneeId)
    expect(rawTask.startDate).toBe(startDate)
    expect(rawTask.dueDate).toBe(dueDate)
    expect(rawTask.userId).toBe(assigneeId)
  })

  test('overrides startDate when updating it explicitly', async () => {
    const originalStartDate = '2026-05-23T09:00:00.000Z'
    const replacementStartDate = '2026-05-24T12:30:00.000Z'

    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Override Start ${Date.now()}`,
      startDate: originalStartDate,
    })
    testClient.trackTask(task.id)

    await updateTask({
      config: kaneoConfig,
      taskId: task.id,
      startDate: replacementStartDate,
    })

    const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
    const rawTask = await kaneoApiJsonParsed(`/task/${task.id}`, RawTaskStartDateSchema)

    expect(retrieved.startDate).toBe(replacementStartDate)
    expect(rawTask.startDate).toBe(replacementStartDate)
  })
})
