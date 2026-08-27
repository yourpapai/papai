// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ZodSafeParseResult } from 'zod'

import {
  deliveryPolicySchema,
  parseExecutionMetadata,
  parseMatchedTaskIds,
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

  test('accepts every documented freq value', () => {
    for (const freq of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const) {
      expect(rruleInputSchema.safeParse({ freq }).success).toBe(true)
    }
  })

  test('accepts count on its own and until on its own', () => {
    expect(rruleInputSchema.safeParse({ freq: 'DAILY', count: 2 }).success).toBe(true)
    expect(rruleInputSchema.safeParse({ freq: 'DAILY', until: '2026-12-31T00:00:00Z' }).success).toBe(true)
  })

  test('flags conflicting until and count at the count path with the contract message', () => {
    const result = rruleInputSchema.safeParse({
      freq: 'DAILY',
      until: '2026-12-31T00:00:00Z',
      count: 2,
    })
    assert(!result.success, 'expected parse to fail')
    const issue = result.error.issues.find((i) => i.code === 'custom')
    expect(issue?.message).toBe('until and count are mutually exclusive')
    expect(issue?.path).toEqual(['count'])
  })

  test('flags startTime without startDate at the startDate path with the contract message', () => {
    const result = rruleInputSchema.safeParse({ freq: 'DAILY', startTime: '09:00' })
    assert(!result.success, 'expected parse to fail')
    const issue = result.error.issues.find((i) => i.code === 'custom')
    expect(issue?.message).toBe('startDate is required when startTime is provided')
    expect(issue?.path).toEqual(['startDate'])
  })

  test('startTime must be a fully anchored HH:MM string', () => {
    const at = (startTime: string): ZodSafeParseResult<unknown> =>
      rruleInputSchema.safeParse({ freq: 'DAILY', startDate: '2026-05-01', startTime })
    expect(at('00:00').success).toBe(true)
    expect(at('23:59').success).toBe(true)
    for (const bad of ['24:00', '09:60', '9:00', 'x09:00', '09:00x']) {
      const result = rruleInputSchema.safeParse({ freq: 'DAILY', startTime: bad })
      assert(!result.success, `expected ${bad} to be rejected`)
      expect(
        result.error.issues.some((i) => i.message === 'must be HH:MM with valid hour (0-23) and minute (0-59)'),
      ).toBe(true)
    }
  })

  test('accepts the full weekday list in byDay', () => {
    expect(
      rruleInputSchema.safeParse({ freq: 'WEEKLY', byDay: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] }).success,
    ).toBe(true)
    expect(rruleInputSchema.safeParse({ freq: 'WEEKLY', byDay: ['XX'] }).success).toBe(false)
  })

  test('bounds interval, byMonthDay, byMonth, byHour and byMinute', () => {
    expect(rruleInputSchema.safeParse({ freq: 'DAILY', interval: 0 }).success).toBe(false)
    expect(rruleInputSchema.safeParse({ freq: 'DAILY', interval: 2 }).success).toBe(true)
    expect(rruleInputSchema.safeParse({ freq: 'MONTHLY', byMonthDay: [1, 2] }).success).toBe(true)
    expect(rruleInputSchema.safeParse({ freq: 'MONTHLY', byMonthDay: [32] }).success).toBe(false)
    expect(rruleInputSchema.safeParse({ freq: 'MONTHLY', byMonth: [1, 2] }).success).toBe(true)
    expect(rruleInputSchema.safeParse({ freq: 'MONTHLY', byMonth: [13] }).success).toBe(false)
    expect(rruleInputSchema.safeParse({ freq: 'DAILY', byHour: [0, 23] }).success).toBe(true)
    expect(rruleInputSchema.safeParse({ freq: 'DAILY', byHour: [24] }).success).toBe(false)
    expect(rruleInputSchema.safeParse({ freq: 'DAILY', byMinute: [59] }).success).toBe(true)
    expect(rruleInputSchema.safeParse({ freq: 'DAILY', byMinute: [60] }).success).toBe(false)
  })
})

describe('parseExecutionMetadata', () => {
  test('drops a legacy mode key from old rows', () => {
    const parsed = parseExecutionMetadata('{"mode":"context","delivery_brief":"hi","context_snapshot":null}')
    expect(parsed).toEqual({ delivery_brief: 'hi', context_snapshot: null })
    expect('mode' in parsed).toBe(false)
  })
})

describe('parseMatchedTaskIds', () => {
  test('keeps only the string entries of a stored array', () => {
    expect(parseMatchedTaskIds('["task-1", 7, true, "task-2"]')).toEqual(['task-1', 'task-2'])
  })

  test('returns an empty list for non-array and unparseable rows', () => {
    expect(parseMatchedTaskIds('{"id":"task-1"}')).toEqual([])
    expect(parseMatchedTaskIds('null')).toEqual([])
    expect(parseMatchedTaskIds('not json')).toEqual([])
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
    expect(
      result.error.issues.some((i) => i.message === 'fire_at and rrule are mutually exclusive — provide exactly one'),
    ).toBe(true)
  })

  test('rejects neither fire_at nor rrule with the exactly-one contract at the fire_at path', () => {
    const result = scheduleSchema.safeParse({})
    expect(result.success).toBe(false)
    assert(!result.success, 'expected parse to fail')
    const issue = result.error.issues.find((i) => i.code === 'custom')
    expect(issue?.message).toBe('provide exactly one of fire_at or rrule')
    expect(issue?.path).toEqual(['fire_at'])
  })

  test('fire_at time must be a fully anchored HH:MM string', () => {
    const at = (time: string): ZodSafeParseResult<unknown> =>
      scheduleSchema.safeParse({ fire_at: { date: '2026-12-01', time } })
    expect(at('00:00').success).toBe(true)
    expect(at('23:59').success).toBe(true)
    for (const bad of ['24:00', '09:60', '9:00', 'x09:00', '09:00x']) {
      const result = at(bad)
      assert(!result.success, `expected ${bad} to be rejected`)
      expect(
        result.error.issues.some((i) => i.message === 'must be HH:MM with valid hour (0-23) and minute (0-59)'),
      ).toBe(true)
    }
  })
})
