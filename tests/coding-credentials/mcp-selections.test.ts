// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  codingMcpSelectionsSchema,
  mergeMcpTokens,
  parseMcpSelections,
  serializeMcpSelections,
} from '../../src/coding-credentials/mcp-selections.js'

describe('mcp selections', () => {
  test('round-trips an array through the servers field', () => {
    const sels = [{ server: 'plugin:web-search' }, { server: 'github-mcp', upstream_token: 'tok' }]
    const stored = serializeMcpSelections(sels)
    expect(parseMcpSelections({ servers: stored })).toEqual(sels)
  })
  test('returns [] for missing/garbage', () => {
    expect(parseMcpSelections(null)).toEqual([])
    expect(parseMcpSelections({ servers: 'not json' })).toEqual([])
    expect(parseMcpSelections({})).toEqual([])
  })
  test('schema rejects an empty server name', () => {
    expect(codingMcpSelectionsSchema.safeParse([{ server: '' }]).success).toBe(false)
  })
})

describe('mergeMcpTokens', () => {
  test('external row kept with a blank token preserves the stored token', () => {
    const stored = [{ server: 'github-mcp', upstream_token: 'stored-tok' }]
    const incoming = [{ server: 'github-mcp', upstream_token: '' }]
    expect(mergeMcpTokens(incoming, stored)).toEqual([{ server: 'github-mcp', upstream_token: 'stored-tok' }])
  })
  test('external row kept with an absent token preserves the stored token', () => {
    const stored = [{ server: 'github-mcp', upstream_token: 'stored-tok' }]
    const incoming = [{ server: 'github-mcp' }]
    expect(mergeMcpTokens(incoming, stored)).toEqual([{ server: 'github-mcp', upstream_token: 'stored-tok' }])
  })
  test('new external row keeps its provided token', () => {
    const stored: ReturnType<typeof parseMcpSelections> = []
    const incoming = [{ server: 'github-mcp', upstream_token: 'fresh-tok' }]
    expect(mergeMcpTokens(incoming, stored)).toEqual([{ server: 'github-mcp', upstream_token: 'fresh-tok' }])
  })
  test('a provided token overrides the stored one for the same server', () => {
    const stored = [{ server: 'github-mcp', upstream_token: 'old-tok' }]
    const incoming = [{ server: 'github-mcp', upstream_token: 'new-tok' }]
    expect(mergeMcpTokens(incoming, stored)).toEqual([{ server: 'github-mcp', upstream_token: 'new-tok' }])
  })
  test('internal (plugin:) rows never carry a token, even if one is provided', () => {
    const stored: ReturnType<typeof parseMcpSelections> = []
    const incoming = [{ server: 'plugin:web-search', upstream_token: 'should-be-dropped' }]
    expect(mergeMcpTokens(incoming, stored)).toEqual([{ server: 'plugin:web-search' }])
  })
  test('a removed row is absent from the merged output, dropping its token', () => {
    const stored = [
      { server: 'github-mcp', upstream_token: 'gh-tok' },
      { server: 'linear-mcp', upstream_token: 'linear-tok' },
    ]
    const incoming = [{ server: 'github-mcp', upstream_token: '' }]
    const merged = mergeMcpTokens(incoming, stored)
    expect(merged).toEqual([{ server: 'github-mcp', upstream_token: 'gh-tok' }])
    expect(merged.some((s) => s.server === 'linear-mcp')).toBe(false)
  })
  test('external row with no stored token and a blank incoming token ends up tokenless', () => {
    const stored: ReturnType<typeof parseMcpSelections> = []
    const incoming = [{ server: 'github-mcp', upstream_token: '' }]
    expect(mergeMcpTokens(incoming, stored)).toEqual([{ server: 'github-mcp' }])
  })
})
