// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('mcp-server/index re-exports', () => {
  test('routePluginMcpPaths is exported from server-route', async () => {
    const mod = await import('../../src/mcp-server/index.js')
    expect(typeof mod.routePluginMcpPaths).toBe('function')
  })

  test('mintPluginMcpToken and verifyPluginMcpToken are exported from token', async () => {
    const mod = await import('../../src/mcp-server/index.js')
    expect(typeof mod.mintPluginMcpToken).toBe('function')
    expect(typeof mod.verifyPluginMcpToken).toBe('function')
  })

  test('PLUGIN_MCP_TOKEN_TTL_SECONDS is exported from token', async () => {
    const mod = await import('../../src/mcp-server/index.js')
    expect(typeof mod.PLUGIN_MCP_TOKEN_TTL_SECONDS).toBe('number')
  })
})
