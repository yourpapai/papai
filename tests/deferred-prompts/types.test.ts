// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { describeCondition } from '../../src/deferred-prompts/condition-eval.js'
import {
  alertConditionSchema,
  CONDITION_FIELDS,
  deliveryPolicySchema,
  FIELD_OPERATORS,
  parseExecutionMetadata,
  rruleInputSchema,
  scheduleSchema,
} from '../../src/deferred-prompts/types.js'

describe('deliveryPolicySchema', () => {
  test('description states it is group-only and fires in the group', () => {
    expect(deliveryPolicySchema.description).toContain('group')
    expect(deliveryPolicySchema.description).toContain('fires in the group')
    expect(deliveryPolicySchema.description).toContain('DM')
  })

  test('documents the mention_user_ids omit / empty / explicit semantics', () => {
    expect(deliveryPolicySchema.description).toContain('mention_user_ids')
    expect(deliveryPolicySchema.description).toContain('requester')
  })

  test('strips a legacy audience field so it is no longer part of the parsed policy', () => {
    const parsed = deliveryPolicySchema.parse({ audience: 'shared', mention_user_ids: [] })
    expect(parsed).toEqual({ mention_user_ids: [] })
    expect(parsed).not.toHaveProperty('audience')
  })
})

describe('alertConditionSchema', () => {
  describe('valid leaf conditions', () => {
    test('eq with string value', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'eq',
        value: 'done',
      })
      expect(result.success).toBe(true)
    })

    test('overdue without value', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.dueDate',
        op: 'overdue',
      })
      expect(result.success).toBe(true)
    })

    test('gt with date value on dueDate', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.dueDate',
        op: 'gt',
        value: '2026-01-01',
      })
      expect(result.success).toBe(true)
    })

    test('changed_to operator', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.priority',
        op: 'changed_to',
        value: 'urgent',
      })
      expect(result.success).toBe(true)
    })

    test('contains operator for labels', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.labels',
        op: 'contains',
        value: 'bug',
      })
      expect(result.success).toBe(true)
    })

    test('neq operator for project', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.project',
        op: 'neq',
        value: 'archived-project',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('valid combinator conditions', () => {
    test('and combinator', () => {
      const result = alertConditionSchema.safeParse({
        and: [
          { field: 'task.status', op: 'eq', value: 'in-progress' },
          { field: 'task.dueDate', op: 'overdue' },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('or combinator', () => {
      const result = alertConditionSchema.safeParse({
        or: [
          { field: 'task.priority', op: 'eq', value: 'urgent' },
          { field: 'task.priority', op: 'eq', value: 'high' },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('nested combinators', () => {
      const result = alertConditionSchema.safeParse({
        and: [
          {
            or: [
              { field: 'task.status', op: 'eq', value: 'todo' },
              { field: 'task.status', op: 'eq', value: 'in-progress' },
            ],
          },
          { field: 'task.dueDate', op: 'overdue' },
        ],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('invalid conditions', () => {
    test('invalid field name', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.invalid',
        op: 'eq',
        value: 'test',
      })
      expect(result.success).toBe(false)
    })

    test('invalid operator for field', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'overdue',
        value: 'done',
      })
      expect(result.success).toBe(false)
    })

    test('empty and array', () => {
      const result = alertConditionSchema.safeParse({
        and: [],
      })
      expect(result.success).toBe(false)
    })

    test('empty or array', () => {
      const result = alertConditionSchema.safeParse({
        or: [],
      })
      expect(result.success).toBe(false)
    })

    test('gt operator invalid for labels field', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.labels',
        op: 'gt',
        value: '5',
      })
      expect(result.success).toBe(false)
    })

    test('contains operator invalid for status field', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'contains',
        value: 'done',
      })
      expect(result.success).toBe(false)
    })

    test('eq operator without value is rejected', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'eq',
      })
      expect(result.success).toBe(false)
    })

    test('changed_to operator without value is rejected', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.status',
        op: 'changed_to',
      })
      expect(result.success).toBe(false)
    })

    test('lt operator without value is rejected', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.dueDate',
        op: 'lt',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('task.id watch field', () => {
    test('eq with string value is accepted', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.id',
        op: 'eq',
        value: 'task-123',
      })
      expect(result.success).toBe(true)
    })

    test('eq with number value is accepted', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.id',
        op: 'eq',
        value: 42,
      })
      expect(result.success).toBe(true)
    })

    test('neq is rejected with a message naming the field, the operator, and eq as the only valid operator', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.id',
        op: 'neq',
        value: 'task-123',
      })
      expect(result.success).toBe(false)
      assert(!result.success, 'expected parse to fail')
      const messages = result.error.issues.map((i) => i.message).join(' ')
      expect(messages).toContain('task.id')
      expect(messages).toContain("'neq'")
      expect(messages).toContain('Valid operators: eq')
    })

    test('changed_to is rejected', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.id',
        op: 'changed_to',
        value: 'task-123',
      })
      expect(result.success).toBe(false)
    })

    test('eq without value is rejected', () => {
      const result = alertConditionSchema.safeParse({
        field: 'task.id',
        op: 'eq',
      })
      expect(result.success).toBe(false)
    })

    test('composes under nested and/or with other fields', () => {
      const result = alertConditionSchema.safeParse({
        and: [
          { field: 'task.id', op: 'eq', value: 'task-123' },
          {
            or: [
              { field: 'task.status', op: 'eq', value: 'done' },
              { field: 'task.priority', op: 'eq', value: 'urgent' },
            ],
          },
        ],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('activity leaf conditions', () => {
    test('activity leaf without categories is accepted', () => {
      const result = alertConditionSchema.safeParse({
        kind: 'activity',
        taskId: 'task-123',
      })
      expect(result.success).toBe(true)
    })

    test('activity leaf with categories is accepted', () => {
      const result = alertConditionSchema.safeParse({
        kind: 'activity',
        taskId: 'task-123',
        categories: ['comment', 'status'],
      })
      expect(result.success).toBe(true)
    })

    test('activity leaf without taskId is rejected with an issue naming taskId', () => {
      const result = alertConditionSchema.safeParse({
        kind: 'activity',
      })
      expect(result.success).toBe(false)
      assert(!result.success, 'expected parse to fail')
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('taskId')
    })

    test('activity leaves nest under and', () => {
      const result = alertConditionSchema.safeParse({
        and: [
          { kind: 'activity', taskId: 'task-1' },
          { kind: 'activity', taskId: 'task-2' },
        ],
      })
      expect(result.success).toBe(true)
    })

    test('activity leaves nest under or', () => {
      const result = alertConditionSchema.safeParse({
        or: [
          { kind: 'activity', taskId: 'task-1' },
          { field: 'task.status', op: 'eq', value: 'done' },
        ],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('exports', () => {
    test('CONDITION_FIELDS contains all expected fields', () => {
      const fields: string[] = [...CONDITION_FIELDS]
      const expected: string[] = [
        'task.id',
        'task.status',
        'task.priority',
        'task.assignee',
        'task.dueDate',
        'task.project',
        'task.labels',
      ]
      expect(fields).toEqual(expected)
    })

    test('FIELD_OPERATORS allows only eq for task.id', () => {
      const operators: Record<string, readonly string[]> = FIELD_OPERATORS
      expect(operators['task.id']).toEqual(['eq'])
    })

    test('FIELD_OPERATORS has entry for every field', () => {
      for (const field of CONDITION_FIELDS) {
        expect(FIELD_OPERATORS[field]).toBeDefined()
        expect(FIELD_OPERATORS[field].length).toBeGreaterThan(0)
      }
    })
  })
})

describe('describeCondition: activity leaves', () => {
  test('renders the activity kind with the task id', () => {
    const condition = alertConditionSchema.parse({
      kind: 'activity',
      taskId: 'task-123',
    })
    const rendered = describeCondition(condition)
    expect(rendered).toContain('activity')
    expect(rendered).toContain('task-123')
  })

  test('renders categories when present', () => {
    const condition = alertConditionSchema.parse({
      kind: 'activity',
      taskId: 'task-123',
      categories: ['comment', 'status'],
    })
    const rendered = describeCondition(condition)
    expect(rendered).toContain('task-123')
    expect(rendered).toContain('comment')
    expect(rendered).toContain('status')
  })

  test('omits the categories clause when absent', () => {
    const condition = alertConditionSchema.parse({
      kind: 'activity',
      taskId: 'task-123',
    })
    expect(describeCondition(condition)).not.toContain('categories')
  })
})

describe('rruleInputSchema', () => {
  test('accepts a valid daily spec', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      byHour: [9],
      byMinute: [0],
    })
    expect(result.success).toBe(true)
  })

  test('rejects conflicting until and count', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      until: '2026-12-31T00:00:00Z',
      count: 2,
    })
    expect(result.success).toBe(false)
  })

  test('accepts startDate without startTime', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      startDate: '2026-05-01',
    })
    expect(result.success).toBe(true)
  })

  test('accepts startDate and startTime together', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      startDate: '2026-05-01',
      startTime: '09:00',
    })
    expect(result.success).toBe(true)
  })

  test('rejects startTime without startDate', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      startTime: '09:00',
    })
    expect(result.success).toBe(false)
  })

  test('rejects empty byDay array', () => {
    const result = rruleInputSchema.safeParse({ freq: 'WEEKLY', byDay: [] })
    expect(result.success).toBe(false)
  })

  test('rejects empty byHour array', () => {
    const result = rruleInputSchema.safeParse({ freq: 'DAILY', byHour: [] })
    expect(result.success).toBe(false)
  })

  test('rejects empty byMinute array', () => {
    const result = rruleInputSchema.safeParse({ freq: 'DAILY', byMinute: [] })
    expect(result.success).toBe(false)
  })
})

describe('parseExecutionMetadata', () => {
  test('drops a legacy mode key from old rows', () => {
    const parsed = parseExecutionMetadata('{"mode":"context","delivery_brief":"hi","context_snapshot":null}')
    expect(parsed).toEqual({ delivery_brief: 'hi', context_snapshot: null })
    expect('mode' in parsed).toBe(false)
  })
})

describe('scheduleSchema', () => {
  const validFireAt = { date: '2026-12-01', time: '09:00' }
  const validRrule = { freq: 'DAILY' as const, byHour: [9], byMinute: [0] }

  test('accepts fire_at only', () => {
    expect(scheduleSchema.safeParse({ fire_at: validFireAt }).success).toBe(true)
  })

  test('accepts rrule only', () => {
    expect(scheduleSchema.safeParse({ rrule: validRrule }).success).toBe(true)
  })

  test('rejects empty object', () => {
    expect(scheduleSchema.safeParse({}).success).toBe(false)
  })

  test('rejects both fire_at and rrule simultaneously', () => {
    const result = scheduleSchema.safeParse({ fire_at: validFireAt, rrule: validRrule })
    expect(result.success).toBe(false)
    assert(!result.success, 'expected parse to fail')
    const paths = result.error.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('rrule')
  })
})
