// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setConfig } from '../../src/config.js'
import { getUserTimezoneOrDefault, getUserTimezoneOrError } from '../../src/utils/config-timezone.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('config-timezone', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('getUserTimezoneOrDefault', () => {
    test('returns fallback UTC when no timezone is configured', () => {
      expect(getUserTimezoneOrDefault('user-no-tz')).toBe('UTC')
    })

    test('returns configured valid timezone', () => {
      setConfig('user-valid-tz', 'timezone', 'America/New_York')
      expect(getUserTimezoneOrDefault('user-valid-tz')).toBe('America/New_York')
    })

    test('returns custom fallback when no timezone is configured', () => {
      expect(getUserTimezoneOrDefault('user-no-tz-2', 'Europe/London')).toBe('Europe/London')
    })
  })

  describe('getUserTimezoneOrError', () => {
    test('returns UTC when no timezone is configured', () => {
      expect(getUserTimezoneOrError('user-no-tz-3')).toBe('UTC')
    })

    test('returns configured valid timezone', () => {
      setConfig('user-valid-tz-2', 'timezone', 'Asia/Tokyo')
      expect(getUserTimezoneOrError('user-valid-tz-2')).toBe('Asia/Tokyo')
    })

    test('returns error object for invalid timezone', () => {
      setConfig('user-bad-tz', 'timezone', 'Not/A/Real/Timezone')
      const result = getUserTimezoneOrError('user-bad-tz')
      expect(typeof result).toBe('object')
    })

    test('error message for invalid timezone references /config', () => {
      setConfig('user-bad-tz-2', 'timezone', 'Not/A/Real/Timezone')
      const result = getUserTimezoneOrError('user-bad-tz-2')
      expect(JSON.stringify(result)).toContain('/config')
    })

    test('error message for invalid timezone does not reference /setup', () => {
      setConfig('user-bad-tz-3', 'timezone', 'Not/A/Real/Timezone')
      const result = getUserTimezoneOrError('user-bad-tz-3')
      expect(JSON.stringify(result)).not.toContain('/setup')
    })
  })
})
