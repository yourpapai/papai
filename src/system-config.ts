// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { systemConfig } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'system-config' })

export type SystemConfigKey = 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model' | 'embedding_model'

export const SYSTEM_CONFIG_KEYS: readonly SystemConfigKey[] = [
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
  'embedding_model',
]

const REQUIRED_KEYS: readonly SystemConfigKey[] = ['llm_apikey', 'llm_baseurl', 'main_model']

const ENV_KEY_BY_CONFIG_KEY: Readonly<Record<SystemConfigKey, string>> = {
  llm_apikey: 'LLM_API_KEY',
  llm_baseurl: 'LLM_BASE_URL',
  main_model: 'MAIN_MODEL',
  small_model: 'SMALL_MODEL',
  embedding_model: 'EMBEDDING_MODEL',
}

const cache = new Map<SystemConfigKey, string>()

export const getSystemConfig = (key: SystemConfigKey): string | null => cache.get(key) ?? null

export const setSystemConfig = (key: SystemConfigKey, value: string, updatedBy: string): void => {
  const updatedAt = Date.now()
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key, value, updatedAt, updatedBy })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
    })
    .run()
  cache.set(key, value)
  log.info({ key, updatedBy }, 'system_config key set')
}

const isSystemConfigKey = (value: string): value is SystemConfigKey =>
  (SYSTEM_CONFIG_KEYS as readonly string[]).includes(value)

export const primeSystemConfigCache = (): void => {
  cache.clear()
  const rows = getDrizzleDb().select().from(systemConfig).all()
  for (const row of rows) {
    if (isSystemConfigKey(row.key)) cache.set(row.key, row.value)
  }
  log.debug({ keys: rows.length }, 'system_config cache primed')
}

export const seedSystemConfigFromEnv = (): void => {
  primeSystemConfigCache()
  let seeded = 0
  for (const key of SYSTEM_CONFIG_KEYS) {
    if (cache.has(key)) continue
    const envName = ENV_KEY_BY_CONFIG_KEY[key]
    const envValue = process.env[envName]
    if (envValue === undefined || envValue.trim() === '') continue
    setSystemConfig(key, envValue.trim(), 'env')
    seeded += 1
  }
  log.info({ seeded, totalKeys: cache.size }, 'system_config env seed complete')
}

export const isSystemConfigComplete = (): boolean => REQUIRED_KEYS.every((key) => cache.has(key))

export const missingSystemConfigKeys = (): SystemConfigKey[] => REQUIRED_KEYS.filter((key) => !cache.has(key))

export const maskSystemConfigValue = (key: SystemConfigKey, value: string): string => {
  if (key === 'llm_apikey') return `****${value.slice(-4)}`
  return value
}

export type SystemConfigEntry = {
  key: SystemConfigKey
  value: string
  updatedAt: number
  updatedBy: string
}

export const listSystemConfigEntries = (): SystemConfigEntry[] => {
  const rows = getDrizzleDb().select().from(systemConfig).all()
  const entries: SystemConfigEntry[] = []
  for (const row of rows) {
    if (!isSystemConfigKey(row.key)) continue
    entries.push({ key: row.key, value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy })
  }
  return entries
}

/**
 * Test-only helper: clear the in-process cache so tests start from a known state
 * without going through a process restart.
 */
export const resetSystemConfigCacheForTesting = (): void => {
  cache.clear()
}
