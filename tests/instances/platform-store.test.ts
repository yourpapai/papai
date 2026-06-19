// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { platformInstances } from '../../src/db/schema.js'
import {
  deletePlatformInstance,
  getPlatformInstance,
  insertPlatformInstance,
  isOpenDmAccessEnabled,
  listActivePlatformInstancesSafe,
  listPlatformInstances,
  setOpenDmAccess,
  updatePlatformInstance,
} from '../../src/instances/platform-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('platform-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '1'.repeat(64)
  })

  afterEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
  })

  test('insert + get round-trips with decrypted config', () => {
    insertPlatformInstance({
      id: 'tg-prod',
      type: 'telegram',
      config: { token: 'secret-token' },
      status: 'active',
    })
    const row = getPlatformInstance('tg-prod')
    expect(row).not.toBeNull()
    expect(row?.id).toBe('tg-prod')
    expect(row?.type).toBe('telegram')
    expect(row?.status).toBe('active')
    expect(row?.config).toEqual({ token: 'secret-token' })
  })

  test('get returns null for missing id', () => {
    expect(getPlatformInstance('nope')).toBeNull()
  })

  test('list returns all rows in insertion order', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertPlatformInstance({
      id: 'b',
      type: 'mattermost',
      config: { baseUrl: 'u', token: 't' },
      status: 'pending',
    })
    const rows = listPlatformInstances()
    expect(rows.map((r) => r.id).toSorted()).toEqual(['a', 'b'])
  })

  test('listActivePlatformInstancesSafe skips unreadable active rows and returns failures', () => {
    insertPlatformInstance({ id: 'good', type: 'telegram', config: { token: 'secret' }, status: 'active' })
    getDrizzleDb()
      .insert(platformInstances)
      .values({ id: 'bad', type: 'telegram', config: 'not-base64', status: 'active' })
      .run()

    const result = listActivePlatformInstancesSafe()

    expect(result.instances.map((instance) => instance.id)).toEqual(['good'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ table: 'platform_instances', id: 'bad', type: 'telegram' })
    expect(result.failures[0]?.error).toContain('Encrypted payload')
  })

  test('update changes config and status, leaves id untouched', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 'old' }, status: 'pending' })
    updatePlatformInstance('a', { config: { token: 'new' }, status: 'active' })
    const row = getPlatformInstance('a')
    expect(row?.config).toEqual({ token: 'new' })
    expect(row?.status).toBe('active')
  })

  test('delete removes the row', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 't' }, status: 'active' })
    deletePlatformInstance('a')
    expect(getPlatformInstance('a')).toBeNull()
  })

  test('insert with duplicate id throws', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 't' }, status: 'active' })
    expect(() => {
      insertPlatformInstance({
        id: 'a',
        type: 'telegram',
        config: { token: 't' },
        status: 'active',
      })
    }).toThrow()
  })

  test('open DM access defaults to false and toggles', () => {
    insertPlatformInstance({ id: 'oa', type: 'telegram', config: { token: 't' }, status: 'active' })
    expect(isOpenDmAccessEnabled('oa')).toBe(false)
    setOpenDmAccess('oa', true)
    expect(isOpenDmAccessEnabled('oa')).toBe(true)
    setOpenDmAccess('oa', false)
    expect(isOpenDmAccessEnabled('oa')).toBe(false)
  })

  test('isOpenDmAccessEnabled is false for missing instance', () => {
    expect(isOpenDmAccessEnabled('nope')).toBe(false)
  })
})
