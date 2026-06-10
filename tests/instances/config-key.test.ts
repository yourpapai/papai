// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { resolveInstanceConfigKeyInfo } from '../../src/instances/config-key.js'

const originalEnv = process.env['INSTANCE_CONFIG_KEY']

describe('config-key derivation memoization', () => {
  beforeEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['INSTANCE_CONFIG_KEY']
    else process.env['INSTANCE_CONFIG_KEY'] = originalEnv
  })

  test('passphrase key derivation is memoized across calls (same Buffer instance)', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'memoization-passphrase'

    const first = resolveInstanceConfigKeyInfo()
    const second = resolveInstanceConfigKeyInfo()

    expect(first.mode).toBe('passphrase')
    expect(second.key).toBe(first.key)
  })

  test('host-fallback key derivation is memoized across calls (same Buffer instance)', () => {
    const deps = { hostname: (): string => 'memo-host', homeDir: (): string => '/home/memo' }

    const first = resolveInstanceConfigKeyInfo(deps)
    const second = resolveInstanceConfigKeyInfo(deps)

    expect(first.mode).toBe('host-local-fallback')
    expect(second.key).toBe(first.key)
  })

  test('memoized derivation still yields distinct keys for distinct passphrases', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'passphrase-one'
    const one = resolveInstanceConfigKeyInfo()
    process.env['INSTANCE_CONFIG_KEY'] = 'passphrase-two'
    const two = resolveInstanceConfigKeyInfo()

    expect(one.key.equals(two.key)).toBe(false)
  })

  test('explicit 64-hex key mode is unaffected by the derivation cache', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'b'.repeat(64)

    const info = resolveInstanceConfigKeyInfo()

    expect(info.mode).toBe('explicit')
    expect(info.key.length).toBe(32)
    expect(info.key[0]).toBe(0xbb)
  })
})
