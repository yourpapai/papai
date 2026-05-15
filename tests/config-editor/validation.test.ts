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
    test('validates llm_apikey - required and non-empty', () => {
      const result = validateConfigValue('llm_apikey', '')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('cannot be empty')

      const result2 = validateConfigValue('llm_apikey', '   ')
      expect(result2.valid).toBe(false)

      const result3 = validateConfigValue('llm_apikey', 'sk-valid')
      expect(result3.valid).toBe(true)
    })

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

    test('validates llm_baseurl - must be valid URL with http/https', () => {
      const result = validateConfigValue('llm_baseurl', 'not-a-url')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('valid URL')

      const result2 = validateConfigValue('llm_baseurl', 'ftp://example.com')
      expect(result2.valid).toBe(false)

      const result3 = validateConfigValue('llm_baseurl', 'https://api.openai.com/v1')
      expect(result3.valid).toBe(true)

      const result4 = validateConfigValue('llm_baseurl', 'http://localhost:3000')
      expect(result4.valid).toBe(true)
    })

    test('validates model fields - required and non-empty', () => {
      const result = validateConfigValue('main_model', '')
      expect(result.valid).toBe(false)

      const result2 = validateConfigValue('main_model', 'gpt-4')
      expect(result2.valid).toBe(true)

      const result3 = validateConfigValue('small_model', 'claude-3-haiku')
      expect(result3.valid).toBe(true)

      const result4 = validateConfigValue('embedding_model', 'text-embedding-3-small')
      expect(result4.valid).toBe(true)
    })

    test('validates timezone - must be valid IANA or UTC offset', () => {
      const result = validateConfigValue('timezone', 'invalid')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid timezone')

      const result2 = validateConfigValue('timezone', 'America/New_York')
      expect(result2.valid).toBe(true)

      const result3 = validateConfigValue('timezone', 'UTC')
      expect(result3.valid).toBe(true)

      const result4 = validateConfigValue('timezone', 'UTC+5')
      expect(result4.valid).toBe(true)

      const result5 = validateConfigValue('timezone', 'Europe/London')
      expect(result5.valid).toBe(true)
    })

    test('returns valid for timezone key (covers default case)', () => {
      // timezone is the last case in the switch statement (default case coverage)
      const result = validateConfigValue('timezone', 'America/New_York')
      expect(result.valid).toBe(true)
    })
  })
})
