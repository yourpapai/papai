// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatEventTime } from '../../../client/transcript/format-ts.js'

describe('formatEventTime', () => {
  // Inputs are built from LOCAL date parts and asserted against those same local parts, so
  // these assertions hold in any timezone. Never hardcode a UTC literal here.
  test('renders a parseable timestamp as 24-hour HH:MM:SS', () => {
    const at = new Date(2026, 7, 6, 14, 23, 5)
    expect(formatEventTime(at.toISOString())).toBe('14:23:05')
  })

  test('zero-pads single-digit hours, minutes, and seconds', () => {
    const at = new Date(2026, 7, 6, 4, 3, 9)
    expect(formatEventTime(at.toISOString())).toBe('04:03:09')
  })

  test('renders midnight as 00:00:00 rather than blank', () => {
    const at = new Date(2026, 7, 6, 0, 0, 0)
    expect(formatEventTime(at.toISOString())).toBe('00:00:00')
  })

  test('always renders exactly eight characters', () => {
    const at = new Date(2026, 11, 31, 23, 59, 59)
    expect(formatEventTime(at.toISOString())).toHaveLength(8)
  })

  test('returns an empty string for an unparseable value', () => {
    expect(formatEventTime('t')).toBe('')
  })

  test('returns an empty string for an empty input', () => {
    expect(formatEventTime('')).toBe('')
  })

  test('never returns the literal text Invalid Date', () => {
    expect(formatEventTime('not-a-timestamp')).not.toContain('Invalid')
  })
})
