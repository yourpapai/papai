// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getSnapshotsForUser, updateSnapshots } from '../../src/deferred-prompts/snapshots.js'
import type { Task } from '../../src/providers/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const makeTask = (overrides: Partial<Task> & { id: string }): Task => ({
  title: 'Test task',
  url: 'https://example.com/task',
  ...overrides,
})

describe('snapshots', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('captures snapshots for tasks in bulk', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'in-progress',
        priority: 'high',
        assignee: 'alice',
        dueDate: '2026-04-01',
        projectId: 'proj-1',
      }),
    ]

    updateSnapshots('user-1', tasks)

    const snapshots = getSnapshotsForUser('user-1')
    expect(snapshots.get('task-1:status')).toBe('in-progress')
    expect(snapshots.get('task-1:priority')).toBe('high')
    expect(snapshots.get('task-1:assignee')).toBe('alice')
    expect(snapshots.get('task-1:dueDate')).toBe('2026-04-01')
    expect(snapshots.get('task-1:project')).toBe('proj-1')
  })

  test('skips null fields', () => {
    const tasks = [
      makeTask({
        id: 'task-2',
        status: 'todo',
        // priority, assignee, dueDate, projectId are undefined → null
      }),
    ]

    updateSnapshots('user-1', tasks)

    const snapshots = getSnapshotsForUser('user-1')
    expect(snapshots.get('task-2:status')).toBe('todo')
    expect(snapshots.has('task-2:priority')).toBe(false)
    expect(snapshots.has('task-2:assignee')).toBe(false)
    expect(snapshots.has('task-2:dueDate')).toBe(false)
    expect(snapshots.has('task-2:project')).toBe(false)
  })

  test('updates snapshots in bulk for multiple tasks', () => {
    const tasks: Task[] = [
      makeTask({ id: 'task-a', status: 'todo', priority: 'low' }),
      makeTask({ id: 'task-b', status: 'done', priority: 'urgent' }),
    ]

    updateSnapshots('user-1', tasks)

    const snapshots = getSnapshotsForUser('user-1')
    expect(snapshots.get('task-a:status')).toBe('todo')
    expect(snapshots.get('task-a:priority')).toBe('low')
    expect(snapshots.get('task-b:status')).toBe('done')
    expect(snapshots.get('task-b:priority')).toBe('urgent')
  })

  test('overwrites existing snapshot values (upsert)', () => {
    const task = makeTask({ id: 'task-1', status: 'todo', priority: 'low' })
    updateSnapshots('user-1', [task])

    expect(getSnapshotsForUser('user-1').get('task-1:status')).toBe('todo')

    const updated = makeTask({ id: 'task-1', status: 'done', priority: 'high' })
    updateSnapshots('user-1', [updated])

    const snapshots = getSnapshotsForUser('user-1')
    expect(snapshots.get('task-1:status')).toBe('done')
    expect(snapshots.get('task-1:priority')).toBe('high')
  })

  test('isolates snapshots between users', () => {
    updateSnapshots('user-1', [makeTask({ id: 'task-1', status: 'todo' })])
    updateSnapshots('user-2', [makeTask({ id: 'task-1', status: 'done' })])

    const user1Snapshots = getSnapshotsForUser('user-1')
    const user2Snapshots = getSnapshotsForUser('user-2')

    expect(user1Snapshots.get('task-1:status')).toBe('todo')
    expect(user2Snapshots.get('task-1:status')).toBe('done')
  })

  test('prunes all snapshots when tasks list is empty', () => {
    updateSnapshots('user-1', [
      makeTask({ id: 'task-1', status: 'todo', priority: 'high' }),
      makeTask({ id: 'task-2', status: 'done' }),
    ])

    expect(getSnapshotsForUser('user-1').size).toBeGreaterThan(0)

    updateSnapshots('user-1', [])

    expect(getSnapshotsForUser('user-1').size).toBe(0)
  })
})
