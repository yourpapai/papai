// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { checkConfidence, confidenceField } from '../../src/tools/confirmation-gate.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('Confirmation Gate', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('checkConfidence', () => {
    test('returns null when confidence equals threshold (0.85)', () => {
      const result = checkConfidence(0.85, 'Delete task')
      expect(result).toBeNull()
    })

    test('returns null when confidence is above threshold', () => {
      expect(checkConfidence(1.0, 'Delete task')).toBeNull()
      expect(checkConfidence(0.9, 'Delete task')).toBeNull()
    })

    test('returns confirmation_required when confidence is below threshold', () => {
      const result = checkConfidence(0.84, 'Delete task')
      expect(result).not.toBeNull()
      expect(result?.status).toBe('confirmation_required')
    })

    test('confirmation message includes the action description', () => {
      const result = checkConfidence(0.5, 'Archive "Auth" project')
      expect(result?.message).toContain('Archive "Auth" project')
    })

    test('returns confirmation_required when confidence is zero', () => {
      const result = checkConfidence(0, 'x')
      expect(result?.status).toBe('confirmation_required')
    })
  })

  describe('confidenceField', () => {
    test('accepts valid confidence values between 0 and 1', () => {
      expect(confidenceField.safeParse(0.9).success).toBe(true)
      expect(confidenceField.safeParse(0).success).toBe(true)
      expect(confidenceField.safeParse(1).success).toBe(true)
      expect(confidenceField.safeParse(0.5).success).toBe(true)
    })

    test('rejects values outside 0 to 1 range', () => {
      expect(confidenceField.safeParse(1.5).success).toBe(false)
      expect(confidenceField.safeParse(-0.1).success).toBe(false)
    })
  })
})
