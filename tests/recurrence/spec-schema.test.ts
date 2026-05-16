// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, it, expect } from 'bun:test'

import { recurrenceSpecSchema } from '../../src/types/recurrence.js'

describe('recurrenceSpecSchema', () => {
  it('accepts a minimal weekly spec', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'WEEKLY',
      byDay: ['MO', 'WE', 'FR'],
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'Europe/London',
    })
    expect(result.success).toBe(true)
  })

  it('rejects conflicting until and count', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      until: '2026-12-31T00:00:00Z',
      count: 10,
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid byDay values', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'WEEKLY',
      byDay: ['FUNDAY'],
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid timezone', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'Not/A_Zone',
    })
    expect(result.success).toBe(false)
  })

  it('rejects interval < 1', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      interval: 0,
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })
})
