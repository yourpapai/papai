// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config-editor validation
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { validateConfigValue } from '../../src/config-editor/validation.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('config-editor validation', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('validateConfigValue', () => {
    test('validates kaneo_apikey - required and non-empty', () => {
      const result = validateConfigValue('kaneo_apikey', '')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('cannot be empty')

      const result2 = validateConfigValue('kaneo_apikey', 'valid-key')
      expect(result2.valid).toBe(true)
    })

    test('validates youtrack_token - required and non-empty', () => {
      const result = validateConfigValue('youtrack_token', '')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('cannot be empty')

      const result2 = validateConfigValue('youtrack_token', 'valid-token')
      expect(result2.valid).toBe(true)
    })

    test('validates timezone - must be valid IANA or UTC offset', () => {
      const result = validateConfigValue('timezone', 'invalid')
      expect(result.valid).toBe(false)
      expect(result.error).toBe(
        'Invalid timezone. Enter a valid IANA timezone like America/New_York or UTC. UTC offsets like UTC+5 are also accepted and will be saved as a standard timezone.',
      )

      const result2 = validateConfigValue('timezone', 'America/New_York')
      expect(result2.valid).toBe(true)

      const result3 = validateConfigValue('timezone', 'UTC')
      expect(result3.valid).toBe(true)

      const result4 = validateConfigValue('timezone', 'UTC+5')
      expect(result4.valid).toBe(true)

      const result5 = validateConfigValue('timezone', 'Europe/London')
      expect(result5.valid).toBe(true)
    })
  })
})
