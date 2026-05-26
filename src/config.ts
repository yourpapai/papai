// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig, setCachedConfig } from './cache.js'
import { getConfigKeysForContext } from './config-keys.js'
import { logger } from './logger.js'
import { ALL_CONFIG_KEYS, type ConfigKey } from './types/config.js'
import { normalizeTimezoneValue } from './utils/timezone.js'

const log = logger.child({ scope: 'config' })

const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set(['kaneo_apikey', 'youtrack_token'])

function normalizeConfigValue(key: ConfigKey, value: string): string {
  if (key !== 'timezone') return value
  return normalizeTimezoneValue(value) ?? value.trim()
}

function readConfigValue(key: ConfigKey, value: string | null): string | null {
  if (value === null || key !== 'timezone') return value
  return normalizeTimezoneValue(value) ?? value.trim()
}

export function isSensitiveKey(key: ConfigKey): boolean {
  return SENSITIVE_KEYS.has(key)
}

export function setConfig(userId: string, key: ConfigKey, value: string): void {
  log.debug({ userId, key }, 'setConfig called')
  setCachedConfig(userId, key, normalizeConfigValue(key, value))
  log.info({ userId, key }, 'Config key set (DB sync in background)')
}

export function getConfig(userId: string, key: ConfigKey): string | null {
  log.debug({ userId, key }, 'getConfig called')
  return readConfigValue(key, getCachedConfig(userId, key))
}

export function isConfigKey(key: string): key is ConfigKey {
  // Use the canonical list from types/config.ts via ALL_CONFIG_KEYS
  return (ALL_CONFIG_KEYS as readonly string[]).includes(key)
}

export function getAllConfig(userId: string): Partial<Record<ConfigKey, string>> {
  log.debug({ userId }, 'getAllConfig called')
  const result: Partial<Record<ConfigKey, string>> = {}
  for (const key of getConfigKeysForContext(userId)) {
    const value = readConfigValue(key, getCachedConfig(userId, key))
    if (value !== null) {
      result[key] = value
    }
  }
  return result
}

export function getPluginConfigStorageKey(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`
}

export function getPluginConfig(contextId: string, pluginId: string, key: string): string | null {
  return getCachedConfig(contextId, getPluginConfigStorageKey(pluginId, key))
}

export function setPluginConfig(contextId: string, pluginId: string, key: string, value: string): void {
  setCachedConfig(contextId, getPluginConfigStorageKey(pluginId, key), value)
}

export function maskValue(key: ConfigKey, value: string): string {
  if (SENSITIVE_KEYS.has(key)) {
    const last4 = value.slice(-4)
    return `****${last4}`
  }
  return value
}
