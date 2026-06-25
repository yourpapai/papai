// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  clearCodingCredentials,
  getCodingCredentialState,
  getCodingCredentials,
  updateCodingCredentials,
} from '../../src/coding-credentials/store.js'
import { codingSessionCredentials } from '../../src/db/coding-credentials-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'pi:telegram:ctx:user-1'
const NS = 'agent-provider' as const

const insertCorruptedCredentialRow = (contextId: string, namespace: typeof NS): void => {
  getDrizzleDb()
    .insert(codingSessionCredentials)
    .values({
      contextId,
      namespace,
      encryptedConfig: 'not-base64',
      updatedAt: Date.now(),
      updatedBy: 'seed-user',
    })
    .run()
}

describe('coding-credentials store', () => {
  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
    await setupTestDb()
  })
  afterEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
  })

  test('unconfigured context reports not configured', () => {
    const state = getCodingCredentialState(CTX, NS)
    expect(state.configured).toBe(false)
    expect(state.complete).toBe(false)
    expect(state.missing).toEqual(['provider_api_key'])
    expect(getCodingCredentials(CTX, NS)).toBeNull()
  })

  test('round-trips an encrypted api key and reports complete', () => {
    updateCodingCredentials(CTX, NS, { provider_api_key: 'sk-ant-xyz' }, 'user-1')
    const state = getCodingCredentialState(CTX, NS)
    expect(state.configured).toBe(true)
    expect(state.complete).toBe(true)
    expect(state.missing).toEqual([])
    expect(getCodingCredentials(CTX, NS)).toEqual({ provider_api_key: 'sk-ant-xyz' })
  })

  test('merges fields and clears with empty string', () => {
    updateCodingCredentials(CTX, NS, { provider_api_key: 'sk-1', provider_base_url: 'https://p.example' }, 'user-1')
    updateCodingCredentials(CTX, NS, { provider_base_url: '' }, 'user-1')
    expect(getCodingCredentials(CTX, NS)).toEqual({ provider_api_key: 'sk-1' })
  })

  test('clear removes the row', () => {
    updateCodingCredentials(CTX, NS, { provider_api_key: 'sk-1' }, 'user-1')
    clearCodingCredentials(CTX, NS, 'user-1')
    expect(getCodingCredentialState(CTX, NS).configured).toBe(false)
  })

  test('is keyed per context', () => {
    updateCodingCredentials(CTX, NS, { provider_api_key: 'sk-1' }, 'user-1')
    expect(getCodingCredentialState('pi:telegram:ctx:user-2', NS).configured).toBe(false)
  })

  test('credential state and credentials tolerate unreadable encrypted payloads', () => {
    insertCorruptedCredentialRow('ctx-bad', NS)

    const state = getCodingCredentialState('ctx-bad', NS)
    expect(state.unreadable).toBe(true)
    expect(state.complete).toBe(false)
    expect(state.error).toBeTypeOf('string')
    expect(state.error).toBeTruthy()
    expect(getCodingCredentials('ctx-bad', NS)).toBeNull()
  })
})
