// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { YOUTRACK_DUE_DATE_FIELD_NAME } from '../../../plugins/task-provider-youtrack/constants.js'
import { mapReadOnlyCustomFields } from '../../../plugins/task-provider-youtrack/custom-field-values.js'

describe('mapReadOnlyCustomFields filter and shape', () => {
  test('returns undefined for undefined input', () => {
    expect(mapReadOnlyCustomFields(undefined)).toBeUndefined()
  })

  test('returns undefined for an empty array', () => {
    expect(mapReadOnlyCustomFields([])).toBeUndefined()
  })

  test('returns undefined when every field is excluded', () => {
    expect(mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'State', value: 'Open' }])).toBeUndefined()
  })

  test('drops State, Priority, Assignee and the due-date field, keeps generic fields', () => {
    const result = mapReadOnlyCustomFields([
      { $type: 'SimpleIssueCustomField', name: 'State', value: 'Open' },
      { $type: 'SimpleIssueCustomField', name: 'Priority', value: 'High' },
      { $type: 'SimpleIssueCustomField', name: 'Assignee', value: 'admin' },
      { $type: 'SimpleIssueCustomField', name: YOUTRACK_DUE_DATE_FIELD_NAME, value: '2026-08-10' },
      { $type: 'SimpleIssueCustomField', name: 'Team', value: 'Core' },
    ])
    expect(result).toEqual([{ name: 'Team', value: 'Core' }])
  })

  test('preserves input order and exact { name, value } shape for generic fields', () => {
    const result = mapReadOnlyCustomFields([
      { $type: 'SimpleIssueCustomField', name: 'Team B', value: 'Beta' },
      { $type: 'SimpleIssueCustomField', name: 'Team A', value: 'Alpha' },
    ])
    expect(result).toEqual([
      { name: 'Team B', value: 'Beta' },
      { name: 'Team A', value: 'Alpha' },
    ])
  })
})

describe('mapReadOnlyCustomFields primitive and null values', () => {
  test('maps null value to null', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: null }])
    expect(result).toEqual([{ name: 'Team', value: null }])
  })

  test('maps a missing value to null', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'Team' }])
    expect(result).toEqual([{ name: 'Team', value: null }])
  })

  test('passes string values through', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'Team', value: 'abc' }])
    expect(result).toEqual([{ name: 'Team', value: 'abc' }])
  })

  test('passes number values through without stringifying', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'Team', value: 5 }])
    expect(result).toEqual([{ name: 'Team', value: 5 }])
  })

  test('passes boolean values through without stringifying', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'SimpleIssueCustomField', name: 'Team', value: false }])
    expect(result).toEqual([{ name: 'Team', value: false }])
  })
})

describe('mapReadOnlyCustomFields object fallback ladder', () => {
  test('prefers text over name and login', () => {
    const result = mapReadOnlyCustomFields([
      { $type: 'Custom', name: 'Team', value: { text: 'T', name: 'N', login: 'L' } },
    ])
    expect(result).toEqual([{ name: 'Team', value: 'T' }])
  })

  test('prefers name over login when text is absent', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: { name: 'N', login: 'L' } }])
    expect(result).toEqual([{ name: 'Team', value: 'N' }])
  })

  test('uses login when text and name are absent', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: { login: 'L' } }])
    expect(result).toEqual([{ name: 'Team', value: 'L' }])
  })

  test('ignores non-string properties and falls through to stringify', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: { name: 42 } }])
    expect(result).toEqual([{ name: 'Team', value: '{"name":42}' }])
  })
})

describe('mapReadOnlyCustomFields array values', () => {
  test('passes string arrays through', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: ['a', 'b'] }])
    expect(result).toEqual([{ name: 'Team', value: ['a', 'b'] }])
  })

  test('maps object items, keeps strings, drops null and non-string entries', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: [{ name: 'A' }, 'b', null, 42] }])
    expect(result).toEqual([{ name: 'Team', value: ['A', 'b'] }])
  })

  test('falls back to login for array items without a name', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: [{ login: 'L' }] }])
    expect(result).toEqual([{ name: 'Team', value: ['L'] }])
  })
})

describe('mapReadOnlyCustomFields stringify tail', () => {
  test('stringifies plain objects without text, name or login', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: { foo: 'bar' } }])
    expect(result).toEqual([{ name: 'Team', value: '{"foo":"bar"}' }])
  })

  test('maps unstringifiable function values to the complex-value placeholder', () => {
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: (): undefined => undefined }])
    expect(result).toEqual([{ name: 'Team', value: '[complex value]' }])
  })

  test('maps circular structures to the complex-value placeholder', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    const result = mapReadOnlyCustomFields([{ $type: 'Custom', name: 'Team', value: circular }])
    expect(result).toEqual([{ name: 'Team', value: '[complex value]' }])
  })
})
