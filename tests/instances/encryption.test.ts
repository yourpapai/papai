// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  decryptInstanceConfig,
  encryptInstanceConfig,
  maskConfig,
  resolveInstanceConfigKey,
  resolveInstanceConfigKeyInfo,
} from '../../src/instances/encryption.js'

describe('maskConfig with explicit sensitive keys', () => {
  test('masks only the keys in the provided set', () => {
    // 'token' matches the name pattern but is not in the explicit set — must NOT be masked
    // 'secretField' is in the explicit set — must be masked
    const masked = maskConfig({ baseUrl: 'u', secretField: 's', token: 't' }, new Set(['secretField']))
    expect(masked).toEqual({ baseUrl: 'u', secretField: '***', token: 't' })
  })

  test('falls back to the name pattern when no set is given', () => {
    const masked = maskConfig({ token: 't', baseUrl: 'u' })
    expect(masked).toEqual({ token: '***', baseUrl: 'u' })
  })
})

const originalEnv = process.env['INSTANCE_CONFIG_KEY']

describe('encryption', () => {
  beforeEach(() => {
    // 32-byte hex key
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['INSTANCE_CONFIG_KEY']
    else process.env['INSTANCE_CONFIG_KEY'] = originalEnv
  })

  test('round-trips a config object', () => {
    const plain = { token: 'abc123', url: 'https://example.invalid' }
    const cipher = encryptInstanceConfig(plain)
    const back = decryptInstanceConfig(cipher)
    expect(back).toEqual(plain)
  })

  test('produces different ciphertexts for the same plaintext (IV non-determinism)', () => {
    const plain = { token: 'abc' }
    const a = encryptInstanceConfig(plain)
    const b = encryptInstanceConfig(plain)
    expect(a).not.toEqual(b)
  })

  test('tampered ciphertext throws on decrypt', () => {
    const plain = { token: 'abc' }
    const cipher = encryptInstanceConfig(plain)
    // Decode, XOR the last byte of the ciphertext, re-encode — guarantees a change.
    const buf = Buffer.from(cipher, 'base64')
    expect(buf.length).toBeGreaterThan(0)
    buf.writeUInt8(buf.readUInt8(buf.length - 1) ^ 0xff, buf.length - 1)
    const tampered = buf.toString('base64')
    expect(() => decryptInstanceConfig(tampered)).toThrow()
  })

  test('payload too short throws clear error', () => {
    expect(() => decryptInstanceConfig('AAAA')).toThrow(/too short/iu)
  })

  test('resolveInstanceConfigKey uses 64-hex env value verbatim', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'a'.repeat(64)
    const key = resolveInstanceConfigKey()
    expect(key.length).toBe(32)
    expect(key[0]).toBe(0xaa)
  })

  test('resolveInstanceConfigKey derives non-hex passphrases with scrypt instead of SHA-256', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'not-a-hex-key'

    const info = resolveInstanceConfigKeyInfo()
    const bareSha = createHash('sha256').update('not-a-hex-key', 'utf8').digest()

    expect(info.mode).toBe('passphrase')
    expect(info.key.length).toBe(32)
    expect(info.key.equals(bareSha)).toBe(false)
    expect(resolveInstanceConfigKey().equals(info.key)).toBe(true)
  })

  test('resolveInstanceConfigKey derives missing-key fallback from host material', () => {
    delete process.env['INSTANCE_CONFIG_KEY']

    const left = resolveInstanceConfigKeyInfo({ hostname: () => 'host-a', homeDir: () => '/home/a' })
    const right = resolveInstanceConfigKeyInfo({ hostname: () => 'host-b', homeDir: () => '/home/a' })
    const repeat = resolveInstanceConfigKeyInfo({ hostname: () => 'host-a', homeDir: () => '/home/a' })

    expect(left.mode).toBe('host-local-fallback')
    expect(left.key.length).toBe(32)
    expect(left.warning).toContain('not portable')
    expect(left.key.equals(right.key)).toBe(false)
    expect(left.key.equals(repeat.key)).toBe(true)
  })

  test('maskConfig masks secret-like keys and preserves others', () => {
    const masked = maskConfig({
      token: 'xyz',
      apiKey: 'kkk',
      password: 'pw',
      cookie: 'c',
      secret: 's',
      url: 'https://example.invalid',
      name: 'plain',
    })
    expect(masked['token']).toBe('***')
    expect(masked['apiKey']).toBe('***')
    expect(masked['password']).toBe('***')
    expect(masked['cookie']).toBe('***')
    expect(masked['secret']).toBe('***')
    expect(masked['url']).toBe('https://example.invalid')
    expect(masked['name']).toBe('plain')
  })
})
