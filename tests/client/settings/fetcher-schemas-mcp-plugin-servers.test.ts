// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AdminMcpPluginServersResponseSchema } from '../../../client/settings/fetcher-schemas-mcp-plugin-servers.js'

describe('AdminMcpPluginServersResponseSchema', () => {
  test('parses an empty response', () => {
    const parsed = AdminMcpPluginServersResponseSchema.parse({ available: [], configs: [] })
    expect(parsed.available).toEqual([])
    expect(parsed.configs).toEqual([])
  })

  test('parses an available plugin entry', () => {
    const parsed = AdminMcpPluginServersResponseSchema.parse({
      available: [
        {
          pluginId: 'synthetic-web-search',
          name: 'Synthetic Web Search',
          description: 'Search the web',
          tools: ['search'],
        },
      ],
      configs: [],
    })
    expect(parsed.available).toHaveLength(1)
    expect(parsed.available[0]).toMatchObject({
      pluginId: 'synthetic-web-search',
      name: 'Synthetic Web Search',
      description: 'Search the web',
      tools: ['search'],
    })
  })

  test('parses a config with default_tool_policy and no per-tool overrides', () => {
    const parsed = AdminMcpPluginServersResponseSchema.parse({
      available: [],
      configs: [{ plugin_id: 'synthetic-web-search', enabled: true, default_tool_policy: 'ask' }],
    })
    expect(parsed.configs[0]).toMatchObject({
      plugin_id: 'synthetic-web-search',
      enabled: true,
      default_tool_policy: 'ask',
    })
    expect(parsed.configs[0]?.tool_policy).toBeUndefined()
  })

  test('parses a config with per-tool policy overrides', () => {
    const parsed = AdminMcpPluginServersResponseSchema.parse({
      available: [],
      configs: [
        {
          plugin_id: 'synthetic-web-search',
          enabled: true,
          default_tool_policy: 'deny',
          tool_policy: { search: 'allow' },
        },
      ],
    })
    expect(parsed.configs[0]?.tool_policy).toEqual({ search: 'allow' })
  })

  test('throws when default_tool_policy is an invalid value', () => {
    expect(() =>
      AdminMcpPluginServersResponseSchema.parse({
        available: [],
        configs: [{ plugin_id: 'synthetic-web-search', enabled: true, default_tool_policy: 'sometimes' }],
      }),
    ).toThrow()
  })

  test('throws when available or configs is missing', () => {
    expect(() => AdminMcpPluginServersResponseSchema.parse({})).toThrow()
    expect(() => AdminMcpPluginServersResponseSchema.parse({ available: [] })).toThrow()
  })
})
