// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV, ANALYTICS_HMAC_KEYRING_ENV } from '../config.js'

export type KeyringState =
  | { kind: 'available'; activeVersion: string; activeKey: Buffer; keys: ReadonlyMap<string, Buffer> }
  | { kind: 'unavailable' }
  | { kind: 'invalid' }

const KEY_VERSION_PATTERN = /^v\d+$/u
const HEX_PATTERN = /^[0-9a-fA-F]+$/u
const MIN_KEY_BYTES = 32

const ACTIVE_VERSION = 'v1'

function parseKeyringValue(value: string): KeyringState {
  if (value.trim().length === 0) return { kind: 'unavailable' }

  const entries = value.split(';')
  const keys = new Map<string, Buffer>()

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) continue

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex === -1) return { kind: 'invalid' }

    const version = trimmed.slice(0, separatorIndex).trim()
    const keyHex = trimmed.slice(separatorIndex + 1).trim()

    if (!KEY_VERSION_PATTERN.test(version)) return { kind: 'invalid' }
    if (!HEX_PATTERN.test(keyHex)) return { kind: 'invalid' }

    let key: Buffer
    try {
      key = Buffer.from(keyHex, 'hex')
    } catch {
      return { kind: 'invalid' }
    }

    if (key.byteLength < MIN_KEY_BYTES) return { kind: 'invalid' }
    if (keys.has(version)) return { kind: 'invalid' }

    keys.set(version, key)
  }

  const activeKey = keys.get(ACTIVE_VERSION)
  if (activeKey === undefined) return { kind: 'invalid' }

  return {
    kind: 'available',
    activeVersion: ACTIVE_VERSION,
    activeKey,
    keys,
  }
}

function readEnvValue(name: string): string {
  const value = process.env[name]
  return value ?? ''
}

export function parseAnalyticsKeyring(envValue?: string): KeyringState {
  const value = envValue ?? readEnvValue(ANALYTICS_HMAC_KEYRING_ENV)
  return parseKeyringValue(value)
}

export function parseGovernanceKeyring(envValue?: string): KeyringState {
  const value = envValue ?? readEnvValue(ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV)
  return parseKeyringValue(value)
}
