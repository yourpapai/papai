// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  disableByokForContext,
  enableByokForContext,
  getByokCredentialState,
  getByokLlmConfig,
  listByokAdminSummaries,
  updateByokLlmConfig,
} from '../../src/byok-llm/store.js'
import { byokLlmCredentials } from '../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const originalKey = process.env['INSTANCE_CONFIG_KEY']

const completeConfig = {
  llm_apikey: 'sk-byok-recovered',
  llm_baseurl: 'https://byok.invalid/v1',
  main_model: 'byok-main',
}

const insertCorruptedByokRow = (contextId: string): void => {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({
      contextId,
      enabled: true,
      encryptedConfig: 'not-base64',
      updatedAt: Date.now(),
      updatedBy: 'seed-user',
    })
    .run()
}

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'c'.repeat(64)
  await setupTestDb()
})

afterEach(() => {
  if (originalKey === undefined) delete process.env['INSTANCE_CONFIG_KEY']
  else process.env['INSTANCE_CONFIG_KEY'] = originalKey
})

describe('byok-llm store', () => {
  test('enable creates an incomplete enabled row with missing required keys', () => {
    enableByokForContext('ctx-1', 'admin-1')

    expect(getByokCredentialState('ctx-1')).toEqual({
      enabled: true,
      complete: false,
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
    })
  })

  test('update after enable stores encrypted config and completes credential state', () => {
    enableByokForContext('ctx-1', 'admin-1')
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: 'sk-byok-1234', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )

    const raw = getDrizzleDb().select().from(byokLlmCredentials).get()
    expect(raw?.encryptedConfig).not.toBeNull()
    expect(raw?.encryptedConfig).not.toContain('sk-byok-1234')
    expect(getByokLlmConfig('ctx-1')).toEqual({
      llm_apikey: 'sk-byok-1234',
      llm_baseurl: 'https://byok.invalid/v1',
      main_model: 'byok-main',
    })
    expect(getByokCredentialState('ctx-1')).toEqual({ enabled: true, complete: true, missing: [] })
  })

  test('disable keeps encrypted config but state is disabled', () => {
    enableByokForContext('ctx-1', 'admin-1')
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )
    const beforeDisable = getDrizzleDb().select().from(byokLlmCredentials).get()?.encryptedConfig

    disableByokForContext('ctx-1', 'admin-2')

    const afterDisable = getDrizzleDb().select().from(byokLlmCredentials).get()?.encryptedConfig
    expect(afterDisable).toBe(beforeDisable)
    expect(getByokCredentialState('ctx-1')).toEqual({ enabled: false, complete: false, missing: [] })
    expect(getByokLlmConfig('ctx-1')).toEqual({
      llm_apikey: 'sk-byok',
      llm_baseurl: 'https://byok.invalid/v1',
      main_model: 'byok-main',
    })
  })

  test('admin summaries expose metadata without decrypted secrets', () => {
    enableByokForContext('ctx-1', 'admin-1')
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: 'sk-byok-9999', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )

    const summaries = listByokAdminSummaries()
    expect(summaries).toHaveLength(1)
    const summary = summaries[0]
    expect(summary).toBeDefined()
    expect(typeof summary?.updatedAt).toBe('number')
    expect(summary).toMatchObject({
      contextId: 'ctx-1',
      enabled: true,
      complete: true,
      missing: [],
      updatedBy: 'user-1',
    })
    expect(JSON.stringify(summaries)).not.toContain('sk-byok-9999')
  })

  test('update merges fields and ignores empty values', () => {
    enableByokForContext('ctx-1', 'admin-1')
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: 'sk-byok-original', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )

    updateByokLlmConfig('ctx-1', { small_model: 'small', llm_apikey: '' }, 'user-2')

    expect(getByokLlmConfig('ctx-1')).toEqual({
      llm_apikey: 'sk-byok-original',
      llm_baseurl: 'https://byok.invalid/v1',
      main_model: 'byok-main',
      small_model: 'small',
    })
  })

  test('credential state and config tolerate unreadable encrypted payloads', () => {
    insertCorruptedByokRow('ctx-bad')

    expect(getByokCredentialState('ctx-bad')).toMatchObject({
      enabled: true,
      complete: false,
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
      unreadable: true,
    })
    expect(typeof getByokCredentialState('ctx-bad').error).toBe('string')
    expect(getByokLlmConfig('ctx-bad')).toBeNull()
  })

  test('admin summaries include unreadable rows without exposing secrets or payloads', () => {
    insertCorruptedByokRow('ctx-bad')

    const summaries = listByokAdminSummaries()

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      contextId: 'ctx-bad',
      enabled: true,
      complete: false,
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
      unreadable: true,
      updatedBy: 'seed-user',
    })
    expect(typeof summaries[0]?.error).toBe('string')
    expect(JSON.stringify(summaries)).not.toContain('not-base64')
    expect(JSON.stringify(summaries)).not.toContain('sk-byok')
  })

  test('update overwrites unreadable payloads with submitted complete config', () => {
    insertCorruptedByokRow('ctx-bad')

    updateByokLlmConfig('ctx-bad', completeConfig, 'user-1')

    expect(getByokLlmConfig('ctx-bad')).toEqual(completeConfig)
    expect(getByokCredentialState('ctx-bad')).toEqual({ enabled: true, complete: true, missing: [] })
  })
})
