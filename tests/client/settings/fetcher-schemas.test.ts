// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  BootstrapSchema,
  ConfigResponseSchema,
  GroupTaskInstanceResponseSchema,
  IdentityResponseSchema,
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

  test('GroupTaskInstanceResponseSchema parses a bound payload', () => {
    const parsed = GroupTaskInstanceResponseSchema.parse({
      contextId: 'user:1',
      taskInstanceId: 'yt-default',
      available: [{ id: 'yt-default', type: 'youtrack', status: 'active' }],
      canProvision: true,
    })
    expect(parsed.taskInstanceId).toBe('yt-default')
    expect(parsed.available[0]?.type).toBe('youtrack')
    expect(parsed.canProvision).toBe(true)
  })

  test('GroupTaskInstanceResponseSchema accepts a null taskInstanceId', () => {
    const parsed = GroupTaskInstanceResponseSchema.parse({
      contextId: 'user:1',
      taskInstanceId: null,
      available: [],
      canProvision: false,
    })
    expect(parsed.taskInstanceId).toBeNull()
    expect(parsed.canProvision).toBe(false)
  })

  test('GroupTaskInstanceResponseSchema requires canProvision', () => {
    expect(() =>
      GroupTaskInstanceResponseSchema.parse({
        contextId: 'user:1',
        taskInstanceId: null,
        available: [],
      }),
    ).toThrow()
  })
})
