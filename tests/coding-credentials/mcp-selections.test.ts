// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  codingMcpSelectionsSchema,
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
