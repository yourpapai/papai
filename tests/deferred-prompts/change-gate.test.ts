// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  hasTaskChanges,
  LIGHTWEIGHT_SNAPSHOT_FIELDS,
  RICH_SNAPSHOT_FIELDS,
} from '../../src/deferred-prompts/change-gate.js'
import type { Task } from '../../src/providers/types.js'
import { mockLogger } from '../utils/test-helpers.js'

const makeTask = (overrides: Partial<Task> & { id: string }): Task => ({
  title: 'Test task',
  url: 'https://example.com/task',
  ...overrides,
})

const doneTask = makeTask({ id: 'task-1', status: 'done', priority: 'high' })

beforeEach(() => {
  mockLogger()
})

describe('hasTaskChanges', () => {
  test('returns true when snapshots are empty (first cycle)', () => {
    expect(hasTaskChanges([doneTask], new Map(), LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('returns false when tasks match snapshots', () => {
    const snapshots = new Map([
      ['task-1:status', 'done'],
      ['task-1:priority', 'high'],
    ])
    expect(hasTaskChanges([doneTask], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(false)
  })

  test('returns true when a field value changed', () => {
    const snapshots = new Map([['task-1:status', 'todo']])
    expect(hasTaskChanges([doneTask], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('returns true when a task was added', () => {
    const snapshots = new Map([['task-1:status', 'done']])
    const tasks = [doneTask, makeTask({ id: 'task-2', status: 'todo' })]
    expect(hasTaskChanges(tasks, snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('returns true when a task was removed', () => {
    const snapshots = new Map([
      ['task-1:status', 'done'],
      ['task-2:status', 'todo'],
    ])
    expect(hasTaskChanges([doneTask], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('treats missing field value and missing snapshot as equal', () => {
    const snapshots = new Map([['task-1:status', 'done']])
    const task = makeTask({ id: 'task-1', status: 'done' })
    expect(hasTaskChanges([task], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(false)
  })

  test('returns true when a previously set field becomes empty', () => {
    const snapshots = new Map([
      ['task-1:status', 'done'],
      ['task-1:dueDate', '2026-06-01T00:00:00Z'],
    ])
    expect(hasTaskChanges([doneTask], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('ignores assignee and labels changes for lightweight fields', () => {
    const snapshots = new Map([
      ['task-1:status', 'done'],
      ['task-1:assignee', 'alice'],
      ['task-1:labels', 'bug'],
    ])
    const task = makeTask({ id: 'task-1', status: 'done', assignee: 'bob', labels: [{ id: 'l1', name: 'feature' }] })
    expect(hasTaskChanges([task], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(false)
  })

  test('detects assignee and labels changes for rich fields', () => {
    const base = new Map([
      ['task-1:status', 'done'],
      ['task-1:assignee', 'alice'],
      ['task-1:labels', 'bug'],
    ])
    const reassigned = makeTask({ id: 'task-1', status: 'done', assignee: 'bob', labels: [{ id: 'l1', name: 'bug' }] })
    expect(hasTaskChanges([reassigned], base, RICH_SNAPSHOT_FIELDS)).toBe(true)

    const relabeled = makeTask({
      id: 'task-1',
      status: 'done',
      assignee: 'alice',
      labels: [{ id: 'l2', name: 'feature' }],
    })
    expect(hasTaskChanges([relabeled], base, RICH_SNAPSHOT_FIELDS)).toBe(true)

    const unchanged = makeTask({ id: 'task-1', status: 'done', assignee: 'alice', labels: [{ id: 'l1', name: 'bug' }] })
    expect(hasTaskChanges([unchanged], base, RICH_SNAPSHOT_FIELDS)).toBe(false)
  })
})
