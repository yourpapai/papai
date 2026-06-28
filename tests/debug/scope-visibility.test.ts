// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { init, isScopeVisibleToCurrentAdmin } from '../../src/debug/state-collector.js'

describe('isScopeVisibleToCurrentAdmin', () => {
  test("returns true for the current admin's own user scope, false for others", () => {
    init('admin-a')

    expect(isScopeVisibleToCurrentAdmin({ kind: 'user', userId: 'admin-a' })).toBe(true)
    expect(isScopeVisibleToCurrentAdmin({ kind: 'user', userId: 'someone-else' })).toBe(false)
  })

  test('returns true for global scope and false for any group scope (group visibility disabled)', () => {
    init('admin-a')

    expect(isScopeVisibleToCurrentAdmin({ kind: 'global' })).toBe(true)
    expect(isScopeVisibleToCurrentAdmin({ kind: 'group', groupId: 'g1' })).toBe(false)
  })

  test('returns false for null/undefined or a malformed scope', () => {
    init('admin-a')

    expect(isScopeVisibleToCurrentAdmin(null)).toBe(false)
    expect(isScopeVisibleToCurrentAdmin(undefined)).toBe(false)
  })
})
