// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../../../../src/cache.js'
import {
  adminMcpCatalogContextId,
  mcpCatalogSchema,
  resolveMcpCatalog,
  setMcpCatalog,
} from '../../../../src/modules/coding/credentials/mcp-catalog.js'
import { mockLogger, setupTestDb } from '../../../utils/test-helpers.js'

describe('mcp-catalog', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolveMcpCatalog defaults to empty array when unset', () => {
    expect(resolveMcpCatalog('pi-x')).toEqual([])
  })

  test('setMcpCatalog round-trips entries (no host field, default required)', () => {
    const entries = [
      { name: 'github', upstream_url: 'https://mcp.example.com/github', default_tool_policy: 'allow' as const },
    ]
    setMcpCatalog('pi-y', entries)
    expect(resolveMcpCatalog('pi-y')).toEqual(entries)
    expect(adminMcpCatalogContextId('pi-y')).toBe('__admin_mcp_catalog__:pi-y')
  })

  test('resolveMcpCatalog degrades to empty array on invalid stored blob', () => {
    setCachedConfig('__admin_mcp_catalog__:pi-z', 'mcp_catalog', 'not-json')
    expect(resolveMcpCatalog('pi-z')).toEqual([])
  })

  test('resolveMcpCatalog degrades to empty array when stored entry fails schema', () => {
    setCachedConfig(
      '__admin_mcp_catalog__:pi-w',
      'mcp_catalog',
      JSON.stringify([{ name: 'x', upstream_url: 'http://h' }]),
    )
    expect(resolveMcpCatalog('pi-w')).toEqual([])
  })

  test('mcpCatalogSchema rejects non-https upstream_url', () => {
    const result = mcpCatalogSchema.safeParse([{ name: 'x', upstream_url: 'http://h', default_tool_policy: 'allow' }])
    expect(result.success).toBe(false)
  })

  test('mcpCatalogSchema rejects an entry missing default_tool_policy', () => {
    const result = mcpCatalogSchema.safeParse([{ name: 'x', upstream_url: 'https://h' }])
    expect(result.success).toBe(false)
  })

  test('mcpCatalogSchema rejects a name starting with the plugin: prefix (reserved for internal servers)', () => {
    const result = mcpCatalogSchema.safeParse([
      { name: 'plugin:synthetic-web-search', upstream_url: 'https://h', default_tool_policy: 'allow' },
    ])
    expect(result.success).toBe(false)
  })

  test("mcpCatalogSchema rejects a name outside magi's id charset (space or !)", () => {
    const withSpace = mcpCatalogSchema.safeParse([
      { name: 'GitHub MCP', upstream_url: 'https://h', default_tool_policy: 'allow' },
    ])
    expect(withSpace.success).toBe(false)
    const withBang = mcpCatalogSchema.safeParse([
      { name: 'github!', upstream_url: 'https://h', default_tool_policy: 'allow' },
    ])
    expect(withBang.success).toBe(false)
  })

  test("mcpCatalogSchema accepts a name within magi's id charset", () => {
    const result = mcpCatalogSchema.safeParse([
      { name: 'github-mcp', upstream_url: 'https://h', default_tool_policy: 'allow' },
    ])
    expect(result.success).toBe(true)
  })

  test('mcpCatalogSchema strips an unknown host key', () => {
    const result = mcpCatalogSchema.safeParse([
      { name: 'x', upstream_url: 'https://h', host: 'h', default_tool_policy: 'allow' },
    ])
    expect(result.success).toBe(true)
    expect(result.data?.[0]).not.toHaveProperty('host')
  })
})
