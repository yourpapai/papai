// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { generateToken, hashToken, timingSafeEqualHex } from '../../src/settings/crypto.js'

describe('settings crypto', () => {
  test('generateToken returns a high-entropy url-safe string', () => {
    const token = generateToken()
    // 32 random bytes base64url-encoded => 43 chars, no padding, url-safe alphabet
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(generateToken()).not.toBe(token)
  })

  test('hashToken is deterministic 64-char hex', () => {
    const hash = hashToken('hello')
    expect(hash).toMatch(/^[0-9a-f]{64}$/u)
    expect(hashToken('hello')).toBe(hash)
    expect(hashToken('world')).not.toBe(hash)
  })

  test('timingSafeEqualHex compares equal and unequal hex strings', () => {
    const a = hashToken('same')
    expect(timingSafeEqualHex(a, hashToken('same'))).toBe(true)
    expect(timingSafeEqualHex(a, hashToken('different'))).toBe(false)
    expect(timingSafeEqualHex(a, 'deadbeef')).toBe(false)
  })
})
