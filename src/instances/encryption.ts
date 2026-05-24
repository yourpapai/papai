// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { logger } from '../logger.js'
import type { InstanceConfig } from './types.js'

const log = logger.child({ scope: 'instances:encryption' })

const IV_LEN = 12
const TAG_LEN = 16
const FALLBACK_SEED = 'papai:instance-config:fallback'
const SECRET_KEY_PATTERN = /token|key|secret|password|cookie/iu

let fallbackWarned = false

const isHex64 = (value: string): boolean => /^[0-9a-f]{64}$/iu.test(value)

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

export const resolveInstanceConfigKey = (): Buffer => {
  const raw = process.env['INSTANCE_CONFIG_KEY']
  if (raw !== undefined && raw.trim() !== '') {
    const trimmed = raw.trim()
    if (isHex64(trimmed)) return Buffer.from(trimmed, 'hex')
    return sha256(trimmed)
  }
  if (!fallbackWarned) {
    log.warn('INSTANCE_CONFIG_KEY is unset; using host-local derived fallback (not for production)')
    fallbackWarned = true
  }
  return sha256(FALLBACK_SEED)
}

export const encryptInstanceConfig = (plain: InstanceConfig): string => {
  const key = resolveInstanceConfigKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  const plaintext = Buffer.from(JSON.stringify(plain), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

export const decryptInstanceConfig = (encoded: string): InstanceConfig => {
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
  const parsed: unknown = JSON.parse(plaintext)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Decrypted payload is not a config object')
  }
  const result: InstanceConfig = {}
  for (const [key2, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new TypeError(`Decrypted payload field "${key2}" is not a string`)
    }
    result[key2] = value
  }
  return result
}

export const maskConfig = (plain: InstanceConfig): InstanceConfig => {
  const out: InstanceConfig = {}
  for (const [k, v] of Object.entries(plain)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? '***' : v
  }
  return out
}
