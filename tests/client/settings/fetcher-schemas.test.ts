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
  BootstrapSchema,
  ConfigResponseSchema,
  GroupTaskInstanceResponseSchema,
  IdentityResponseSchema,
  OpenAccessResponseSchema,
  ProviderTypesResponseSchema,
  McpResponseSchema,
  PluginsResponseSchema,
} from '../../../client/settings/fetcher-schemas.js'

describe('fetcher-schemas', () => {
  test('BootstrapSchema parses a full bootstrap payload', () => {
    const parsed = BootstrapSchema.parse({
      csrfToken: 'tok',
      display: 'alice',
      principal: { isBotAdmin: true, isSuperAdmin: false },
      contexts: [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }],
    })
    expect(parsed.principal.isBotAdmin).toBe(true)
    expect(parsed.contexts).toHaveLength(1)
  })

  test('ConfigResponseSchema parses fields', () => {
    const parsed = ConfigResponseSchema.parse({
      contextId: 'user:1',
      fields: [
        {
          key: 'timezone',
          storageKey: 'timezone',
          label: 'Timezone',
          required: true,
          sensitive: false,
          kind: 'preference',
          hasValue: true,
          value: 'UTC',
        },
      ],
    })
    expect(parsed.fields[0]!.kind).toBe('preference')
  })

  test('ConfigResponseSchema parses enum control fields', () => {
    const parsed = ConfigResponseSchema.parse({
      contextId: 'user:1',
      fields: [
        {
          key: 'ai_output_detail_level',
          storageKey: 'ai_output_detail_level',
          label: 'Detail level',
          required: false,
          sensitive: false,
          kind: 'ai-output',
          control: 'select',
          options: [
            { value: 'sanitized', label: 'Sanitized' },
            { value: 'raw', label: 'Raw' },
          ],
          hasValue: false,
          value: '',
        },
      ],
    })
    expect(parsed.fields[0]!.control).toBe('select')
    expect(parsed.fields[0]!.options).toHaveLength(2)
  })

  test('McpResponseSchema parses endpoints with optional headers', () => {
    const parsed = McpResponseSchema.parse({
      contextId: 'user:1',
      endpoints: [{ id: 'a', url: 'https://x/y', enabled: true, headers: { Authorization: '****' } }],
    })
    expect(parsed.endpoints[0]!.id).toBe('a')
  })

  test('PluginsResponseSchema parses eligibility variants', () => {
    const parsed = PluginsResponseSchema.parse({
      contextId: 'user:1',
      plugins: [
        {
          id: 'p',
          name: 'P',
          active: true,
          enabled: false,
          eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['k'] },
          contextConfig: [],
        },
      ],
    })
    expect(parsed.plugins[0]!.eligibility.eligible).toBe(false)
  })

  test('IdentityResponseSchema accepts null mapping fields', () => {
    const parsed = IdentityResponseSchema.parse({
      contextId: 'user:1',
      providerName: 'kaneo',
      mapping: {
        providerUserId: null,
        providerUserLogin: null,
        displayName: null,
        matchedAt: '2026-01-01T00:00:00Z',
        matchMethod: null,
        confidence: null,
      },
    })
    expect(parsed.mapping?.providerUserId).toBeNull()
  })

  test('IdentityResponseSchema accepts null mapping', () => {
    const parsed = IdentityResponseSchema.parse({
      contextId: 'user:1',
      providerName: 'kaneo',
      mapping: null,
    })
    expect(parsed.mapping).toBeNull()
  })

  test('AdminInstancesResponseSchema accepts unreadable diagnostics', () => {
    const parsed = AdminInstancesResponseSchema.parse({
      instances: [{ id: 'ti-1', type: 'kaneo', status: 'active', config: {} }],
      unreadable: [{ table: 'task_instances', id: 'ti-broken', type: 'kaneo', error: 'Encrypted payload' }],
    })
    expect(parsed.instances).toHaveLength(1)
  })

  test('GroupTaskInstanceResponseSchema parses a bound payload', () => {
    const parsed = GroupTaskInstanceResponseSchema.parse({
      contextId: 'user:1',
      taskInstanceId: 'yt-default',
      available: [{ id: 'yt-default', type: 'youtrack', status: 'active' }],
    })
    expect(parsed.taskInstanceId).toBe('yt-default')
    expect(parsed.available[0]?.type).toBe('youtrack')
  })

  test('GroupTaskInstanceResponseSchema accepts a null taskInstanceId', () => {
    const parsed = GroupTaskInstanceResponseSchema.parse({
      contextId: 'user:1',
      taskInstanceId: null,
      available: [],
    })
    expect(parsed.taskInstanceId).toBeNull()
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
