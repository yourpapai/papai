// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { decryptSecretPayload, encryptSecretPayload } from '../src/secret-payload-crypto.js'

const originalKey = process.env['INSTANCE_CONFIG_KEY']

afterEach(() => {
  if (originalKey === undefined) delete process.env['INSTANCE_CONFIG_KEY']
  else process.env['INSTANCE_CONFIG_KEY'] = originalKey
})

describe('secret-payload-crypto', () => {
  test('round-trips a string record without exposing plaintext in encoded payload', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'a'.repeat(64)
    const encoded = encryptSecretPayload({ llm_apikey: 'sk-test', main_model: 'gpt-test' })

    expect(encoded).not.toContain('sk-test')
    expect(decryptSecretPayload(encoded)).toEqual({ llm_apikey: 'sk-test', main_model: 'gpt-test' })
  })

  test('rejects payload encrypted with a different key', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'a'.repeat(64)
    const encoded = encryptSecretPayload({ token: 'secret' })

    process.env['INSTANCE_CONFIG_KEY'] = 'b'.repeat(64)
    expect(() => decryptSecretPayload(encoded)).toThrow()
  })

  test('rejects payload that is too short to contain iv tag and ciphertext', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'a'.repeat(64)
    expect(() => decryptSecretPayload(Buffer.from('short').toString('base64'))).toThrow('Encrypted payload too short')
  })
})
