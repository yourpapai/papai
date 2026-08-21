// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { isVisibleToAdmin, type AdminVisibility } from '../../src/debug/state-collector.js'

describe('isVisibleToAdmin', () => {
  test("returns true for the admin's own user scope, false for others", () => {
    const vis: AdminVisibility = { adminUserId: 'admin-a', groupIds: new Set() }

    expect(isVisibleToAdmin({ kind: 'user', userId: 'admin-a' }, vis)).toBe(true)
    expect(isVisibleToAdmin({ kind: 'user', userId: 'someone-else' }, vis)).toBe(false)
  })

  test('returns true for global scope and false for any group scope outside the set', () => {
    const vis: AdminVisibility = { adminUserId: 'admin-a', groupIds: new Set() }

    expect(isVisibleToAdmin({ kind: 'global' }, vis)).toBe(true)
    expect(isVisibleToAdmin({ kind: 'group', groupId: 'g1' }, vis)).toBe(false)
  })

  test('returns false for null/undefined or a malformed scope', () => {
    const vis: AdminVisibility = { adminUserId: 'admin-a', groupIds: new Set() }

    expect(isVisibleToAdmin(null, vis)).toBe(false)
    expect(isVisibleToAdmin(undefined, vis)).toBe(false)
  })
})
