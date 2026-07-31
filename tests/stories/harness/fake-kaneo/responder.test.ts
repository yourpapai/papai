// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { ColumnCompatSchema } from '../../../../plugins/task-provider-kaneo/schemas/api-compat.js'
import { TaskSchema as GetTaskSchema } from '../../../../plugins/task-provider-kaneo/schemas/get-task.js'
import { GlobalSearchResponseSchema } from '../../../../plugins/task-provider-kaneo/schemas/global-search.js'
import { ListTasksResponseSchema } from '../../../../plugins/task-provider-kaneo/schemas/list-tasks.js'
import { ProjectSchema } from '../../../../plugins/task-provider-kaneo/schemas/update-project.js'
import { createFakeKaneoResponder } from './responder.js'

const ErrorBodySchema = z.object({ error: z.string() })

const jsonRequest = (method: string, path: string, body?: unknown): Request => {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  return new Request(`https://kaneo.invalid${path}`, init)
}

describe('createFakeKaneoResponder', () => {
  test('runs a project + task round trip through the documented core routes', async () => {
    const respond = createFakeKaneoResponder()

    const created = await respond(
      jsonRequest('POST', '/api/project', { name: 'Alpha', workspaceId: 'workspace-1', slug: 'alpha' }),
    )
    expect(created.status).toBe(200)
    const project = ProjectSchema.parse(await created.json())
    expect(project.id).toBe('project-1')
    expect(project.name).toBe('Alpha')

    const listed = await respond(new Request('https://kaneo.invalid/api/project?workspaceId=workspace-1'))
    expect(listed.status).toBe(200)
    const projects = ProjectSchema.array().parse(await listed.json())
    expect(projects.map((entry) => entry.id)).toContain(project.id)

    const columnsResponse = await respond(new Request(`https://kaneo.invalid/api/column/${project.id}`))
    expect(columnsResponse.status).toBe(200)
    const columns = ColumnCompatSchema.array().parse(await columnsResponse.json())
    expect(columns.map((column) => column.name)).toContain('To Do')

    const createdTask = await respond(
      jsonRequest(`POST`, `/api/task/${project.id}`, {
        title: 'First task',
        description: 'round trip',
        priority: 'high',
        status: 'to-do',
      }),
    )
    expect(createdTask.status).toBe(200)
    const task = GetTaskSchema.parse(await createdTask.json())
    expect(task.title).toBe('First task')
    expect(task.projectId).toBe(project.id)

    const fetched = await respond(new Request(`https://kaneo.invalid/api/task/${task.id}`))
    expect(fetched.status).toBe(200)
    expect(GetTaskSchema.parse(await fetched.json()).id).toBe(task.id)

    const board = await respond(new Request(`https://kaneo.invalid/api/task/tasks/${project.id}`))
    expect(board.status).toBe(200)
    const parsedBoard = ListTasksResponseSchema.parse(await board.json())
    const allBoardTasks = parsedBoard.data.columns
      .flatMap((column) => column.tasks)
      .concat(parsedBoard.data.plannedTasks)
    expect(allBoardTasks.map((entry) => entry.id)).toContain(task.id)

    const search = await respond(
      new Request('https://kaneo.invalid/api/search?q=first&type=tasks&workspaceId=workspace-1'),
    )
    expect(search.status).toBe(200)
    const parsedSearch = GlobalSearchResponseSchema.parse(await search.json())
    expect(parsedSearch.tasks.map((entry) => entry.id)).toContain(task.id)
    expect(parsedSearch.projects).toEqual([])
  })

  test('auto-creates a To Do column whose slug resolves via the column list', async () => {
    const respond = createFakeKaneoResponder()

    const created = await respond(
      jsonRequest('POST', '/api/project', { name: 'Beta', workspaceId: 'workspace-1', slug: 'beta' }),
    )
    const project = ProjectSchema.parse(await created.json())

    const columns = ColumnCompatSchema.array().parse(
      await (await respond(new Request(`https://kaneo.invalid/api/column/${project.id}`))).json(),
    )
    const toDo = columns.find((column) => column.name === 'To Do')
    expect(toDo).toBeDefined()
    expect(toDo?.slug).toBe('to-do')
  })

  test('gives each responder independent state', async () => {
    const first = createFakeKaneoResponder()
    const second = createFakeKaneoResponder()

    await first(
      jsonRequest('POST', '/api/project', { name: 'Only In First', workspaceId: 'workspace-1', slug: 'first' }),
    )

    const secondList = await second(new Request('https://kaneo.invalid/api/project?workspaceId=workspace-1'))
    expect(ProjectSchema.array().parse(await secondList.json())).toHaveLength(0)
  })

  test('returns 404 for an unknown route', async () => {
    const respond = createFakeKaneoResponder()

    const missing = await respond(new Request('https://kaneo.invalid/api/not-a-route'))

    expect(missing.status).toBe(404)
    expect(ErrorBodySchema.parse(await missing.json()).error).toBe('no route for GET /api/not-a-route')
  })

  test('rejects malformed JSON on a POST with a 400 error', async () => {
    const respond = createFakeKaneoResponder()

    const response = await respond(
      new Request('https://kaneo.invalid/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    )

    expect(response.status).toBe(400)
    expect(ErrorBodySchema.parse(await response.json()).error).toMatch(/json/iu)
  })
})
