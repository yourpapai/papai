// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/common.test.ts
import { describe, expect, test } from 'bun:test'

import { BaseEntitySchema, TimestampSchema } from '../../../../src/providers/youtrack/schemas/common.js'

describe('YouTrack common schemas', () => {
  describe('BaseEntitySchema', () => {
    test('validates required fields', () => {
      const valid = { id: '123', $type: 'Issue' }
      expect(() => BaseEntitySchema.parse(valid)).not.toThrow()
    })

    test('missing id rejects', () => {
      expect(() => BaseEntitySchema.parse({ $type: 'Issue' })).toThrow()
    })

    test('id as number rejects', () => {
      expect(() => BaseEntitySchema.parse({ id: 123, $type: 'Issue' })).toThrow()
    })

    test('$type omitted accepts (optional)', () => {
      const result = BaseEntitySchema.parse({ id: '123' })
      expect(result.$type).toBeUndefined()
    })

    test('empty string id accepts (no .min(1))', () => {
      const result = BaseEntitySchema.parse({ id: '' })
      expect(result.id).toBe('')
    })

    test('extra unknown fields stripped by Zod default', () => {
      const result = BaseEntitySchema.parse({ id: '1', $type: 'X', extra: true })
      expect(result).toEqual({ id: '1', $type: 'X' })
      expect('extra' in result).toBe(false)
    })

    test('null for id rejects', () => {
      expect(() => BaseEntitySchema.parse({ id: null })).toThrow()
    })

    test('empty object rejects', () => {
      expect(() => BaseEntitySchema.parse({})).toThrow()
    })
  })

  describe('TimestampSchema', () => {
    test('accepts valid positive integer', () => {
      expect(TimestampSchema.parse(1700000000000)).toBe(1700000000000)
    })

    test('string rejects', () => {
      expect(() => TimestampSchema.parse('not a number')).toThrow()
    })

    test('float rejects (.int())', () => {
      expect(() => TimestampSchema.parse(1700000000000.5)).toThrow()
    })

    test('zero accepts (epoch)', () => {
      expect(TimestampSchema.parse(0)).toBe(0)
    })

    test('negative rejects (.min(0))', () => {
      expect(() => TimestampSchema.parse(-1)).toThrow()
    })

    test('null rejects', () => {
      expect(() => TimestampSchema.parse(null)).toThrow()
    })

    test('ISO string rejects', () => {
      expect(() => TimestampSchema.parse('2024-01-01T00:00:00Z')).toThrow()
    })
  })
})
