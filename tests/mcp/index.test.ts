// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

describe('mcp/index re-exports', () => {
  test('buildMcpToolSet is exported from user-endpoints', async () => {
    const mod = await import('../../src/mcp/index.js')
    expect(typeof mod.buildMcpToolSet).toBe('function')
  })

  test('buildPluginMcpToolSet is exported from plugin-endpoints', async () => {
    const mod = await import('../../src/mcp/index.js')
    expect(typeof mod.buildPluginMcpToolSet).toBe('function')
  })

  test('mcpPool singleton is exported', async () => {
    const mod = await import('../../src/mcp/index.js')
    expect(mod.mcpPool).toBeDefined()
    expect(typeof mod.mcpPool.getOrCreateFromPlugin).toBe('function')
  })

  test('convertMcpToolsToToolSet is exported from tool-adapter', async () => {
    const mod = await import('../../src/mcp/index.js')
    expect(typeof mod.convertMcpToolsToToolSet).toBe('function')
  })
})
