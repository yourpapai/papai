// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  addAdmin,
  isAdmin,
  listAdminsForPlatform,
  removeAdmin,
  SUPER_ADMIN_PLATFORM_ID,
} from '../../src/instances/admin-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('admin-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('SUPER_ADMIN_PLATFORM_ID is the reserved sentinel', () => {
    expect(SUPER_ADMIN_PLATFORM_ID).toBe('__super__')
  })

  test('addAdmin + isAdmin for super-admin', () => {
    addAdmin('u1', SUPER_ADMIN_PLATFORM_ID)
    expect(isAdmin('u1', SUPER_ADMIN_PLATFORM_ID)).toBe(true)
    // super-admin is admin of all platforms
    expect(isAdmin('u1', 'tg-default')).toBe(true)
  })

  test('addAdmin + isAdmin for platform-only admin', () => {
    addAdmin('u2', 'tg-default')
    expect(isAdmin('u2', 'tg-default')).toBe(true)
    expect(isAdmin('u2', 'mm-default')).toBe(false)
    expect(isAdmin('u2', SUPER_ADMIN_PLATFORM_ID)).toBe(false)
  })

  test('non-admin returns false', () => {
    expect(isAdmin('nobody', 'tg-default')).toBe(false)
  })

  test('addAdmin is idempotent for the same (user, platform) pair', () => {
    addAdmin('u1', 'tg-default')
    expect(() => {
      addAdmin('u1', 'tg-default')
    }).not.toThrow()
    expect(isAdmin('u1', 'tg-default')).toBe(true)
  })

  test('removeAdmin removes the row', () => {
    addAdmin('u1', 'tg-default')
    removeAdmin('u1', 'tg-default')
    expect(isAdmin('u1', 'tg-default')).toBe(false)
  })

  test('listAdminsForPlatform returns scoped rows', () => {
    addAdmin('u1', 'tg-default')
    addAdmin('u2', 'tg-default')
    addAdmin('u3', 'mm-default')
    const ids = listAdminsForPlatform('tg-default')
      .map((a) => a.userId)
      .toSorted()
    expect(ids).toEqual(['u1', 'u2'])
  })
})
