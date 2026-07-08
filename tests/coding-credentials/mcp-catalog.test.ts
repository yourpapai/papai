// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../../src/cache.js'
import {
  adminMcpCatalogContextId,
  mcpCatalogSchema,
  resolveMcpCatalog,
  setMcpCatalog,
} from '../../src/coding-credentials/mcp-catalog.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('mcp-catalog', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolveMcpCatalog defaults to empty array when unset', () => {
    expect(resolveMcpCatalog('pi-x')).toEqual([])
  })

  test('setMcpCatalog round-trips entries', () => {
    const entries = [{ name: 'github', upstream_url: 'https://mcp.example.com/github', host: 'mcp.example.com' }]
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
      JSON.stringify([{ name: 'x', upstream_url: 'http://h', host: 'h' }]),
    )
    expect(resolveMcpCatalog('pi-w')).toEqual([])
  })

  test('mcpCatalogSchema rejects non-https upstream_url', () => {
    const result = mcpCatalogSchema.safeParse([{ name: 'x', upstream_url: 'http://h', host: 'h' }])
    expect(result.success).toBe(false)
  })
})
