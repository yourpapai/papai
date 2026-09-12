// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { youtrackCustomFieldGroups } from './youtrack-custom-field-groups.js'

describe('youtrack custom-field groups', () => {
  test('exposes status and priority groups with unique ids and titles', () => {
    const ids = youtrackCustomFieldGroups.map((group) => group.id)
    expect(ids).toContain('SCN-youtrack-custom-field-status')
    expect(ids).toContain('SCN-youtrack-custom-field-priority')
    expect(new Set(ids).size).toBe(ids.length)
    for (const group of youtrackCustomFieldGroups) {
      expect(group.title.length).toBeGreaterThan(0)
      expect(typeof group.run).toBe('function')
    }
  })
})
