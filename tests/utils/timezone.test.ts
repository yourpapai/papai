// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { normalizeTimezone } from '../../src/utils/timezone.js'

describe('normalizeTimezone', () => {
  describe('UTC offset format (UTC+N)', () => {
    test('UTC+5 normalizes to Etc/GMT-5', () => {
      expect(normalizeTimezone('UTC+5')).toBe('Etc/GMT-5')
    })

    test('UTC+1 normalizes to Etc/GMT-1', () => {
      expect(normalizeTimezone('UTC+1')).toBe('Etc/GMT-1')
    })

    test('UTC+12 normalizes to Etc/GMT-12', () => {
      expect(normalizeTimezone('UTC+12')).toBe('Etc/GMT-12')
    })

    test('UTC-5 normalizes to Etc/GMT+5', () => {
      expect(normalizeTimezone('UTC-5')).toBe('Etc/GMT+5')
    })

    test('UTC-12 normalizes to Etc/GMT+12', () => {
      expect(normalizeTimezone('UTC-12')).toBe('Etc/GMT+12')
    })

    test('UTC+0 normalizes to UTC', () => {
      expect(normalizeTimezone('UTC+0')).toBe('UTC')
    })

    test('UTC-0 normalizes to UTC', () => {
      expect(normalizeTimezone('UTC-0')).toBe('UTC')
    })

    test('out-of-range offset returns null', () => {
      expect(normalizeTimezone('UTC+15')).toBeNull()
    })
  })

  describe('valid IANA timezone strings', () => {
    test('UTC passes through', () => {
      expect(normalizeTimezone('UTC')).toBe('UTC')
    })

    test('Asia/Karachi passes through', () => {
      expect(normalizeTimezone('Asia/Karachi')).toBe('Asia/Karachi')
    })

    test('Europe/London passes through', () => {
      expect(normalizeTimezone('Europe/London')).toBe('Europe/London')
    })

    test('America/New_York passes through', () => {
      expect(normalizeTimezone('America/New_York')).toBe('America/New_York')
    })

    test('Etc/GMT-5 passes through', () => {
      expect(normalizeTimezone('Etc/GMT-5')).toBe('Etc/GMT-5')
    })
  })

  describe('invalid timezone strings', () => {
    test('invalid IANA name returns null', () => {
      expect(normalizeTimezone('BadZone/Invalid')).toBeNull()
    })

    test('empty string returns null', () => {
      expect(normalizeTimezone('')).toBeNull()
    })

    test('UTC+5:30 (half-hour, not representable in Etc/GMT) returns null', () => {
      expect(normalizeTimezone('UTC+5:30')).toBeNull()
    })

    test('random string returns null', () => {
      expect(normalizeTimezone('not-a-timezone')).toBeNull()
    })
  })
})
