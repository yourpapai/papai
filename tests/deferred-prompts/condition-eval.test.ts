// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  describeCondition,
  evaluateCondition,
  extractActivityTaskIds,
  extractWatchedTaskIds,
  isPureActivityCondition,
  isPureWatchCondition,
} from '../../src/deferred-prompts/condition-eval.js'
import { alertConditionSchema } from '../../src/deferred-prompts/condition-schema.js'
import type { Task } from '../../src/providers/types.js'

const task: Task = { id: 'task-1', title: 'Login work', url: 'https://tasks.invalid/task-1' }

const activityLeaf = alertConditionSchema.parse({ kind: 'activity', taskId: 'task-1' })

describe('condition-eval: activity leaves', () => {
  test('evaluateCondition returns false for an activity leaf', () => {
    expect(evaluateCondition(activityLeaf, task, new Map())).toBe(false)
  })

  test('evaluateCondition treats activity leaves as false inside combinators', () => {
    const andTree = alertConditionSchema.parse({
      and: [activityLeaf, { field: 'task.status', op: 'eq', value: 'done' }],
    })
    expect(evaluateCondition(andTree, task, new Map())).toBe(false)

    const orTree = alertConditionSchema.parse({
      or: [activityLeaf, { field: 'task.id', op: 'eq', value: 'task-1' }],
    })
    expect(evaluateCondition(orTree, task, new Map())).toBe(true)
  })

  test('extractWatchedTaskIds ignores activity leaves', () => {
    const tree = alertConditionSchema.parse({
      and: [activityLeaf, { field: 'task.id', op: 'eq', value: 'task-1' }],
    })
    expect(extractWatchedTaskIds(tree)).toEqual(['task-1'])
    expect(extractWatchedTaskIds(activityLeaf)).toEqual([])
  })

  test('isPureWatchCondition is false for activity leaves', () => {
    expect(isPureWatchCondition(activityLeaf)).toBe(false)
    const tree = alertConditionSchema.parse({
      and: [{ field: 'task.id', op: 'eq', value: 'task-1' }, activityLeaf],
    })
    expect(isPureWatchCondition(tree)).toBe(false)
  })
})

describe('extractActivityTaskIds', () => {
  test('collects the deduped union of activity leaf task ids across the tree', () => {
    const tree = alertConditionSchema.parse({
      and: [
        { kind: 'activity', taskId: 'task-1' },
        {
          or: [
            { kind: 'activity', taskId: 'task-2' },
            { kind: 'activity', taskId: 'task-1' },
          ],
        },
      ],
    })
    expect(extractActivityTaskIds(tree)).toEqual(['task-1', 'task-2'])
  })

  test('ignores field leaves and watch leaves', () => {
    const tree = alertConditionSchema.parse({
      and: [
        { kind: 'activity', taskId: 'task-1' },
        { field: 'task.id', op: 'eq', value: 'task-9' },
        { field: 'task.status', op: 'eq', value: 'done' },
      ],
    })
    expect(extractActivityTaskIds(tree)).toEqual(['task-1'])
    const fieldOnly = alertConditionSchema.parse({ field: 'task.status', op: 'eq', value: 'done' })
    expect(extractActivityTaskIds(fieldOnly)).toEqual([])
  })
})

describe('isPureActivityCondition', () => {
  test('true for a bare activity leaf and for and/or trees of activity leaves', () => {
    expect(isPureActivityCondition(activityLeaf)).toBe(true)
    const tree = alertConditionSchema.parse({
      or: [activityLeaf, { kind: 'activity', taskId: 'task-2' }],
    })
    expect(isPureActivityCondition(tree)).toBe(true)
  })

  test('false when any field leaf is present', () => {
    const fieldOnly = alertConditionSchema.parse({ field: 'task.status', op: 'eq', value: 'done' })
    expect(isPureActivityCondition(fieldOnly)).toBe(false)
    const tree = alertConditionSchema.parse({
      and: [activityLeaf, { field: 'task.id', op: 'eq', value: 'task-1' }],
    })
    expect(isPureActivityCondition(tree)).toBe(false)
    const mixedOr = alertConditionSchema.parse({
      or: [activityLeaf, { field: 'task.status', op: 'eq', value: 'done' }],
    })
    expect(isPureActivityCondition(mixedOr)).toBe(false)
  })

  test('true for an and-combined tree of activity leaves', () => {
    const tree = alertConditionSchema.parse({
      and: [activityLeaf, { kind: 'activity', taskId: 'task-2' }],
    })
    expect(isPureActivityCondition(tree)).toBe(true)
  })
})

describe('isPureWatchCondition — or-combined trees', () => {
  test('an or of watch and field leaves is not a pure watch', () => {
    const tree = alertConditionSchema.parse({
      or: [
        { field: 'task.id', op: 'eq', value: 'task-1' },
        { field: 'task.status', op: 'eq', value: 'done' },
      ],
    })
    expect(isPureWatchCondition(tree)).toBe(false)
  })
})

describe('describeCondition — activity leaves', () => {
  test('renders the task id without a categories suffix when categories are absent', () => {
    expect(describeCondition(activityLeaf)).toBe('activity on task "task-1"')
  })

  test('renders sanitized categories joined with a comma', () => {
    const withCategories = alertConditionSchema.parse({
      kind: 'activity',
      taskId: 'task-1',
      categories: ['comment', 'status'],
    })
    expect(describeCondition(withCategories)).toBe('activity on task "task-1" (categories: comment, status)')
  })
})

describe('describeCondition — sanitization of leaf values', () => {
  test('collapses newlines inside values to spaces', () => {
    const leaf = alertConditionSchema.parse({ field: 'task.status', op: 'eq', value: 'done\nsoon' })
    expect(describeCondition(leaf)).toBe('task.status eq "done soon"')
  })
})
