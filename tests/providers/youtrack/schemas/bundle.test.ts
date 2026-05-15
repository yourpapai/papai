// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/bundle.test.ts
import { describe, expect, test } from 'bun:test'

import {
  ProjectCustomFieldSchema,
  StateBundleSchema,
  StateValueSchema,
} from '../../../../src/providers/youtrack/schemas/bundle.js'

describe('YouTrack bundle schemas', () => {
  describe('StateValueSchema', () => {
    test('validates required fields', () => {
      const valid = { id: '123', name: 'Open' }
      expect(() => StateValueSchema.parse(valid)).not.toThrow()
    })

    test('missing id rejects', () => {
      expect(() => StateValueSchema.parse({ name: 'Open' })).toThrow()
    })

    test('missing name rejects', () => {
      expect(() => StateValueSchema.parse({ id: '123' })).toThrow()
    })

    test('ordinal optional accepts', () => {
      const result = StateValueSchema.parse({ id: '123', name: 'Open', ordinal: 1 })
      expect(result.ordinal).toBe(1)
    })

    test('isResolved optional accepts', () => {
      const result = StateValueSchema.parse({ id: '123', name: 'Done', isResolved: true })
      expect(result.isResolved).toBe(true)
    })

    test('all fields accepts', () => {
      const result = StateValueSchema.parse({
        id: '123',
        name: 'Done',
        ordinal: 5,
        isResolved: true,
      })
      expect(result.id).toBe('123')
      expect(result.name).toBe('Done')
      expect(result.ordinal).toBe(5)
      expect(result.isResolved).toBe(true)
    })
  })

  describe('StateBundleSchema', () => {
    test('validates required id', () => {
      const valid = { id: 'bundle-1' }
      expect(() => StateBundleSchema.parse(valid)).not.toThrow()
    })

    test('missing id rejects', () => {
      expect(() => StateBundleSchema.parse({})).toThrow()
    })

    test('name optional accepts', () => {
      const result = StateBundleSchema.parse({ id: 'bundle-1', name: 'States' })
      expect(result.name).toBe('States')
    })

    test('aggregated optional accepts', () => {
      const result = StateBundleSchema.parse({
        id: 'bundle-1',
        aggregated: { project: [{ id: 'proj-1' }] },
      })
      expect(result.aggregated?.project).toEqual([{ id: 'proj-1' }])
    })

    test('aggregated.project optional accepts', () => {
      const result = StateBundleSchema.parse({
        id: 'bundle-1',
        aggregated: {},
      })
      expect(result.aggregated?.project).toBeUndefined()
    })

    test('empty aggregated.project array accepts', () => {
      const result = StateBundleSchema.parse({
        id: 'bundle-1',
        aggregated: { project: [] },
      })
      expect(result.aggregated?.project).toEqual([])
    })
  })

  describe('ProjectCustomFieldSchema', () => {
    test('validates required $type', () => {
      const valid = { $type: 'StateProjectCustomField' }
      expect(() => ProjectCustomFieldSchema.parse(valid)).not.toThrow()
    })

    test('missing $type rejects', () => {
      expect(() => ProjectCustomFieldSchema.parse({})).toThrow()
    })

    test('field optional accepts', () => {
      const result = ProjectCustomFieldSchema.parse({
        $type: 'StateProjectCustomField',
        field: { name: 'State' },
      })
      expect(result.field?.name).toBe('State')
    })

    test('field.localizedName optional accepts', () => {
      const result = ProjectCustomFieldSchema.parse({
        $type: 'StateProjectCustomField',
        field: { name: 'State', localizedName: 'Status' },
      })
      expect(result.field?.localizedName).toBe('Status')
    })

    test('bundle optional accepts', () => {
      const result = ProjectCustomFieldSchema.parse({
        $type: 'StateProjectCustomField',
        bundle: { id: 'bundle-1' },
      })
      expect(result.bundle?.id).toBe('bundle-1')
    })

    test('bundle.$type optional accepts', () => {
      const result = ProjectCustomFieldSchema.parse({
        $type: 'StateProjectCustomField',
        bundle: { id: 'bundle-1', $type: 'StateBundle' },
      })
      expect(result.bundle?.$type).toBe('StateBundle')
    })

    test('all fields accepts', () => {
      const result = ProjectCustomFieldSchema.parse({
        $type: 'StateProjectCustomField',
        field: { name: 'State', localizedName: 'Status' },
        bundle: { id: 'bundle-1', $type: 'StateBundle' },
      })
      expect(result.$type).toBe('StateProjectCustomField')
      expect(result.field?.name).toBe('State')
      expect(result.bundle?.id).toBe('bundle-1')
    })
  })
})
