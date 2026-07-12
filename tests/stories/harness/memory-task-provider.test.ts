// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createScenarioEvents } from './events.js'
import { MemoryTaskProvider } from './memory-task-provider.js'

describe('MemoryTaskProvider', () => {
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
})
