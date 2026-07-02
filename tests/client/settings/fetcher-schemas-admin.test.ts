// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AddAdminUserResponseSchema,
  AdminGroupsResponseSchema,
  AdminInstancesResponseSchema,
  AdminUserRowSchema,
  OpenAccessResponseSchema,
  ProviderTypesResponseSchema,
} from '../../../client/settings/fetcher-schemas-admin.js'

describe('AdminInstancesResponseSchema', () => {
  test('accepts unreadable diagnostics', () => {
    const parsed = AdminInstancesResponseSchema.parse({
      instances: [{ id: 'ti-1', type: 'kaneo', status: 'active', config: {} }],
      unreadable: [{ table: 'task_instances', id: 'ti-broken', type: 'kaneo', error: 'Encrypted payload' }],
    })
    expect(parsed.instances).toHaveLength(1)
  })
})

describe('ProviderTypesResponseSchema', () => {
  test('preserves storageKey on instance config fields', () => {
    const parsed = ProviderTypesResponseSchema.parse({
      providerTypes: [
        {
          type: 'kaneo',
          displayName: 'Kaneo',
          instanceConfigSchema: [
            { key: 'baseUrl', storageKey: 'tracker_url', label: 'Base URL', required: true, sensitive: false },
          ],
        },
      ],
    })
    expect(parsed.providerTypes[0]?.instanceConfigSchema[0]?.storageKey).toBe('tracker_url')
  })
})

describe('AddAdminUserResponseSchema', () => {
  test('accepts a plain ok response', () => {
    expect(AddAdminUserResponseSchema.parse({ ok: true })).toEqual({ ok: true })
  })

  test('accepts and preserves the pending flag', () => {
    expect(AddAdminUserResponseSchema.parse({ ok: true, pending: true })).toEqual({ ok: true, pending: true })
  })
})

describe('AdminGroupsResponseSchema', () => {
  test('parses groups plus observed entries', () => {
    const parsed = AdminGroupsResponseSchema.parse({
      groups: [{ group_id: 'pi:a:ctx:b', added_by: 'admin', added_at: '2026-06-01' }],
      observed: [{ contextId: 'pi:a:ctx:c', displayName: 'Ops', parentName: null }],
    })
    expect(parsed.observed[0]?.contextId).toBe('pi:a:ctx:c')
    expect(parsed.observed[0]?.displayName).toBe('Ops')
  })

  test('defaults observed to an empty array when absent', () => {
    const parsed = AdminGroupsResponseSchema.parse({ groups: [] })
    expect(parsed.observed).toEqual([])
  })
})

describe('OpenAccessResponseSchema', () => {
  test('parses { openDmAccess: true }', () => {
    const parsed = OpenAccessResponseSchema.parse({ openDmAccess: true })
    expect(parsed.openDmAccess).toBe(true)
  })

  test('parses { openDmAccess: false }', () => {
    const parsed = OpenAccessResponseSchema.parse({ openDmAccess: false })
    expect(parsed.openDmAccess).toBe(false)
  })
})

describe('AdminUserRowSchema', () => {
  test('accepts a row with added_by and blocked_at', () => {
    const parsed = AdminUserRowSchema.parse({
      platform_user_id: 'u1',
      platform_instance_id: 'pi:tg',
      username: 'alice',
      added_by: 'open-access',
      blocked_at: '2026-06-18T10:00:00',
    })
    expect(parsed.added_by).toBe('open-access')
    expect(parsed.blocked_at).toBe('2026-06-18T10:00:00')
  })

  test('accepts a row without blocked_at (always-present added_by, absent optional blocked_at)', () => {
    const parsed = AdminUserRowSchema.parse({
      platform_user_id: 'u2',
      platform_instance_id: 'pi:tg',
      added_by: 'admin',
    })
    expect(parsed.added_by).toBe('admin')
    expect(parsed.blocked_at).toBeUndefined()
  })
})
