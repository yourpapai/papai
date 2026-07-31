// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { ColumnCompatSchema } from '../../../../plugins/task-provider-kaneo/schemas/api-compat.js'
import {
  CommentListResponseSchema,
  CreateCommentResponseSchema,
} from '../../../../plugins/task-provider-kaneo/schemas/create-comment.js'
import { CreateLabelResponseSchema } from '../../../../plugins/task-provider-kaneo/schemas/create-label.js'
import { TaskSchema as GetTaskSchema } from '../../../../plugins/task-provider-kaneo/schemas/get-task.js'
import { GlobalSearchResponseSchema } from '../../../../plugins/task-provider-kaneo/schemas/global-search.js'
import { ListTasksResponseSchema } from '../../../../plugins/task-provider-kaneo/schemas/list-tasks.js'
import { ProjectSchema } from '../../../../plugins/task-provider-kaneo/schemas/update-project.js'
import { createFakeKaneoResponder } from './responder.js'

const ErrorBodySchema = z.object({ error: z.string() })

const RelationSchema = z.object({
  id: z.string(),
  sourceTaskId: z.string(),
  targetTaskId: z.string(),
  relationType: z.enum(['blocks', 'related', 'subtask']),
  createdAt: z.iso.datetime({ offset: true }),
})

const MemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: z.string(),
})

const AuthResponseSchema = z.object({ user: z.object({ id: z.string() }), token: z.string() })
const InviteResponseSchema = z.object({ id: z.string() })

type Respond = (request: Request) => Promise<Response>

const createProject = async (respond: Respond, name = 'Project', workspaceId = 'workspace-1'): Promise<string> => {
  const res = await respond(jsonRequest('POST', '/api/project', { name, workspaceId, slug: name.toLowerCase() }))
  return ProjectSchema.parse(await res.json()).id
}

const createTask = async (respond: Respond, projectId: string, title = 'Task'): Promise<string> => {
  const res = await respond(jsonRequest('POST', `/api/task/${projectId}`, { title }))
  return GetTaskSchema.parse(await res.json()).id
}

const element = <T>(arr: readonly T[], index: number): T => {
  const value: T | undefined = arr[index]
  if (value === undefined) throw new Error(`expected element at index ${index}`)
  return value
}

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

describe('fake Kaneo read-after-mutation (Task 2 handlers)', () => {
  test('project PUT persists updates on read-back', async () => {
    const respond = createFakeKaneoResponder()
    const projectId = await createProject(respond, 'Original')

    const updated = await respond(
      jsonRequest('PUT', `/api/project/${projectId}`, {
        name: 'Renamed',
        slug: 'renamed',
        description: 'changed',
        icon: '🚀',
        isPublic: true,
      }),
    )
    expect(updated.status).toBe(200)
    const updatedProject = ProjectSchema.parse(await updated.json())
    expect(updatedProject.name).toBe('Renamed')
    expect(updatedProject.slug).toBe('renamed')

    const refetched = await respond(new Request(`https://kaneo.invalid/api/project/${projectId}`))
    expect(refetched.status).toBe(200)
    const readBack = ProjectSchema.parse(await refetched.json())
    expect(readBack.name).toBe('Renamed')
    expect(readBack.slug).toBe('renamed')
    expect(readBack.isPublic).toBe(true)
  })

  test('project DELETE removes the project and cascades its tasks and columns', async () => {
    const respond = createFakeKaneoResponder()
    const projectId = await createProject(respond, 'Doomed')
    const taskId = await createTask(respond, projectId, 'Child')

    const columnsBefore = ColumnCompatSchema.array().parse(
      await (await respond(new Request(`https://kaneo.invalid/api/column/${projectId}`))).json(),
    )
    expect(columnsBefore.length).toBeGreaterThan(0)

    const deleted = await respond(new Request(`https://kaneo.invalid/api/project/${projectId}`, { method: 'DELETE' }))
    expect(deleted.status).toBe(204)

    const refetched = await respond(new Request(`https://kaneo.invalid/api/project/${projectId}`))
    expect(refetched.status).toBe(404)

    const taskAfter = await respond(new Request(`https://kaneo.invalid/api/task/${taskId}`))
    expect(taskAfter.status).toBe(404)

    const columnsAfter = await respond(new Request(`https://kaneo.invalid/api/column/${projectId}`))
    expect(columnsAfter.status).toBe(404)
  })

  test('task PUT persists updates on read-back', async () => {
    const respond = createFakeKaneoResponder()
    const projectId = await createProject(respond)
    const taskId = await createTask(respond, projectId, 'Initial')

    const updated = await respond(
      jsonRequest('PUT', `/api/task/${taskId}`, {
        title: 'Edited',
        description: 'changed body',
        status: 'to-do',
        priority: 'high',
        dueDate: '2026-02-02T00:00:00.000Z',
        startDate: '2026-02-01T00:00:00.000Z',
        userId: 'user-9',
        position: 7,
      }),
    )
    expect(updated.status).toBe(200)

    const refetched = await respond(new Request(`https://kaneo.invalid/api/task/${taskId}`))
    expect(refetched.status).toBe(200)
    const readBack = GetTaskSchema.parse(await refetched.json())
    expect(readBack.title).toBe('Edited')
    expect(readBack.description).toBe('changed body')
    expect(readBack.priority).toBe('high')
    expect(readBack.userId).toBe('user-9')
    expect(readBack.position).toBe(7)
    expect(readBack.dueDate).toBe('2026-02-02T00:00:00.000Z')
  })

  test('task DELETE removes the task on read-back', async () => {
    const respond = createFakeKaneoResponder()
    const projectId = await createProject(respond)
    const taskId = await createTask(respond, projectId, 'Removable')

    const deleted = await respond(new Request(`https://kaneo.invalid/api/task/${taskId}`, { method: 'DELETE' }))
    expect(deleted.status).toBe(204)

    const refetched = await respond(new Request(`https://kaneo.invalid/api/task/${taskId}`))
    expect(refetched.status).toBe(404)
  })

  test('column reorder persists new positions on read-back', async () => {
    const respond = createFakeKaneoResponder()
    const projectId = await createProject(respond, 'Board')

    const initial = ColumnCompatSchema.array().parse(
      await (await respond(new Request(`https://kaneo.invalid/api/column/${projectId}`))).json(),
    )
    const firstId = element(initial, 0).id

    const createdColumn = await respond(jsonRequest('POST', `/api/column/${projectId}`, { name: 'Done' }))
    expect(createdColumn.status).toBe(200)
    const newColumn = ColumnCompatSchema.parse(await createdColumn.json())

    const reorder = await respond(
      jsonRequest('PUT', `/api/column/reorder/${projectId}`, {
        columns: [
          { id: newColumn.id, position: 0 },
          { id: firstId, position: 1 },
        ],
      }),
    )
    expect(reorder.status).toBe(200)

    const after = ColumnCompatSchema.array().parse(
      await (await respond(new Request(`https://kaneo.invalid/api/column/${projectId}`))).json(),
    )
    expect(element(after, 0).id).toBe(newColumn.id)
    expect(element(after, 1).id).toBe(firstId)
  })
})

describe('fake Kaneo comments', () => {
  test('create, list, update, and delete a comment round trip', async () => {
    const respond = createFakeKaneoResponder()
    const projectId = await createProject(respond)
    const taskId = await createTask(respond, projectId, 'Host')

    const created = await respond(jsonRequest('POST', `/api/comment/${taskId}`, { content: 'first note' }))
    expect(created.status).toBe(200)
    const comment = CreateCommentResponseSchema.parse(await created.json())
    expect(comment.taskId).toBe(taskId)
    expect(comment.content).toBe('first note')

    const listed = await respond(new Request(`https://kaneo.invalid/api/comment/${taskId}`))
    expect(listed.status).toBe(200)
    const comments = CommentListResponseSchema.parse(await listed.json())
    expect(comments.map((c) => c.content)).toEqual(['first note'])

    const updated = await respond(jsonRequest('PUT', `/api/comment/${comment.id}`, { content: 'edited note' }))
    expect(updated.status).toBe(200)
    const edited = CreateCommentResponseSchema.parse(await updated.json())
    expect(edited.id).toBe(comment.id)
    expect(edited.content).toBe('edited note')

    const deleted = await respond(new Request(`https://kaneo.invalid/api/comment/${comment.id}`, { method: 'DELETE' }))
    expect(deleted.status).toBe(200)
    expect(CreateCommentResponseSchema.parse(await deleted.json()).id).toBe(comment.id)

    const after = await respond(new Request(`https://kaneo.invalid/api/comment/${taskId}`))
    expect(CommentListResponseSchema.parse(await after.json())).toEqual([])
  })
})

describe('fake Kaneo labels', () => {
  test('create, list, get, update, attach, and detach a label', async () => {
    const respond = createFakeKaneoResponder()
    const projectId = await createProject(respond)
    const taskId = await createTask(respond, projectId, 'Labeled')

    const created = await respond(
      jsonRequest('POST', '/api/label', { workspaceId: 'workspace-1', name: 'bug', color: '#ff0000' }),
    )
    expect(created.status).toBe(200)
    const label = CreateLabelResponseSchema.parse(await created.json())
    expect(label.name).toBe('bug')
    expect(label.taskId).toBeNull()

    const listed = await respond(new Request('https://kaneo.invalid/api/label/workspace/workspace-1'))
    expect(listed.status).toBe(200)
    const labels = CreateLabelResponseSchema.array().parse(await listed.json())
    expect(labels.map((l) => l.id)).toContain(label.id)

    const fetched = await respond(new Request(`https://kaneo.invalid/api/label/${label.id}`))
    expect(fetched.status).toBe(200)
    expect(CreateLabelResponseSchema.parse(await fetched.json()).id).toBe(label.id)

    const updated = await respond(jsonRequest('PUT', `/api/label/${label.id}`, { name: 'defect', color: '#00ff00' }))
    expect(updated.status).toBe(200)
    const updatedLabel = CreateLabelResponseSchema.parse(await updated.json())
    expect(updatedLabel.name).toBe('defect')
    expect(updatedLabel.color).toBe('#00ff00')

    const attached = await respond(jsonRequest('PUT', `/api/label/${label.id}/task`, { taskId }))
    expect(attached.status).toBe(200)
    const attachedLabel = CreateLabelResponseSchema.parse(await attached.json())
    expect(attachedLabel.taskId).toBe(taskId)

    const taskLabels = await respond(new Request(`https://kaneo.invalid/api/label/task/${taskId}`))
    expect(taskLabels.status).toBe(200)
    expect(
      CreateLabelResponseSchema.array()
        .parse(await taskLabels.json())
        .map((l) => l.id),
    ).toContain(label.id)

    const detached = await respond(jsonRequest('DELETE', `/api/label/${label.id}/task`, { taskId }))
    expect(detached.status).toBe(200)
    expect(CreateLabelResponseSchema.parse(await detached.json()).taskId).toBeNull()

    const taskLabelsAfter = await respond(new Request(`https://kaneo.invalid/api/label/task/${taskId}`))
    expect(CreateLabelResponseSchema.array().parse(await taskLabelsAfter.json())).toEqual([])
  })
})

describe('fake Kaneo task relations', () => {
  test('create, list, and delete a relation with a stable id', async () => {
    const respond = createFakeKaneoResponder()
    const projectId = await createProject(respond)
    const firstTaskId = await createTask(respond, projectId, 'Source')
    const secondTaskId = await createTask(respond, projectId, 'Target')

    const created = await respond(
      jsonRequest('POST', '/api/task-relation', {
        sourceTaskId: firstTaskId,
        targetTaskId: secondTaskId,
        relationType: 'blocks',
      }),
    )
    expect(created.status).toBe(200)
    const relation = RelationSchema.parse(await created.json())
    expect(relation.sourceTaskId).toBe(firstTaskId)
    expect(relation.targetTaskId).toBe(secondTaskId)
    expect(relation.relationType).toBe('blocks')

    const listed = await respond(new Request(`https://kaneo.invalid/api/task-relation/${firstTaskId}`))
    expect(listed.status).toBe(200)
    const relations = RelationSchema.array().parse(await listed.json())
    expect(relations.map((r) => r.id)).toContain(relation.id)

    const deleted = await respond(
      new Request(`https://kaneo.invalid/api/task-relation/${relation.id}`, { method: 'DELETE' }),
    )
    expect(deleted.status).toBe(200)
    expect(RelationSchema.parse(await deleted.json()).id).toBe(relation.id)

    const after = await respond(new Request(`https://kaneo.invalid/api/task-relation/${firstTaskId}`))
    expect(RelationSchema.array().parse(await after.json())).toEqual([])
  })
})

describe('fake Kaneo members and auth', () => {
  test('sign-up, invite, accept, and list workspace members', async () => {
    const respond = createFakeKaneoResponder()

    const signUp = await respond(
      jsonRequest('POST', '/api/auth/sign-up/email', { email: 'alice@pap.ai', password: 'pwAa1!', name: 'Alice' }),
    )
    expect(signUp.status).toBe(200)
    const authed = AuthResponseSchema.parse(await signUp.json())
    expect(authed.user.id.length).toBeGreaterThan(0)

    const invite = await respond(
      jsonRequest('POST', '/api/auth/organization/invite-member', {
        email: 'alice@pap.ai',
        role: 'member',
        organizationId: 'workspace-1',
      }),
    )
    expect(invite.status).toBe(200)
    const invitation = InviteResponseSchema.parse(await invite.json())
    expect(invitation.id.length).toBeGreaterThan(0)

    const empty = await respond(new Request('https://kaneo.invalid/api/workspace/workspace-1/members'))
    expect(MemberSchema.array().parse(await empty.json())).toEqual([])

    const accept = await respond(
      jsonRequest('POST', '/api/auth/organization/accept-invitation', { invitationId: invitation.id }),
    )
    expect(accept.status).toBe(200)

    const members = await respond(new Request('https://kaneo.invalid/api/workspace/workspace-1/members'))
    expect(members.status).toBe(200)
    const listed = MemberSchema.array().parse(await members.json())
    expect(listed).toHaveLength(1)
    const member = element(listed, 0)
    expect(member.email).toBe('alice@pap.ai')
    expect(member.name).toBe('Alice')
    expect(member.role).toBe('member')
    expect(member.image).toBeNull()
  })

  test('sign-in returns a token for a previously signed-up user', async () => {
    const respond = createFakeKaneoResponder()
    await respond(
      jsonRequest('POST', '/api/auth/sign-up/email', { email: 'bob@pap.ai', password: 'pwAa1!', name: 'Bob' }),
    )

    const signIn = await respond(
      jsonRequest('POST', '/api/auth/sign-in/email', { email: 'bob@pap.ai', password: 'pwAa1!' }),
    )
    expect(signIn.status).toBe(200)
    const session = AuthResponseSchema.parse(await signIn.json())
    expect(session.user.id.length).toBeGreaterThan(0)
    expect(session.token.length).toBeGreaterThan(0)
  })

  test('sign-in rejects an unknown user', async () => {
    const respond = createFakeKaneoResponder()

    const signIn = await respond(
      jsonRequest('POST', '/api/auth/sign-in/email', { email: 'ghost@pap.ai', password: 'pwAa1!' }),
    )
    expect(signIn.status).toBe(401)
  })
})

describe('fake Kaneo routing strictness', () => {
  test('returns 405 for an unknown method on a known comment path', async () => {
    const respond = createFakeKaneoResponder()

    const patch = await respond(new Request('https://kaneo.invalid/api/comment/task-1', { method: 'PATCH' }))

    expect(patch.status).toBe(405)
    expect(ErrorBodySchema.parse(await patch.json()).error).toMatch(/method/u)
  })

  test('returns 400 for a malformed object body without mutating state', async () => {
    const respond = createFakeKaneoResponder()

    const rejected = await respond(
      new Request('https://kaneo.invalid/api/comment/task-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([1, 2, 3]),
      }),
    )
    expect(rejected.status).toBe(400)

    const listed = await respond(new Request('https://kaneo.invalid/api/comment/task-1'))
    expect(CommentListResponseSchema.parse(await listed.json())).toEqual([])
  })
})
