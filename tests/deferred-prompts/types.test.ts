// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  deliveryPolicySchema,
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
