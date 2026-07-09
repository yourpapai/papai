// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/mcp-server/token.test.ts
import { describe, expect, test } from 'bun:test'

import { mintPluginMcpToken, verifyPluginMcpToken } from '../../src/mcp-server/token.js'

const CLAIMS = { storageContextId: 'pi123:thread:42', chatUserId: 'user-7', pluginId: 'synthetic-web-search' }

describe('plugin mcp token', () => {
  test('round-trips valid claims', () => {
    const token = mintPluginMcpToken(CLAIMS)
    expect(verifyPluginMcpToken(token)).toEqual(CLAIMS)
  })

  test('rejects a tampered payload', () => {
    const token = mintPluginMcpToken(CLAIMS)
    const [, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...CLAIMS, pluginId: 'evil', exp: 9_999_999_999 }), 'utf8').toString(
      'base64url',
    )
    expect(verifyPluginMcpToken(`${forged}.${sig}`)).toBeNull()
  })

  test('rejects an expired token', () => {
    const token = mintPluginMcpToken(CLAIMS, 1)
    // 2 seconds later
    expect(verifyPluginMcpToken(token, Date.now() + 2000)).toBeNull()
  })

  test('rejects a malformed token', () => {
    expect(verifyPluginMcpToken('not-a-token')).toBeNull()
    expect(verifyPluginMcpToken('')).toBeNull()
  })
})
