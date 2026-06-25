// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { resolveAgentSecrets } from '../../src/coding-credentials/resolve-agent-secrets.js'
import { updateCodingCredentials } from '../../src/coding-credentials/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const STORAGE_CTX = 'pi:telegram:ctx:user-9'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  await setupTestDb()
})
afterEach(() => {
  delete process.env['INSTANCE_CONFIG_KEY']
})

test('returns null when no api key configured', () => {
  expect(resolveAgentSecrets(STORAGE_CTX)).toBeNull()
})

test('maps the stored key to ANTHROPIC_API_KEY', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-ant-1' }, 'user-9')
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-1' })
})

test('includes ANTHROPIC_BASE_URL when set', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider_api_key: 'sk-ant-1', provider_base_url: 'https://proxy.example' },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({
    ANTHROPIC_API_KEY: 'sk-ant-1',
    ANTHROPIC_BASE_URL: 'https://proxy.example',
  })
})
