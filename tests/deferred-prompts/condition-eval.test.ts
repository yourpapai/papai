// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  evaluateCondition,
  extractWatchedTaskIds,
  isPureWatchCondition,
} from '../../src/deferred-prompts/condition-eval.js'
import { alertConditionSchema } from '../../src/deferred-prompts/types.js'
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
