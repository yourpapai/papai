// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { platformAdmins, platformInstances, superAdmins } from '../../src/db/schema.js'
import {
  addAdmin,
  isAdmin,
  isPlatformAdmin,
  isSuperAdmin,
  listAdmins,
  listAdminsForPlatform,
  removeAdmin,
  SUPER_ADMIN_PLATFORM_ID,
} from '../../src/instances/admin-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const seedPlatform = (id: string): void => {
  getDrizzleDb()
    .insert(platformInstances)
    .values({ id, type: id.startsWith('mm') ? 'mattermost' : 'telegram', config: '{}', status: 'active' })
    .onConflictDoNothing()
    .run()
}

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

  test('isSuperAdmin returns true only for super-admin rows', () => {
    seedPlatform('tg-default')

    addAdmin('super-user', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('platform-user', 'tg-default')

    expect(isSuperAdmin('super-user')).toBe(true)
    expect(isSuperAdmin('platform-user')).toBe(false)
    expect(isSuperAdmin('nobody')).toBe(false)
  })

  test('isPlatformAdmin returns true only for matching platform rows', () => {
    seedPlatform('tg-default')

    addAdmin('platform-user', 'tg-default')
    addAdmin('super-user', SUPER_ADMIN_PLATFORM_ID)

    expect(isPlatformAdmin('platform-user', 'tg-default')).toBe(true)
    expect(isPlatformAdmin('platform-user', 'mm-default')).toBe(false)
    expect(isPlatformAdmin('super-user', 'tg-default')).toBe(false)
  })

  test('addAdmin + isAdmin for platform-only admin', () => {
    seedPlatform('tg-default')

    addAdmin('u2', 'tg-default')
    expect(isAdmin('u2', 'tg-default')).toBe(true)
    expect(isAdmin('u2', 'mm-default')).toBe(false)
    expect(isAdmin('u2', SUPER_ADMIN_PLATFORM_ID)).toBe(false)
  })

  test('non-admin returns false', () => {
    expect(isAdmin('nobody', 'tg-default')).toBe(false)
  })

  test('addAdmin is idempotent for the same (user, platform) pair', () => {
    seedPlatform('tg-default')

    addAdmin('u1', 'tg-default')
    expect(() => {
      addAdmin('u1', 'tg-default')
    }).not.toThrow()
    expect(isAdmin('u1', 'tg-default')).toBe(true)
  })

  test('removeAdmin removes the row', () => {
    seedPlatform('tg-default')

    addAdmin('u1', 'tg-default')
    removeAdmin('u1', 'tg-default')
    expect(isAdmin('u1', 'tg-default')).toBe(false)
  })

  test('listAdminsForPlatform returns scoped rows', () => {
    seedPlatform('tg-default')
    seedPlatform('mm-default')

    addAdmin('u1', 'tg-default')
    addAdmin('u2', 'tg-default')
    addAdmin('u3', 'mm-default')
    const ids = listAdminsForPlatform('tg-default')
      .map((a) => a.userId)
      .toSorted()
    expect(ids).toEqual(['u1', 'u2'])
  })

  test('stores super-admin and platform-admin rows in separate tables', () => {
    seedPlatform('tg-default')

    addAdmin('root', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('platform-user', 'tg-default')

    expect(
      getDrizzleDb()
        .select()
        .from(superAdmins)
        .all()
        .map((row) => row.userId),
    ).toEqual(['root'])
    expect(
      getDrizzleDb()
        .select()
        .from(platformAdmins)
        .all()
        .map((row) => row.userId),
    ).toEqual(['platform-user'])
  })

  test('addAdmin rejects missing platform admin targets', () => {
    expect(() => addAdmin('platform-user', 'missing-platform')).toThrow()
  })

  test('listAdmins returns all admin rows', () => {
    seedPlatform('tg-default')
    seedPlatform('mm-default')

    addAdmin('u1', 'tg-default')
    addAdmin('u2', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('u3', 'mm-default')

    const ids = listAdmins()
      .map((a) => `${a.platformInstanceId}:${a.userId}`)
      .toSorted()

    expect(ids).toEqual(['__super__:u2', 'mm-default:u3', 'tg-default:u1'])
  })
})
