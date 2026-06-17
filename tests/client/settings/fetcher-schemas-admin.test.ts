// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AdminInstancesResponseSchema,
  AdminGroupsResponseSchema,
  AdminRosterResponseSchema,
  AdminSystemResponseSchema,
  AdminUsersResponseSchema,
  AddAdminUserResponseSchema,
  AnnounceResultSchema,
  PluginApprovalResultSchema,
  ProviderTypesResponseSchema,
} from '../../../client/settings/fetcher-schemas-admin.js'

describe('fetcher-schemas-admin', () => {
  test('AdminInstancesResponseSchema accepts unreadable diagnostics', () => {
    const parsed = AdminInstancesResponseSchema.parse({
      instances: [{ id: 'ti-1', type: 'kaneo', status: 'active', config: {} }],
      unreadable: [{ table: 'task_instances', id: 'ti-broken', type: 'kaneo', error: 'Encrypted payload' }],
    })
    expect(parsed.instances).toHaveLength(1)
    expect(parsed.unreadable).toHaveLength(1)
  })

  test('AdminGroupsResponseSchema parses groups and observed entries', () => {
    const parsed = AdminGroupsResponseSchema.parse({
      groups: [{ group_id: 'pi:a:ctx:b', added_by: 'admin', added_at: '2026-06-01' }],
      observed: [{ contextId: 'pi:a:ctx:c', displayName: 'Ops', parentName: null }],
    })
    expect(parsed.observed[0]?.contextId).toBe('pi:a:ctx:c')
  })

  test('AdminGroupsResponseSchema defaults observed to empty array', () => {
    const parsed = AdminGroupsResponseSchema.parse({ groups: [] })
    expect(parsed.observed).toEqual([])
  })

  test('AdminRosterResponseSchema parses admins list', () => {
    const parsed = AdminRosterResponseSchema.parse({
      admins: [{ userId: 'u1', platformInstanceId: 'pi-1', createdAt: '2026-01-01' }],
    })
    expect(parsed.admins).toHaveLength(1)
  })

  test('AdminSystemResponseSchema parses LLM config', () => {
    const parsed = AdminSystemResponseSchema.parse({
      config: { llm_apikey: { value: null, updatedAt: null, updatedBy: null } },
    })
    expect(parsed.config['llm_apikey']?.value).toBeNull()
  })

  test('AdminUsersResponseSchema parses user rows', () => {
    const parsed = AdminUsersResponseSchema.parse({
      users: [{ platform_user_id: '42', platform_instance_id: 'pi-1', username: 'alice' }],
    })
    expect(parsed.users[0]?.platform_user_id).toBe('42')
  })

  test('AddAdminUserResponseSchema accepts pending flag', () => {
    expect(AddAdminUserResponseSchema.parse({ ok: true, pending: true })).toEqual({ ok: true, pending: true })
  })

  test('AnnounceResultSchema parses counts', () => {
    const parsed = AnnounceResultSchema.parse({ totalUsers: 10, successCount: 9, failCount: 1 })
    expect(parsed.totalUsers).toBe(10)
  })

  test('PluginApprovalResultSchema parses approval result', () => {
    expect(PluginApprovalResultSchema.parse({ ok: true, state: 'approved' })).toEqual({ ok: true, state: 'approved' })
  })

  test('ProviderTypesResponseSchema preserves storageKey on instance config fields', () => {
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
