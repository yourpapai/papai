// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/mcp-server/token.test.ts
import { describe, expect, test } from 'bun:test'

import {
  mintPluginMcpToken,
  mintTranscriptToken,
  verifyPluginMcpToken,
  verifyTranscriptToken,
} from '../../src/mcp-server/token.js'

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

  test('rejects structurally-varied malformed tokens', () => {
    // has a '.' but the payload segment is not valid base64url-encoded JSON
    expect(verifyPluginMcpToken('!!!not-base64url!!!.somesig')).toBeNull()
    // valid base64url payload, but it decodes to non-JSON garbage
    const nonJsonPayload = Buffer.from('this is not json', 'utf8').toString('base64url')
    expect(verifyPluginMcpToken(`${nonJsonPayload}.somesig`)).toBeNull()
    // correctly-shaped token but with a signature of the wrong length
    const token = mintPluginMcpToken(CLAIMS)
    const [payload] = token.split('.')
    expect(verifyPluginMcpToken(`${payload}.short`)).toBeNull()
  })

  test('never throws on adversarial input', () => {
    const adversarial = ['', '.', 'a.b', 'not-a-token', 'x'.repeat(100_000), '.'.repeat(50), '=====.=====']
    for (const input of adversarial) {
      expect(() => verifyPluginMcpToken(input)).not.toThrow()
    }
  })
})

describe('transcript token', () => {
  test('round-trips a valid magiSessionId', () => {
    const token = mintTranscriptToken('sess-42')
    expect(verifyTranscriptToken(token)).toEqual({ magiSessionId: 'sess-42' })
  })

  test('rejects a tampered payload', () => {
    const token = mintTranscriptToken('sess-42')
    const [, sig] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ v: 1, kind: 'transcript', magiSessionId: 'evil', exp: 9_999_999_999 }),
      'utf8',
    ).toString('base64url')
    expect(verifyTranscriptToken(`${forged}.${sig}`)).toBeNull()
  })

  test('rejects an expired token', () => {
    const token = mintTranscriptToken('sess-42', 1)
    expect(verifyTranscriptToken(token, Date.now() + 2000)).toBeNull()
  })

  test('rejects a plugin-mcp token presented as a transcript token (wrong kind)', () => {
    const pluginToken = mintPluginMcpToken({ storageContextId: 'c', chatUserId: 'u', pluginId: 'p' })
    expect(verifyTranscriptToken(pluginToken)).toBeNull()
  })

  test('rejects a transcript token presented as a plugin-mcp token (wrong kind)', () => {
    const transcriptToken = mintTranscriptToken('sess-42')
    expect(verifyPluginMcpToken(transcriptToken)).toBeNull()
  })

  test('rejects a malformed token', () => {
    expect(verifyTranscriptToken('not-a-token')).toBeNull()
    expect(verifyTranscriptToken('')).toBeNull()
  })

  test('never throws on adversarial input', () => {
    const adversarial = ['', '.', 'a.b', 'not-a-token', 'x'.repeat(100_000), '.'.repeat(50), '=====.=====']
    for (const input of adversarial) {
      expect(() => verifyTranscriptToken(input)).not.toThrow()
    }
  })
})
