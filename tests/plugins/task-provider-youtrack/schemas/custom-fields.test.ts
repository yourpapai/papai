// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/custom-fields.test.ts
import { describe, expect, test } from 'bun:test'

import { CustomFieldValueSchema } from '../../../../plugins/task-provider-youtrack/schemas/custom-fields.js'

describe('CustomFieldValueSchema', () => {
  describe('SingleEnumIssueCustomField', () => {
    test('happy path', () => {
      const input = {
        $type: 'SingleEnumIssueCustomField',
        name: 'Priority',
        value: { $type: 'EnumBundleElement', name: 'High' },
      }
      const result = CustomFieldValueSchema.parse(input)
      expect(result.name).toBe('Priority')
    })

    test('missing name rejects', () => {
      expect(() =>
        CustomFieldValueSchema.parse({
          $type: 'SingleEnumIssueCustomField',
          value: { $type: 'EnumBundleElement', name: 'High' },
        }),
      ).toThrow()
    })

    test('value missing $type literal falls through to fallback', () => {
      // Without the EnumBundleElement $type literal, this matches UnknownIssueCustomFieldSchema
      const result = CustomFieldValueSchema.parse({
        $type: 'SingleEnumIssueCustomField',
        name: 'Priority',
        value: { name: 'High' },
      })
      expect(result.$type).toBe('SingleEnumIssueCustomField')
    })

    test('value with ordinal accepts', () => {
      const input = {
        $type: 'SingleEnumIssueCustomField',
        name: 'Priority',
        value: { $type: 'EnumBundleElement', name: 'High', ordinal: 1 },
      }
      const result = CustomFieldValueSchema.parse(input)
      expect(result).toBeDefined()
    })
  })

  describe('MultiEnumIssueCustomField', () => {
    test('happy path (2 elements)', () => {
      const input = {
        $type: 'MultiEnumIssueCustomField',
        name: 'Tags',
        value: [
          { $type: 'EnumBundleElement', name: 'A' },
          { $type: 'EnumBundleElement', name: 'B' },
        ],
      }
      const result = CustomFieldValueSchema.parse(input)
      expect(result.name).toBe('Tags')
    })

    test('empty array accepts', () => {
      const input = {
        $type: 'MultiEnumIssueCustomField',
        name: 'Tags',
        value: [],
      }
      expect(() => CustomFieldValueSchema.parse(input)).not.toThrow()
    })
  })

  describe('SingleUserIssueCustomField', () => {
    test('happy path', () => {
      const input = {
        $type: 'SingleUserIssueCustomField',
        name: 'Assignee',
        value: { id: '1', login: 'john' },
      }
      const result = CustomFieldValueSchema.parse(input)
      expect(result.name).toBe('Assignee')
    })

    test('value omitted accepts (optional)', () => {
      const input = {
        $type: 'SingleUserIssueCustomField',
        name: 'Assignee',
      }
      expect(() => CustomFieldValueSchema.parse(input)).not.toThrow()
    })
  })

  describe('MultiUserIssueCustomField', () => {
    test('happy path', () => {
      const input = {
        $type: 'MultiUserIssueCustomField',
        name: 'Watchers',
        value: [
          { id: '1', login: 'john' },
          { id: '2', login: 'jane' },
        ],
      }
      const result = CustomFieldValueSchema.parse(input)
      expect(result.name).toBe('Watchers')
    })

    test('value omitted accepts', () => {
      const input = {
        $type: 'MultiUserIssueCustomField',
        name: 'Watchers',
      }
      expect(() => CustomFieldValueSchema.parse(input)).not.toThrow()
    })
  })

  describe('TextIssueCustomField', () => {
    test('happy path', () => {
      const input = {
        $type: 'TextIssueCustomField',
        name: 'Notes',
        value: { $type: 'TextFieldValue', text: 'Hello' },
      }
      const result = CustomFieldValueSchema.parse(input)
      expect(result.name).toBe('Notes')
    })

    test('value missing text falls through to fallback', () => {
      // Without `text`, the TextIssueCustomField branch fails but UnknownIssueCustomFieldSchema catches it
      const result = CustomFieldValueSchema.parse({
        $type: 'TextIssueCustomField',
        name: 'Notes',
        value: { $type: 'TextFieldValue' },
      })
      expect(result.$type).toBe('TextIssueCustomField')
    })
  })

  describe('SimpleIssueCustomField', () => {
    test('with string value', () => {
      const result = CustomFieldValueSchema.parse({
        $type: 'SimpleIssueCustomField',
        name: 'Field',
        value: 'hello',
      })
      expect(result).toBeDefined()
    })

    test('with number value', () => {
      const result = CustomFieldValueSchema.parse({
        $type: 'SimpleIssueCustomField',
        name: 'Field',
        value: 42,
      })
      expect(result).toBeDefined()
    })

    test('with boolean value', () => {
      const result = CustomFieldValueSchema.parse({
        $type: 'SimpleIssueCustomField',
        name: 'Field',
        value: true,
      })
      expect(result).toBeDefined()
    })

    test('with value omitted', () => {
      expect(() =>
        CustomFieldValueSchema.parse({
          $type: 'SimpleIssueCustomField',
          name: 'Field',
        }),
      ).not.toThrow()
    })
  })

  describe('UnknownIssueCustomField (fallback)', () => {
    test('unknown $type falls through to fallback', () => {
      const input = {
        $type: 'PeriodIssueCustomField',
        name: 'Estimation',
        value: { minutes: 60 },
      }
      const result = CustomFieldValueSchema.parse(input)
      expect(result.name).toBe('Estimation')
    })
  })

  describe('edge cases', () => {
    test('missing $type entirely rejects all branches', () => {
      expect(() => CustomFieldValueSchema.parse({ name: 'X', value: 'y' })).toThrow()
    })

    test('missing name on any variant rejects', () => {
      expect(() => CustomFieldValueSchema.parse({ $type: 'SimpleIssueCustomField', value: 1 })).toThrow()
    })
  })
})
