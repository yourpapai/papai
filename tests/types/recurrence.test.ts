// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { recurrenceSpecSchema } from '../../src/types/recurrence.js'

describe('recurrenceSpecSchema', () => {
  it('accepts a valid WEEKLY spec', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'WEEKLY',
      byDay: ['MO', 'WE'],
      byHour: [9],
      byMinute: [0],
      dtstart: '2026-04-21T09:00:00Z',
      timezone: 'Europe/London',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty byDay array', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'WEEKLY',
      byDay: [],
      dtstart: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty byHour array', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      byHour: [],
      dtstart: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty byMinute array', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      byMinute: [],
      dtstart: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects when until and count are both set', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      until: '2026-12-31T23:59:59Z',
      count: 5,
      dtstart: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })
})
