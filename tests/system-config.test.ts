// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { systemConfig } from '../src/db/schema.js'
import {
  resetSystemConfigCacheForTesting,
  getSystemConfig,
  isSystemConfigComplete,
  missingSystemConfigKeys,
  primeSystemConfigCache,
  seedSystemConfigFromEnv,
  setSystemConfig,
  SYSTEM_CONFIG_KEYS,
} from '../src/system-config.js'
import { getTestDb, mockLogger, setupTestDb } from './utils/test-helpers.js'

const clearEnv = (): void => {
  delete process.env['LLM_API_KEY']
  delete process.env['LLM_BASE_URL']
  delete process.env['MAIN_MODEL']
  delete process.env['SMALL_MODEL']
  delete process.env['EMBEDDING_MODEL']
}

describe('system-config', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetSystemConfigCacheForTesting()
    clearEnv()
  })

  afterEach(() => {
    clearEnv()
  })

  describe('SYSTEM_CONFIG_KEYS', () => {
    test('lists the five LLM keys', () => {
      expect(SYSTEM_CONFIG_KEYS).toEqual(['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'])
    })
  })

  describe('getSystemConfig', () => {
    test('returns null when key is not set', () => {
      expect(getSystemConfig('llm_apikey')).toBeNull()
    })

    test('returns the value after setSystemConfig', () => {
      setSystemConfig('llm_apikey', 'sk-abc', 'env')
      expect(getSystemConfig('llm_apikey')).toBe('sk-abc')
    })
  })

  describe('setSystemConfig', () => {
    test('writes through to the database', () => {
      setSystemConfig('main_model', 'gpt-5', 'admin-99')
      const rows = getTestDb().select().from(systemConfig).all()
      const main = rows.find((r) => r.key === 'main_model')
      expect(main).toBeDefined()
      expect(main?.value).toBe('gpt-5')
      expect(main?.updatedBy).toBe('admin-99')
      expect(typeof main?.updatedAt).toBe('number')
    })

    test('overwrites an existing row', () => {
      setSystemConfig('main_model', 'gpt-5', 'env')
      setSystemConfig('main_model', 'gpt-6', 'admin-1')
      expect(getSystemConfig('main_model')).toBe('gpt-6')
      const rows = getTestDb().select().from(systemConfig).all()
      expect(rows.filter((r) => r.key === 'main_model')).toHaveLength(1)
    })
  })

  describe('primeSystemConfigCache', () => {
    test('loads existing rows from the database into the cache', () => {
      const db = getTestDb()
      db.insert(systemConfig).values({ key: 'llm_apikey', value: 'sk-pre', updatedAt: 1, updatedBy: 'env' }).run()
      db.insert(systemConfig).values({ key: 'main_model', value: 'gpt-7', updatedAt: 2, updatedBy: 'env' }).run()

      // Cache was reset in beforeEach; ensure values are not yet in cache.
      expect(getSystemConfig('llm_apikey')).toBeNull()

      primeSystemConfigCache()

      expect(getSystemConfig('llm_apikey')).toBe('sk-pre')
      expect(getSystemConfig('main_model')).toBe('gpt-7')
    })

    test('reflects DB state after re-priming', () => {
      const db = getTestDb()
      db.insert(systemConfig).values({ key: 'llm_apikey', value: 'sk-a', updatedAt: 1, updatedBy: 'env' }).run()
      primeSystemConfigCache()
      expect(getSystemConfig('llm_apikey')).toBe('sk-a')

      // External update directly in the DB; cache is stale until re-primed
      db.delete(systemConfig).run()
      db.insert(systemConfig).values({ key: 'llm_apikey', value: 'sk-b', updatedAt: 2, updatedBy: 'env' }).run()
      expect(getSystemConfig('llm_apikey')).toBe('sk-a')

      primeSystemConfigCache()
      expect(getSystemConfig('llm_apikey')).toBe('sk-b')
    })
  })

  describe('seedSystemConfigFromEnv', () => {
    test('inserts rows for each env var that is set', () => {
      process.env['LLM_API_KEY'] = 'sk-env'
      process.env['LLM_BASE_URL'] = 'https://api.example/v1'
      process.env['MAIN_MODEL'] = 'gpt-env'

      seedSystemConfigFromEnv()

      expect(getSystemConfig('llm_apikey')).toBe('sk-env')
      expect(getSystemConfig('llm_baseurl')).toBe('https://api.example/v1')
      expect(getSystemConfig('main_model')).toBe('gpt-env')
      expect(getSystemConfig('small_model')).toBeNull()
      expect(getSystemConfig('embedding_model')).toBeNull()
    })

    test('records updated_by as "env" for seeded rows', () => {
      process.env['LLM_API_KEY'] = 'sk-env'
      seedSystemConfigFromEnv()
      const row = getTestDb()
        .select()
        .from(systemConfig)
        .all()
        .find((r) => r.key === 'llm_apikey')
      expect(row?.updatedBy).toBe('env')
    })

    test('does not overwrite an existing row', () => {
      setSystemConfig('llm_apikey', 'sk-existing', 'admin-1')

      process.env['LLM_API_KEY'] = 'sk-env-different'
      seedSystemConfigFromEnv()

      expect(getSystemConfig('llm_apikey')).toBe('sk-existing')
      const row = getTestDb()
        .select()
        .from(systemConfig)
        .all()
        .find((r) => r.key === 'llm_apikey')
      expect(row?.updatedBy).toBe('admin-1')
    })

    test('skips keys whose env var is unset or empty', () => {
      process.env['LLM_API_KEY'] = ''
      seedSystemConfigFromEnv()
      expect(getSystemConfig('llm_apikey')).toBeNull()
    })

    test('repopulates the in-process cache after seeding', () => {
      process.env['MAIN_MODEL'] = 'gpt-cached'
      seedSystemConfigFromEnv()
      // Without calling primeSystemConfigCache after seeding, the value
      // should still be readable through the cache.
      expect(getSystemConfig('main_model')).toBe('gpt-cached')
    })
  })

  describe('isSystemConfigComplete / missingSystemConfigKeys', () => {
    test('returns false and lists all three required keys when none are set', () => {
      expect(isSystemConfigComplete()).toBe(false)
      expect(missingSystemConfigKeys()).toEqual(['llm_apikey', 'llm_baseurl', 'main_model'])
    })

    test('returns false and lists only the missing ones when some are set', () => {
      setSystemConfig('llm_apikey', 'sk-x', 'env')
      setSystemConfig('main_model', 'gpt-x', 'env')

      expect(isSystemConfigComplete()).toBe(false)
      expect(missingSystemConfigKeys()).toEqual(['llm_baseurl'])
    })

    test('returns true when all three required keys are set', () => {
      setSystemConfig('llm_apikey', 'sk-x', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'gpt-x', 'env')

      expect(isSystemConfigComplete()).toBe(true)
      expect(missingSystemConfigKeys()).toEqual([])
    })

    test('optional keys do not affect completeness', () => {
      setSystemConfig('llm_apikey', 'sk-x', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'gpt-x', 'env')
      // small_model / embedding_model unset

      expect(isSystemConfigComplete()).toBe(true)
    })
  })
})
