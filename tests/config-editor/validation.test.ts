// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config-editor validation
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { validateConfigField } from '../../src/config-editor/validation.js'
import type { ConfigField } from '../../src/types/config.js'
import { mockLogger } from '../utils/test-helpers.js'

const field = (storageKey: string, overrides?: Partial<ConfigField>): ConfigField => ({
  key: storageKey,
  storageKey,
  label: overrides?.label ?? storageKey,
  required: overrides?.required ?? true,
  sensitive: overrides?.sensitive ?? false,
  kind: overrides?.kind ?? 'provider-context',
  ...overrides,
})

describe('config-editor validation', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('validateConfigField', () => {
    test('validates kaneo_apikey - required and non-empty', () => {
      const result = validateConfigField(field('kaneo_apikey'), '')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('cannot be empty')

      const result2 = validateConfigField(field('kaneo_apikey'), 'valid-key')
      expect(result2.valid).toBe(true)
    })

    test('validates youtrack_token - required and non-empty', () => {
      const result = validateConfigField(field('youtrack_token'), '')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('cannot be empty')

      const result2 = validateConfigField(field('youtrack_token'), 'valid-token')
      expect(result2.valid).toBe(true)
    })

    test('validates enum fields against their options', () => {
      const enumField = field('ai_output_detail_level', {
        kind: 'ai-output',
        required: false,
        control: 'select',
        options: [
          { value: 'sanitized', label: 'Sanitized' },
          { value: 'raw', label: 'Raw' },
        ],
      })

      expect(validateConfigField(enumField, 'raw').valid).toBe(true)
      expect(validateConfigField(enumField, 'sanitized').valid).toBe(true)

      const bad = validateConfigField(enumField, 'verbose')
      expect(bad.valid).toBe(false)
      expect(bad.error).toContain('must be one of')
    })

    test('validates timezone - must be valid IANA or UTC offset', () => {
      const result = validateConfigField(field('timezone'), 'invalid')
      expect(result.valid).toBe(false)
      expect(result.error).toBe(
        'Invalid timezone. Enter a valid IANA timezone like America/New_York or UTC. UTC offsets like UTC+5 are also accepted and will be saved as a standard timezone.',
      )

      const result2 = validateConfigField(field('timezone'), 'America/New_York')
      expect(result2.valid).toBe(true)

      const result3 = validateConfigField(field('timezone'), 'UTC')
      expect(result3.valid).toBe(true)

      const result4 = validateConfigField(field('timezone'), 'UTC+5')
      expect(result4.valid).toBe(true)

      const result5 = validateConfigField(field('timezone'), 'Europe/London')
      expect(result5.valid).toBe(true)
    })
  })
})
