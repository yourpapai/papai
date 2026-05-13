import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  alertConditionSchema,
  CONDITION_FIELDS,
  FIELD_OPERATORS,
  rruleInputSchema,
  scheduleSchema,
} from '../../src/deferred-prompts/types.js'

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

  describe('exports', () => {
    test('CONDITION_FIELDS contains all expected fields', () => {
      expect(CONDITION_FIELDS).toEqual([
        'task.status',
        'task.priority',
        'task.assignee',
        'task.dueDate',
        'task.project',
        'task.labels',
      ])
    })

    test('FIELD_OPERATORS has entry for every field', () => {
      for (const field of CONDITION_FIELDS) {
        expect(FIELD_OPERATORS[field]).toBeDefined()
        expect(FIELD_OPERATORS[field].length).toBeGreaterThan(0)
      }
    })
  })
})

describe('rruleInputSchema', () => {
  test('accepts a valid daily spec', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      byHour: [9],
      byMinute: [0],
      timezone: 'UTC',
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid IANA timezone', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      timezone: 'Not/A_Zone',
    })
    expect(result.success).toBe(false)
  })

  test('rejects conflicting until and count', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      until: '2026-12-31T00:00:00Z',
      count: 2,
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  test('accepts startDate without startTime', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      timezone: 'UTC',
      startDate: '2026-05-01',
    })
    expect(result.success).toBe(true)
  })

  test('accepts startDate and startTime together', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      timezone: 'UTC',
      startDate: '2026-05-01',
      startTime: '09:00',
    })
    expect(result.success).toBe(true)
  })

  test('rejects startTime without startDate', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      timezone: 'UTC',
      startTime: '09:00',
    })
    expect(result.success).toBe(false)
  })

  test('rejects empty byDay array', () => {
    const result = rruleInputSchema.safeParse({ freq: 'WEEKLY', byDay: [], timezone: 'UTC' })
    expect(result.success).toBe(false)
  })

  test('rejects empty byHour array', () => {
    const result = rruleInputSchema.safeParse({ freq: 'DAILY', byHour: [], timezone: 'UTC' })
    expect(result.success).toBe(false)
  })

  test('rejects empty byMinute array', () => {
    const result = rruleInputSchema.safeParse({ freq: 'DAILY', byMinute: [], timezone: 'UTC' })
    expect(result.success).toBe(false)
  })
})

describe('scheduleSchema', () => {
  const validFireAt = { date: '2026-12-01', time: '09:00' }
  const validRrule = { freq: 'DAILY' as const, byHour: [9], byMinute: [0], timezone: 'UTC' }

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
