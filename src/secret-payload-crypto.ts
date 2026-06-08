// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { resolveInstanceConfigKey } from './instances/config-key.js'

const IV_LEN = 12
const TAG_LEN = 16

export type SecretPayload = Record<string, string>

const assertSecretPayload = (value: unknown): SecretPayload => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Decrypted payload is not a config object')
  }
  const result: SecretPayload = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue !== 'string') {
      throw new TypeError(`Decrypted payload field "${key}" is not a string`)
    }
    result[key] = nestedValue
  }
  return result
}

export const encryptSecretPayload = (plain: SecretPayload): string => {
  const key = resolveInstanceConfigKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  const plaintext = Buffer.from(JSON.stringify(plain), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

export const decryptSecretPayload = (encoded: string): SecretPayload => {
  const buf = Buffer.from(encoded, 'base64')
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error(`Encrypted payload too short: got ${buf.length} bytes, expected at least ${IV_LEN + TAG_LEN + 1}`)
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN)
  const key = resolveInstanceConfigKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return assertSecretPayload(JSON.parse(plaintext))
}
