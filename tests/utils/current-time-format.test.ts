// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatCurrentTimeTag } from '../../src/utils/current-time-format.js'

describe('formatCurrentTimeTag', () => {
  // 2026-05-25T12:00:00Z is a Monday.
  const instant = new Date('2026-05-25T12:00:00Z')

  test('formats date, 24h time and weekday in UTC', () => {
    expect(formatCurrentTimeTag(instant, 'UTC')).toBe('<current_time>2026-05-25 12:00 (Monday)</current_time>')
  })

  test('honors the supplied timezone offset', () => {
    // Asia/Karachi is UTC+5 (no DST): 12:00Z -> 17:00 local.
    expect(formatCurrentTimeTag(instant, 'Asia/Karachi')).toBe('<current_time>2026-05-25 17:00 (Monday)</current_time>')
  })

  test('falls back to UTC-based formatting on an invalid timezone', () => {
    const out = formatCurrentTimeTag(instant, 'Not/AZone')
    expect(out).toBe('<current_time>2026-05-25 12:00 (UTC)</current_time>')
  })

  test('always wraps output in a single current_time tag', () => {
    const out = formatCurrentTimeTag(instant, 'UTC')
    expect(out.startsWith('<current_time>')).toBe(true)
    expect(out.endsWith('</current_time>')).toBe(true)
    expect(out.split('<current_time>').length).toBe(2)
  })

  test('renders midnight as 00:00', () => {
    const midnight = new Date('2026-05-25T00:00:00Z')
    expect(formatCurrentTimeTag(midnight, 'UTC')).toBe('<current_time>2026-05-25 00:00 (Monday)</current_time>')
  })
})
