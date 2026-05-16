// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/domain-types.test.ts
import { describe, expect, test } from 'bun:test'

import type { RelationType, Task } from '../../src/providers/domain-types.js'

describe('RelationType', () => {
  test('supports all expected relation types', () => {
    const blocks: RelationType = 'blocks'
    const blockedBy: RelationType = 'blocked_by'
    const duplicate: RelationType = 'duplicate'
    const duplicateOf: RelationType = 'duplicate_of'
    const related: RelationType = 'related'
    const parent: RelationType = 'parent'
    const child: RelationType = 'child'

    expect(blocks).toBe('blocks')
    expect(blockedBy).toBe('blocked_by')
    expect(duplicate).toBe('duplicate')
    expect(duplicateOf).toBe('duplicate_of')
    expect(related).toBe('related')
    expect(parent).toBe('parent')
    expect(child).toBe('child')
  })
})

describe('Task subtasks', () => {
  test('subtasks can have status field', () => {
    const task: Task = {
      id: 'TASK-1',
      title: 'Parent Task',
      url: 'https://example.com/issue/TASK-1',
      subtasks: [
        { id: 'TASK-2', idReadable: 'TASK-2', title: 'Subtask 1', status: 'resolved' },
        { id: 'TASK-3', idReadable: 'TASK-3', title: 'Subtask 2', status: 'open' },
      ],
    }

    expect(task.subtasks).toHaveLength(2)
    expect(task.subtasks?.[0]?.status).toBe('resolved')
    expect(task.subtasks?.[1]?.status).toBe('open')
  })

  test('subtasks status is optional', () => {
    const task: Task = {
      id: 'TASK-1',
      title: 'Parent Task',
      url: 'https://example.com/issue/TASK-1',
      subtasks: [{ id: 'TASK-2', title: 'Subtask without status' }],
    }

    expect(task.subtasks?.[0]?.status).toBeUndefined()
  })
})
