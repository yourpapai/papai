// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { decryptSecretPayload, encryptSecretPayload } from '../secret-payload-crypto.js'
import type { InstanceConfig } from './types.js'

export {
  resolveInstanceConfigKey,
  resolveInstanceConfigKeyInfo,
  type InstanceConfigKeyDeps,
  type InstanceConfigKeyInfo,
  type InstanceConfigKeyMode,
} from './config-key.js'

const SECRET_KEY_PATTERN = /token|key|secret|password|cookie/iu

export const encryptInstanceConfig = (plain: InstanceConfig): string => encryptSecretPayload(plain)

export const decryptInstanceConfig = (encoded: string): InstanceConfig => decryptSecretPayload(encoded)

/** True when a config key name looks secret-bearing (token, key, secret, password, cookie). */
export const isSecretKeyName = (key: string): boolean => SECRET_KEY_PATTERN.test(key)

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
