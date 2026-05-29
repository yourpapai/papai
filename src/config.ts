// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clearCachedToolsByPrefix, getCachedConfig, setCachedConfig } from './cache.js'
import { getConfigKeysForContext } from './config-keys.js'
import { logger } from './logger.js'
import { isAllowedDynamicConfigKey, isConfigKey as isKnownConfigKey, type ConfigKey } from './types/config.js'
import { normalizeTimezoneValue } from './utils/timezone.js'

const log = logger.child({ scope: 'config' })

const SENSITIVE_KEYS: ReadonlySet<string> = new Set(['kaneo_apikey', 'youtrack_token'])
const TOOL_ASSEMBLY_CONFIG_KEYS: ReadonlySet<string> = new Set(['mcp_endpoints'])

function clearToolCacheIfToolAssemblyConfig(contextId: string, key: string): void {
  if (TOOL_ASSEMBLY_CONFIG_KEYS.has(key)) clearCachedToolsByPrefix(contextId)
}

function normalizeConfigValue(key: ConfigKey, value: string): string {
  if (key !== 'timezone') return value
  const normalized = normalizeTimezoneValue(value)
  if (normalized !== null) return normalized
  return value.trim()
}

function readConfigValue(key: ConfigKey, value: string | null): string | null {
  if (value === null || key !== 'timezone') return value
  const normalized = normalizeTimezoneValue(value)
  if (normalized !== null) return normalized
  return value.trim()
}

function normalizeDynamicConfigValue(key: string, value: string): string {
  if (key !== 'timezone') return value
  const normalized = normalizeTimezoneValue(value)
  if (normalized !== null) return normalized
  return value.trim()
}

function readDynamicConfigValue(key: string, value: string | null): string | null {
  if (value === null || key !== 'timezone') return value
  const normalized = normalizeTimezoneValue(value)
  if (normalized !== null) return normalized
  return value.trim()
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key)
}

export function setConfig(userId: string, key: ConfigKey, value: string): void {
  log.debug({ userId, key }, 'setConfig called')
  setCachedConfig(userId, key, normalizeConfigValue(key, value))
  clearToolCacheIfToolAssemblyConfig(userId, key)
  log.info({ userId, key }, 'Config key set (DB sync in background)')
}

export function getConfig(userId: string, key: ConfigKey): string | null {
  log.debug({ userId, key }, 'getConfig called')
  return readConfigValue(key, getCachedConfig(userId, key))
}

export function setConfigValue(contextId: string, key: string, value: string): void {
  if (!isAllowedDynamicConfigKey(key)) throw new Error(`Invalid config key: ${key}`)
  log.debug({ contextId, key }, 'setConfigValue called')
  setCachedConfig(contextId, key, normalizeDynamicConfigValue(key, value))
  clearToolCacheIfToolAssemblyConfig(contextId, key)
  log.info({ contextId, key }, 'Config value set (DB sync in background)')
}

export function getConfigValue(contextId: string, key: string): string | null {
  if (!isAllowedDynamicConfigKey(key)) return null
  log.debug({ contextId, key }, 'getConfigValue called')
  return readDynamicConfigValue(key, getCachedConfig(contextId, key))
}

export function isConfigKey(key: string): key is ConfigKey {
  // Use the canonical list from types/config.ts via ALL_CONFIG_KEYS
  return isKnownConfigKey(key)
}

type AllConfig = Partial<Record<ConfigKey, string>> & Partial<Record<string, string>>

export function getAllConfig(userId: string): AllConfig {
  log.debug({ userId }, 'getAllConfig called')
  const result: AllConfig = {}
  for (const key of getConfigKeysForContext(userId)) {
    const value = readDynamicConfigValue(key, getCachedConfig(userId, key))
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
  clearCachedToolsByPrefix(contextId)
}

export function maskValue(key: string, value: string): string {
  if (SENSITIVE_KEYS.has(key)) {
    return maskSensitiveValue(value)
  }
  return value
}

export function maskSensitiveValue(value: string): string {
  return `****${value.slice(-4)}`
}
