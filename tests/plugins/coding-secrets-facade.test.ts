// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { updateCodingCredentials } from '../../src/coding-credentials/store.js'
import { buildCodingSecretsFacade } from '../../src/plugins/tool-runtime.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const STORAGE_CTX = 'pi:telegram:ctx:user-3'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  await setupTestDb()
})
afterEach(() => {
  delete process.env['INSTANCE_CONFIG_KEY']
})

test('resolve returns mapped secrets when configured', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-1' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolve()).toEqual({ ANTHROPIC_API_KEY: 'sk-1' })
})

test('resolve returns null when not configured', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolve()).toBeNull()
})

test('resolve throws without the coding.secrets permission', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, false)
  expect(() => facade.resolve()).toThrow("does not have 'coding.secrets' permission")
})

test('resolveForgeToken via facade; denied without permission', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_1' }, 'user-3')
  expect(buildCodingSecretsFacade('acp', STORAGE_CTX, true).resolveForgeToken()).toBe('ghp_1')
  expect(() => buildCodingSecretsFacade('acp', STORAGE_CTX, false).resolveForgeToken()).toThrow("'coding.secrets'")
})

test('resolveAgent returns stored agent when set', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { agent: 'codex', provider_api_key: 'sk-1' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolveAgent()).toBe('codex')
})

test('resolveAgent returns null when agent not set', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-1' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolveAgent()).toBeNull()
})

test('resolveAgent returns null when no credentials stored', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolveAgent()).toBeNull()
})

test('resolveAgent throws without the coding.secrets permission', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, false)
  expect(() => facade.resolveAgent()).toThrow("does not have 'coding.secrets' permission")
})

test('resolveForge returns typed forge for a gitlab-self-hosted vault', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'forge',
    { kind: 'gitlab-self-hosted', instance_url: 'https://gl.corp.com', forge_token: 'glpat-1' },
    'user-3',
  )
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolveForge()).toEqual({ kind: 'gitlab', apiBaseUrl: 'https://gl.corp.com/api/v4' })
})

test('resolveForge returns github SaaS defaults for a legacy token-only vault', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_legacy' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolveForge()).toEqual({ kind: 'github', apiBaseUrl: 'https://api.github.com' })
})

test('resolveForge returns null when no forge vault stored', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolveForge()).toBeNull()
})

test('resolveForge throws without the coding.secrets permission', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, false)
  expect(() => facade.resolveForge()).toThrow("does not have 'coding.secrets' permission")
})
