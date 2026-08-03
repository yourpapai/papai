// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseAnalyticsKeyring, parseGovernanceKeyring } from '../../src/analytics/identity/keyring.js'

describe('analytics keyring parser', () => {
  test('returns unavailable when env is empty', () => {
    const result = parseAnalyticsKeyring('')
    expect(result).toEqual({ kind: 'unavailable' })
  })

  test('parses a valid active key', () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    const result = parseAnalyticsKeyring(`v1:${key}`)
    expect(result).toEqual({
      kind: 'available',
      activeVersion: 'v1',
      activeKey: Buffer.from(key, 'hex'),
      keys: new Map([['v1', Buffer.from(key, 'hex')]]),
    })
  })

  test('parses multiple retained versions', () => {
    const keyA = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    const keyB = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100'
    const result = parseAnalyticsKeyring(`v1:${keyA};v2:${keyB}`)
    expect(result).toEqual({
      kind: 'available',
      activeVersion: 'v1',
      activeKey: Buffer.from(keyA, 'hex'),
      keys: new Map([
        ['v1', Buffer.from(keyA, 'hex')],
        ['v2', Buffer.from(keyB, 'hex')],
      ]),
    })
  })

  test('rejects duplicate versions', () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    const result = parseAnalyticsKeyring(`v1:${key};v1:${key}`)
    expect(result).toEqual({ kind: 'invalid' })
  })

  test('rejects missing active version', () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    const result = parseAnalyticsKeyring(`v2:${key}`)
    expect(result).toEqual({ kind: 'invalid' })
  })

  test('rejects invalid base64url characters', () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f+/='
    const result = parseAnalyticsKeyring(`v1:${key}`)
    expect(result).toEqual({ kind: 'invalid' })
  })

  test('rejects keys shorter than 32 bytes', () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e'
    const result = parseAnalyticsKeyring(`v1:${key}`)
    expect(result).toEqual({ kind: 'invalid' })
  })
})

describe('governance keyring parser', () => {
  test('returns unavailable when env is empty', () => {
    const result = parseGovernanceKeyring('')
    expect(result).toEqual({ kind: 'unavailable' })
  })

  test('parses a valid active key', () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    const result = parseGovernanceKeyring(`v1:${key}`)
    expect(result).toEqual({
      kind: 'available',
      activeVersion: 'v1',
      activeKey: Buffer.from(key, 'hex'),
      keys: new Map([['v1', Buffer.from(key, 'hex')]]),
    })
  })
})
