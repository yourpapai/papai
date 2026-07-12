// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TaskCapability } from '../../../src/providers/types.js'
import { createScenarioEvents } from './events.js'
import { MemoryTaskProvider } from './memory-task-provider.js'

describe('MemoryTaskProvider', () => {
  test('defaults to an empty capability set', () => {
    expect([...new MemoryTaskProvider().capabilities]).toEqual([])
  })

  test('copies constructor capabilities', () => {
    const capabilities: TaskCapability[] = ['comments.read']
    const provider = new MemoryTaskProvider({ capabilities })
    capabilities.push('projects.read')

    expect([...provider.capabilities]).toEqual(['comments.read'])
  })

  test('replaces capabilities with a copy of the supplied values', () => {
    const provider = new MemoryTaskProvider({ capabilities: ['comments.read'] })
    const capabilities: TaskCapability[] = ['comments.create']
    provider.setCapabilities(capabilities)
    capabilities.push('projects.read')

    expect([...provider.capabilities]).toEqual(['comments.create'])
  })

  test('advertises implemented comment capabilities alongside existing safe capabilities', () => {
    const provider = new MemoryTaskProvider()
    const capabilities: TaskCapability[] = [
      'comments.read',
      'comments.create',
      'comments.update',
      'comments.delete',
      'comments.reactions',
    ]

    provider.setCapabilities(capabilities)

    expect([...provider.capabilities]).toEqual(capabilities)
    expect(() => provider.setCapabilities(['tasks.delete'])).toThrow(
      'MemoryTaskProvider does not support task capabilities: tasks.delete',
    )
    expect([...provider.capabilities]).toEqual(capabilities)
  })

  test('creates, reads, lists, updates, and searches tasks deterministically', async () => {
    const provider = new MemoryTaskProvider()
    const first = await provider.createTask({ projectId: 'project-1', title: 'Release 7', description: 'Ship it' })
    const second = await provider.createTask({ projectId: 'project-2', title: 'Write notes', status: 'open' })

    expect(first).toEqual({
      id: 'task-1',
      projectId: 'project-1',
      title: 'Release 7',
      description: 'Ship it',
      url: 'memory://tasks/task-1',
    })
    expect(second.id).toBe('task-2')
    expect(await provider.getTask(first.id)).toEqual(first)
    expect(await provider.listTasks('project-1')).toEqual([
      { id: 'task-1', title: 'Release 7', url: 'memory://tasks/task-1' },
    ])

    const updated = await provider.updateTask(first.id, { title: 'Release Seven', priority: 'high' })
    expect(updated).toMatchObject({ id: 'task-1', title: 'Release Seven', priority: 'high' })
    expect(await provider.searchTasks({ query: 'seven', projectId: 'project-1' })).toEqual([
      {
        id: 'task-1',
        title: 'Release Seven',
        priority: 'high',
        projectId: 'project-1',
        url: 'memory://tasks/task-1',
      },
    ])
  })

  test('applies deterministic filters, pagination, and ordering', async () => {
    const provider = new MemoryTaskProvider()
    await provider.createTask({ projectId: 'project-1', title: 'Zulu', status: 'done', priority: 'low' })
    await provider.createTask({ projectId: 'project-1', title: 'Alpha', status: 'open', priority: 'high' })
    await provider.createTask({ projectId: 'project-1', title: 'Beta', status: 'open', priority: 'high' })

    expect(
      await provider.listTasks('project-1', {
        status: 'open',
        priority: 'high',
        sortBy: 'title',
        sortOrder: 'asc',
        page: 2,
        limit: 1,
      }),
    ).toEqual([{ id: 'task-3', title: 'Beta', status: 'open', priority: 'high', url: 'memory://tasks/task-3' }])
    expect(await provider.searchTasks({ query: '', offset: 1, limit: 1 })).toHaveLength(1)
  })

  test('throws an exact error for a missing task', async () => {
    const provider = new MemoryTaskProvider()
    await expect(provider.getTask('missing')).rejects.toThrow('Task not found: missing')
    await expect(provider.updateTask('missing', { title: 'Nope' })).rejects.toThrow('Task not found: missing')
  })

  test('creates, lists, reads, updates, and removes comments per task', async () => {
    const provider = new MemoryTaskProvider()
    const firstTask = await provider.createTask({ projectId: 'project-1', title: 'first' })
    const secondTask = await provider.createTask({ projectId: 'project-1', title: 'second' })
    const first = await provider.addComment(firstTask.id, 'first comment')
    const second = await provider.addComment(firstTask.id, 'second comment')
    await provider.addComment(secondTask.id, 'other task comment')

    expect(first).toEqual({ id: 'comment-1', body: 'first comment' })
    expect(await provider.getComments(firstTask.id)).toEqual([
      { id: 'comment-1', body: 'first comment' },
      { id: 'comment-2', body: 'second comment' },
    ])
    expect(await provider.getComments(firstTask.id, { offset: 1, limit: 1 })).toEqual([
      { id: 'comment-2', body: 'second comment' },
    ])
    expect(await provider.getComment(firstTask.id, first.id)).toEqual(first)

    expect(
      await provider.updateComment({ taskId: firstTask.id, commentId: first.id, body: 'updated comment' }),
    ).toEqual({ id: 'comment-1', body: 'updated comment' })
    expect(await provider.removeComment({ taskId: firstTask.id, commentId: second.id })).toEqual({ id: second.id })
    expect(await provider.getComments(firstTask.id)).toEqual([{ id: first.id, body: 'updated comment' }])
    expect(await provider.getComments(secondTask.id)).toEqual([{ id: 'comment-3', body: 'other task comment' }])
  })

  test('snapshots comment pagination before deferred listing', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'project-1', title: 'pagination' })
    await provider.addComment(task.id, 'first comment')
    await provider.addComment(task.id, 'second comment')
    const params = { offset: 0, limit: 1 }

    const comments = provider.getComments(task.id, params)
    params.offset = 1

    await expect(comments).resolves.toEqual([{ id: 'comment-1', body: 'first comment' }])
  })

  test('manages reactions and removes them with their comment', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'project-1', title: 'react' })
    const comment = await provider.addComment(task.id, 'reaction owner')
    const reaction = await provider.addCommentReaction(task.id, comment.id, 'party')

    expect(reaction).toEqual({ id: 'reaction-1', reaction: 'party' })
    expect(await provider.getComment(task.id, comment.id)).toEqual({
      id: comment.id,
      body: 'reaction owner',
      reactions: [reaction],
    })
    expect(await provider.removeCommentReaction(task.id, comment.id, reaction.id)).toEqual({
      id: reaction.id,
      taskId: task.id,
      commentId: comment.id,
    })

    const replacement = await provider.addCommentReaction(task.id, comment.id, 'agree')
    await provider.removeComment({ taskId: task.id, commentId: comment.id })
    await expect(provider.removeCommentReaction(task.id, comment.id, replacement.id)).rejects.toThrow(
      `Comment not found: task ${task.id}, comment ${comment.id}`,
    )
  })

  test('rejects missing comment objects without mutating stored comments', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'project-1', title: 'errors' })
    const comment = await provider.addComment(task.id, 'unchanged comment')

    await expect(provider.getComments('missing')).rejects.toThrow('Task not found: missing')
    await expect(provider.getComment(task.id, 'missing')).rejects.toThrow(
      `Comment not found: task ${task.id}, comment missing`,
    )
    await expect(
      provider.updateComment({ taskId: task.id, commentId: 'missing', body: 'replacement body' }),
    ).rejects.toThrow(`Comment not found: task ${task.id}, comment missing`)
    await expect(provider.removeComment({ taskId: task.id, commentId: 'missing' })).rejects.toThrow(
      `Comment not found: task ${task.id}, comment missing`,
    )
    await expect(provider.addCommentReaction(task.id, comment.id, 'party')).resolves.toEqual({
      id: 'reaction-1',
      reaction: 'party',
    })
    await expect(provider.removeCommentReaction(task.id, comment.id, 'missing')).rejects.toThrow(
      `Comment reaction not found: task ${task.id}, comment ${comment.id}, reaction missing`,
    )
    expect(await provider.getComment(task.id, comment.id)).toEqual({
      id: comment.id,
      body: 'unchanged comment',
      reactions: [{ id: 'reaction-1', reaction: 'party' }],
    })
  })

  test('isolates comment state and emits sanitized comment operation events', async () => {
    const events = createScenarioEvents('comment events')
    const provider = new MemoryTaskProvider({ events })
    const task = await provider.createTask({ projectId: 'project-1', title: 'comments' })
    const created = await provider.addComment(task.id, 'classified comment body')
    created.body = 'mutated output'
    const reaction = await provider.addCommentReaction(task.id, created.id, 'confidential reaction')
    reaction.reaction = 'mutated reaction output'
    const read = await provider.getComment(task.id, created.id)
    read.reactions![0]!.reaction = 'mutated read reaction'
    const listed = await provider.getComments(task.id)
    listed[0]!.body = 'mutated list output'
    await provider.updateComment({ taskId: task.id, commentId: created.id, body: 'updated classified body' })
    await provider.removeCommentReaction(task.id, created.id, reaction.id)
    await provider.removeComment({ taskId: task.id, commentId: created.id })

    expect(await provider.getComments(task.id)).toEqual([])
    expect(
      events
        .all()
        .slice(1)
        .map(({ kind, data }) => ({ kind, data })),
    ).toEqual([
      { kind: 'comment.create', data: { taskId: task.id, commentId: created.id } },
      { kind: 'comment.reaction.create', data: { taskId: task.id, commentId: created.id, reactionId: reaction.id } },
      { kind: 'comment.get', data: { taskId: task.id, commentId: created.id } },
      { kind: 'comment.list', data: { taskId: task.id, count: 1 } },
      { kind: 'comment.update', data: { taskId: task.id, commentId: created.id } },
      { kind: 'comment.reaction.delete', data: { taskId: task.id, commentId: created.id, reactionId: reaction.id } },
      { kind: 'comment.delete', data: { taskId: task.id, commentId: created.id, reactionCount: 0 } },
      { kind: 'comment.list', data: { taskId: task.id, count: 0 } },
    ])
    const trace = JSON.stringify(events.all())
    expect(trace).not.toContain('classified')
    expect(trace).not.toContain('confidential')
    expect(trace).not.toContain('mutated')
  })

  test('isolates stored state and returned values from caller mutation', async () => {
    const provider = new MemoryTaskProvider()
    const customFields = [{ name: 'team', value: 'core' }]
    const created = await provider.createTask({ projectId: 'project-1', title: 'Immutable', customFields })
    customFields[0]!.value = 'changed-input'
    created.customFields![0]!.value = 'changed-output'

    expect(await provider.getTask(created.id)).toMatchObject({ customFields: [{ name: 'team', value: 'core' }] })
    const read = await provider.getTask(created.id)
    read.title = 'changed-read'
    expect((await provider.getTask(created.id)).title).toBe('Immutable')
  })

  test('ignores undefined keys from a real tool-shaped update', async () => {
    const events = createScenarioEvents('tool update')
    const provider = new MemoryTaskProvider({ events })
    const created = await provider.createTask({
      projectId: 'project-1',
      title: 'Original title',
      description: 'Keep this description',
      status: 'open',
      priority: 'medium',
      dueDate: '2026-08-01',
    })

    const updated = await provider.updateTask(created.id, {
      title: 'Changed title',
      description: undefined,
      status: undefined,
      priority: undefined,
      startDate: undefined,
      dueDate: undefined,
      projectId: undefined,
      assignee: undefined,
      customFields: undefined,
    })

    expect(updated).toMatchObject({
      title: 'Changed title',
      description: 'Keep this description',
      status: 'open',
      priority: 'medium',
      dueDate: '2026-08-01',
      projectId: 'project-1',
    })
    expect(events.all().at(-1)).toMatchObject({
      kind: 'task.update',
      data: { taskId: created.id, fields: ['title'] },
    })
  })

  test('starts each provider with fresh IDs and advertises only its implemented core', async () => {
    const first = new MemoryTaskProvider()
    const second = new MemoryTaskProvider()
    expect((await first.createTask({ projectId: 'p', title: 'one' })).id).toBe('task-1')
    expect((await second.createTask({ projectId: 'p', title: 'two' })).id).toBe('task-1')
    expect(first.name).toBe('kaneo')
    expect([...first.capabilities]).toEqual([])
    expect([...first.traits]).toEqual([])
    expect(first.preferredUserIdentifier).toBe('id')
  })

  test('uses an injected ID source and records sanitized operation metadata', async () => {
    const events = createScenarioEvents('memory provider')
    const provider = new MemoryTaskProvider({ events, nextId: (): string => 'fixed-task' })
    await provider.createTask({ projectId: 'project-1', title: 'Sensitive title', description: 'Sensitive body' })
    await provider.getTask('fixed-task')
    await provider.updateTask('fixed-task', { description: 'New secret body' })
    await provider.listTasks('project-1')
    await provider.searchTasks({ query: 'New secret body' })

    expect(events.all().map(({ kind, data }) => ({ kind, data }))).toEqual([
      {
        kind: 'task.create',
        data: {
          taskId: 'fixed-task',
          projectId: 'project-1',
          fields: ['description', 'projectId', 'title'],
        },
      },
      { kind: 'task.get', data: { taskId: 'fixed-task' } },
      { kind: 'task.update', data: { taskId: 'fixed-task', fields: ['description'] } },
      { kind: 'task.list', data: { projectId: 'project-1', count: 1 } },
      { kind: 'task.search', data: { queryLength: 15, count: 1 } },
    ])
    expect(JSON.stringify(events.all())).not.toContain('Sensitive')
    expect(JSON.stringify(events.all())).not.toContain('secret body')
  })

  test('resolves deterministic provider identities without advertising unrelated capabilities', async () => {
    const events = createScenarioEvents('identity resolver')
    const provider = new MemoryTaskProvider({ events })
    provider.addIdentityUser({ id: 'tracker-alice', login: 'alice.dev', name: 'Alice' })
    provider.addIdentityUser({ id: 'tracker-bob', login: 'bob.dev', name: 'Bob' })

    const matches = await provider.identityResolver?.searchUsers('alice', 5)

    expect(matches).toEqual([{ id: 'tracker-alice', login: 'alice.dev', name: 'Alice' }])
    expect([...provider.capabilities]).toEqual([])
    expect(events.all().find(({ kind }) => kind === 'identity.search')?.data).toEqual({
      queryLength: 5,
      limit: 5,
      matchedUserIds: ['tracker-alice'],
    })
  })
})
