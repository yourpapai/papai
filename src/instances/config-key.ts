// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scryptSync } from 'node:crypto'
import { homedir, hostname } from 'node:os'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'instances:config-key' })

const PASSPHRASE_SALT = 'papai:instance-config:passphrase:v1'
const HOST_FALLBACK_SALT = 'papai:instance-config:host-fallback:v1'
const HOST_FALLBACK_WARNING =
  'INSTANCE_CONFIG_KEY is unset; using host-local fallback. DB copies are not portable; production must set INSTANCE_CONFIG_KEY.'

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

// scryptSync costs ~25ms per call by design; resolve* runs on every config
// encrypt/decrypt, so derivation is memoized per (salt, secret). The cached
// Buffer is shared — callers must treat it as read-only.
const derivedKeyCache = new Map<string, Buffer>()

const deriveKey = (secret: string, salt: string): Buffer => {
  const cacheKey = `${salt}\0${secret}`
  const cached = derivedKeyCache.get(cacheKey)
  if (cached !== undefined) return cached
  const key = scryptSync(secret, salt, 32)
  derivedKeyCache.set(cacheKey, key)
  return key
}

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
