// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { z } from 'zod'

import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { listTasks } from '../../src/providers/kaneo/list-tasks.js'
import { getCurrentKaneoUserId, kaneoApiJsonParsed } from './kaneo-api-helpers.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

setDefaultTimeout(10000)

const NullableDateSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

const RawListTaskSchema = z.object({
  id: z.string(),
  dueDate: NullableDateSchema,
})

const RawListResponseSchema = z.object({
  data: z.object({
    columns: z.array(
      z.object({
        tasks: z.array(RawListTaskSchema),
      }),
    ),
    plannedTasks: z.array(RawListTaskSchema),
  }),
})

type RawListResponse = z.infer<typeof RawListResponseSchema>

function getRawListTaskIds(payload: RawListResponse): string[] {
  return payload.data.columns
    .flatMap((column) => column.tasks)
    .concat(payload.data.plannedTasks)
    .map((task) => task.id)
}

function getRawTaskList(projectId: string, query?: Record<string, string>): Promise<RawListResponse> {
  const search = new URLSearchParams(query).toString()
  const suffix = search.length > 0 ? `?${search}` : ''
  return kaneoApiJsonParsed(`/task/tasks/${projectId}${suffix}`, RawListResponseSchema)
}

describe('E2E: Task List Compatibility', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    const project = await testClient.createTestProject(`Task List Compatibility ${Date.now()}`)
    projectId = project.id
  })

  afterEach(async () => {
    await testClient.cleanup()
  })

  test('keeps null dueDate stable and exposes plannedTasks key in raw list payload', async () => {
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Null Due Date ${Date.now()}`,
    })
    testClient.trackTask(task.id)

    const listedTasks = await listTasks({
      config: kaneoConfig,
      projectId,
    })
    const rawPayload = await getRawTaskList(projectId)

    const listedTask = listedTasks.find((candidate) => candidate.id === task.id)

    expect(listedTask).toBeDefined()
    expect(listedTask?.dueDate).toBeNull()
    expect(Array.isArray(rawPayload.data.plannedTasks)).toBe(true)
    expect(getRawListTaskIds(rawPayload)).toContain(task.id)
  })

  test('honors status and assignee filters', async () => {
    const assigneeId = await getCurrentKaneoUserId()
    const assignedInProgress = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Assigned In Progress ${Date.now()}`,
      status: 'in-progress',
      userId: assigneeId,
    })
    const unassignedInProgress = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Unassigned In Progress ${Date.now()}`,
      status: 'in-progress',
    })
    const assignedTodo = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Assigned Todo ${Date.now()}`,
      status: 'to-do',
      userId: assigneeId,
    })

    testClient.trackTask(assignedInProgress.id)
    testClient.trackTask(unassignedInProgress.id)
    testClient.trackTask(assignedTodo.id)

    const statusFiltered = await listTasks({
      config: kaneoConfig,
      projectId,
      params: { status: 'in-progress' },
    })
    const assigneeFiltered = await listTasks({
      config: kaneoConfig,
      projectId,
      params: { assigneeId },
    })

    const statusFilteredIds = statusFiltered.map((task) => task.id)
    const assigneeFilteredIds = assigneeFiltered.map((task) => task.id)

    expect(statusFilteredIds).toContain(assignedInProgress.id)
    expect(statusFilteredIds).toContain(unassignedInProgress.id)
    expect(statusFilteredIds).not.toContain(assignedTodo.id)

    expect(assigneeFilteredIds).toContain(assignedInProgress.id)
    expect(assigneeFilteredIds).toContain(assignedTodo.id)
    expect(assigneeFilteredIds).not.toContain(unassignedInProgress.id)
  })

  test('honors page, limit, sortBy, sortOrder, dueBefore, and dueAfter', async () => {
    const firstTask = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Compat Alpha ${Date.now()}`,
      dueDate: '2026-05-20T10:00:00.000Z',
    })
    const secondTask = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Compat Beta ${Date.now()}`,
      dueDate: '2026-05-21T10:00:00.000Z',
    })
    const thirdTask = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Compat Gamma ${Date.now()}`,
      dueDate: '2026-05-22T10:00:00.000Z',
    })

    testClient.trackTask(firstTask.id)
    testClient.trackTask(secondTask.id)
    testClient.trackTask(thirdTask.id)

    const pagedList = await listTasks({
      config: kaneoConfig,
      projectId,
      params: {
        page: 2,
        limit: 1,
        sortBy: 'number',
        sortOrder: 'asc',
      },
    })
    const dueBeforeList = await listTasks({
      config: kaneoConfig,
      projectId,
      params: {
        sortBy: 'dueDate',
        sortOrder: 'asc',
        dueBefore: '2026-05-22T00:00:00.000Z',
      },
    })
    const dueAfterList = await listTasks({
      config: kaneoConfig,
      projectId,
      params: {
        sortBy: 'dueDate',
        sortOrder: 'asc',
        dueAfter: '2026-05-20T12:00:00.000Z',
      },
    })

    expect(pagedList).toHaveLength(1)
    expect(pagedList[0]?.id).toBe(secondTask.id)

    expect(dueBeforeList.map((task) => task.id)).toEqual([firstTask.id, secondTask.id])
    expect(dueAfterList.map((task) => task.id)).toEqual([secondTask.id, thirdTask.id])
  })
})
