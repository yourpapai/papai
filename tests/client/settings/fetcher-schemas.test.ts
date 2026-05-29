// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  BootstrapSchema,
  ConfigResponseSchema,
  IdentityResponseSchema,
  McpResponseSchema,
  PluginsResponseSchema,
  ToolsResponseSchema,
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

  test('ToolsResponseSchema parses domains and tool risk', () => {
    const parsed = ToolsResponseSchema.parse({
      contextId: 'user:1',
      domains: [{ domain: 'task', status: 'partial', tools: [{ name: 'create_task', enabled: true, risk: 'write' }] }],
    })
    expect(parsed.domains[0]!.status).toBe('partial')
    expect(parsed.domains[0]!.tools[0]!.risk).toBe('write')
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
      mapping: { providerUserId: null, providerUserLogin: null, displayName: null, matchMethod: null, confidence: 0 },
    })
    expect(parsed.mapping.providerUserId).toBeNull()
  })
})
