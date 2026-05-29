// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { homedir, hostname } from 'node:os'

import { logger } from '../logger.js'
import type { InstanceConfig } from './types.js'

const log = logger.child({ scope: 'instances:encryption' })

const IV_LEN = 12
const TAG_LEN = 16
const PASSPHRASE_SALT = 'papai:instance-config:passphrase:v1'
const HOST_FALLBACK_SALT = 'papai:instance-config:host-fallback:v1'
const HOST_FALLBACK_WARNING =
  'INSTANCE_CONFIG_KEY is unset; using host-local fallback. DB copies are not portable; production must set INSTANCE_CONFIG_KEY.'
const SECRET_KEY_PATTERN = /token|key|secret|password|cookie/iu

let fallbackWarned = false

const isHex64 = (value: string): boolean => /^[0-9a-f]{64}$/iu.test(value)

export type InstanceConfigKeyMode = 'explicit' | 'passphrase' | 'host-local-fallback'

export type InstanceConfigKeyInfo = Readonly<{
  key: Buffer
  mode: InstanceConfigKeyMode
  warning?: string
}>

export type InstanceConfigKeyDeps = Readonly<{
  hostname: () => string
  homeDir: () => string
}>

const defaultKeyDeps: InstanceConfigKeyDeps = {
  hostname,
  homeDir: homedir,
}

const deriveKey = (secret: string, salt: string): Buffer => scryptSync(secret, salt, 32)

const hostFallbackMaterial = (deps: InstanceConfigKeyDeps): string => `${deps.hostname()}\n${deps.homeDir()}`

export const resolveInstanceConfigKeyInfo = (deps: InstanceConfigKeyDeps = defaultKeyDeps): InstanceConfigKeyInfo => {
  const raw = process.env['INSTANCE_CONFIG_KEY']
  if (raw !== undefined && raw.trim() !== '') {
    const trimmed = raw.trim()
    if (isHex64(trimmed)) return { key: Buffer.from(trimmed, 'hex'), mode: 'explicit' }
    return { key: deriveKey(trimmed, PASSPHRASE_SALT), mode: 'passphrase' }
  }
  if (!fallbackWarned) {
    log.warn(HOST_FALLBACK_WARNING)
    fallbackWarned = true
  }
  return {
    key: deriveKey(hostFallbackMaterial(deps), HOST_FALLBACK_SALT),
    mode: 'host-local-fallback',
    warning: HOST_FALLBACK_WARNING,
  }
}

export const resolveInstanceConfigKey = (): Buffer => resolveInstanceConfigKeyInfo().key

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

/** True when a config key name looks secret-bearing (token, key, secret, password, cookie). */
export const isSecretKeyName = (key: string): boolean => SECRET_KEY_PATTERN.test(key)

export const unknownProviderSensitiveKeys = (config: InstanceConfig): ReadonlySet<string> =>
  new Set(Object.keys(config))

export const providerSensitiveKeys = (
  config: InstanceConfig,
  fields: readonly { readonly key: string; readonly storageKey?: string; readonly sensitive: boolean }[] | undefined,
): ReadonlySet<string> => {
  if (fields === undefined) return unknownProviderSensitiveKeys(config)
  const declared = fields.filter((field) => field.sensitive).map((field) => field.storageKey ?? field.key)
  const secretLike = Object.keys(config).filter((key) => isSecretKeyName(key))
  return new Set([...declared, ...secretLike])
}

export const maskConfig = (
  plain: InstanceConfig,
  sensitiveKeys?: ReadonlySet<string>,
  replacement = '***',
): InstanceConfig => {
  const out: InstanceConfig = {}
  for (const [k, v] of Object.entries(plain)) {
    const sensitive = sensitiveKeys === undefined ? isSecretKeyName(k) : sensitiveKeys.has(k)
    out[k] = sensitive ? replacement : v
  }
  return out
}
