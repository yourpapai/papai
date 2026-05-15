// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { localDatetimeToUtc, midnightUtcForTimezone, utcToLocal } from '../../src/utils/datetime.js'

describe('localDatetimeToUtc', () => {
  test('converts date+time in UTC (no offset)', () => {
    expect(localDatetimeToUtc('2026-03-25', '09:00', 'UTC')).toBe('2026-03-25T09:00:00.000Z')
  })

  test('converts date+time for east-of-UTC timezone (UTC+5)', () => {
    // Asia/Karachi is UTC+5, no DST
    // 17:00 local = 12:00 UTC
    expect(localDatetimeToUtc('2026-03-25', '17:00', 'Asia/Karachi')).toBe('2026-03-25T12:00:00.000Z')
  })

  test('converts date-only to local midnight', () => {
    // midnight Karachi (UTC+5) = 19:00 UTC previous day
    expect(localDatetimeToUtc('2026-03-25', undefined, 'Asia/Karachi')).toBe('2026-03-24T19:00:00.000Z')
  })

  test('converts date+time for west-of-UTC timezone (UTC-5)', () => {
    // America/New_York in winter is UTC-5
    // 09:00 NY = 14:00 UTC
    expect(localDatetimeToUtc('2026-01-15', '09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z')
  })

  test('converts date+time for UTC-8 (America/Los_Angeles in standard time)', () => {
    // 2026-01-10 is winter; LA = UTC-8
    expect(localDatetimeToUtc('2026-01-10', '10:00', 'America/Los_Angeles')).toBe('2026-01-10T18:00:00.000Z')
  })

  test('falls back to treating time as UTC when timezone is invalid', () => {
    expect(localDatetimeToUtc('2026-03-25', '09:00', 'Not/ATimezone')).toBe('2026-03-25T09:00:00.000Z')
  })

  test('falls back to treating time as UTC when timezone is empty string', () => {
    expect(localDatetimeToUtc('2026-03-25', '09:00', '')).toBe('2026-03-25T09:00:00.000Z')
  })

  test('applies correct standard-time offset (UTC-5) just before spring-forward', () => {
    // 2026-03-08 01:59 EST = UTC-5 → 06:59 UTC
    expect(localDatetimeToUtc('2026-03-08', '01:59', 'America/New_York')).toBe('2026-03-08T06:59:00.000Z')
  })

  test('applies correct daylight-time offset (UTC-4) just after spring-forward', () => {
    // 2026-03-08 03:00 EDT = UTC-4 → 07:00 UTC
    // (clocks jumped from 2:00 AM to 3:00 AM so 3:00 AM is the first valid EDT time)
    expect(localDatetimeToUtc('2026-03-08', '03:00', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z')
  })

  test('applies correct daylight-time offset (UTC-4) in summer', () => {
    // America/New_York in summer is UTC-4
    // 2026-07-15 09:00 EDT = 13:00 UTC
    expect(localDatetimeToUtc('2026-07-15', '09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z')
  })
})

describe('utcToLocal', () => {
  test('converts UTC to local time in east-of-UTC timezone', () => {
    // 12:00 UTC = 17:00 Asia/Karachi (UTC+5, no DST)
    expect(utcToLocal('2026-03-25T12:00:00.000Z', 'Asia/Karachi')).toBe('2026-03-25T17:00:00')
  })

  test('converts UTC to local time in west-of-UTC timezone', () => {
    // 14:00 UTC = 09:00 America/New_York in winter (UTC-5)
    expect(utcToLocal('2026-01-15T14:00:00.000Z', 'America/New_York')).toBe('2026-01-15T09:00:00')
  })

  test('returns null for null input', () => {
    expect(utcToLocal(null, 'Asia/Karachi')).toBeNull()
  })

  test('returns undefined for undefined input', () => {
    expect(utcToLocal(undefined, 'Asia/Karachi')).toBeUndefined()
  })

  test('falls back to original string on unparseable input', () => {
    expect(utcToLocal('not-a-date', 'Asia/Karachi')).toBe('not-a-date')
  })
})

describe('midnightUtcForTimezone', () => {
  test('UTC timezone returns midnight UTC on the same calendar day', () => {
    const now = new Date('2026-04-21T15:30:00Z')
    expect(midnightUtcForTimezone('UTC', now)).toBe('2026-04-21T00:00:00.000Z')
  })

  test('east-of-UTC timezone (Asia/Karachi, UTC+5) returns correct midnight UTC', () => {
    // 2026-04-21T00:30Z = 05:30 Karachi → today in Karachi is Apr 21
    // midnight Karachi = Apr 21 00:00 local = Apr 20 19:00 UTC
    const now = new Date('2026-04-21T00:30:00Z')
    expect(midnightUtcForTimezone('Asia/Karachi', now)).toBe('2026-04-20T19:00:00.000Z')
  })

  test('west-of-UTC timezone (America/New_York, UTC-5 in winter) returns correct midnight UTC', () => {
    // 2026-01-15T10:00Z = 05:00 EST → today in NY is Jan 15
    // midnight NY = Jan 15 00:00 EST = Jan 15 05:00 UTC
    const now = new Date('2026-01-15T10:00:00Z')
    expect(midnightUtcForTimezone('America/New_York', now)).toBe('2026-01-15T05:00:00.000Z')
  })

  test('falls back to UTC midnight for invalid timezone', () => {
    const now = new Date('2026-04-21T15:30:00Z')
    expect(midnightUtcForTimezone('Not/ATimezone', now)).toBe('2026-04-21T00:00:00.000Z')
  })
})
