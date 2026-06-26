// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import {
  resolveAgent,
  resolveAgentSecrets,
  resolveForge,
  resolveForgeToken,
  resolveProviderHost,
} from '../../src/coding-credentials/resolve-agent-secrets.js'
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

test('maps the stored key to ANTHROPIC_API_KEY when provider is anthropic', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ant-1' },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({
    ANTHROPIC_API_KEY: 'sk-ant-1',
  })
})

test('maps the stored key to OPENAI_API_KEY when provider is openai', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'openai', agent: 'codex', provider_api_key: 'sk-o' },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({
    OPENAI_API_KEY: 'sk-o',
  })
})

test('defaults to anthropic env when provider field absent', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-ant-1' }, 'user-9')
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({
    ANTHROPIC_API_KEY: 'sk-ant-1',
  })
})

test('includes ANTHROPIC_BASE_URL when set for anthropic provider', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    {
      provider: 'anthropic',
      agent: 'claude',
      provider_api_key: 'sk-ant-1',
      provider_base_url: 'https://proxy.example',
    },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({
    ANTHROPIC_API_KEY: 'sk-ant-1',
    ANTHROPIC_BASE_URL: 'https://proxy.example',
  })
})

test('includes OPENAI_BASE_URL when set for openai provider', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    {
      provider: 'openai',
      agent: 'codex',
      provider_api_key: 'sk-o',
      provider_base_url: 'https://openai-proxy.example',
    },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({
    OPENAI_API_KEY: 'sk-o',
    OPENAI_BASE_URL: 'https://openai-proxy.example',
  })
})

test('reads credentials at config-context when called with a thread-scoped storage context id', () => {
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'pi-test',
    nativeContextId: 'group-42',
    threadId: 'thread-7',
  })
  const configContextId = getConfigContextIdFromStorageContextId(threadContextId)
  updateCodingCredentials(
    configContextId,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ant-thread' },
    'user-9',
  )
  expect(resolveAgentSecrets(threadContextId)).toEqual({
    ANTHROPIC_API_KEY: 'sk-ant-thread',
  })
})

test('resolveForgeToken returns the stored forge token, or null when absent', () => {
  expect(resolveForgeToken(STORAGE_CTX)).toBeNull()
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_1' }, 'user-9')
  expect(resolveForgeToken(STORAGE_CTX)).toBe('ghp_1')
})

test('resolveAgent returns the stored agent or null when absent', () => {
  expect(resolveAgent(STORAGE_CTX)).toBeNull()
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { agent: 'codex', provider_api_key: 'sk-o' }, 'user-9')
  expect(resolveAgent(STORAGE_CTX)).toBe('codex')
})

test('resolveAgent returns null when agent field is absent', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-1' }, 'user-9')
  expect(resolveAgent(STORAGE_CTX)).toBeNull()
})

test('resolveForge returns null when no forge vault stored', () => {
  expect(resolveForge(STORAGE_CTX)).toBeNull()
})

test('resolveForge returns gitlab kind and derived apiBaseUrl for gitlab-self-hosted vault', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'forge',
    { kind: 'gitlab-self-hosted', instance_url: 'https://gl.corp.com', forge_token: 'glpat-1' },
    'user-9',
  )
  expect(resolveForge(STORAGE_CTX)).toEqual({ kind: 'gitlab', apiBaseUrl: 'https://gl.corp.com/api/v4' })
})

test('resolveForge defaults to github SaaS for a legacy token-only vault', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_legacy' }, 'user-9')
  expect(resolveForge(STORAGE_CTX)).toEqual({ kind: 'github', apiBaseUrl: 'https://api.github.com' })
})

test('resolveForge returns github kind and apiBaseUrl for a typed github vault', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { kind: 'github', forge_token: 'ghp_1' }, 'user-9')
  expect(resolveForge(STORAGE_CTX)).toEqual({ kind: 'github', apiBaseUrl: 'https://api.github.com' })
})

test('resolveProviderHost returns null when no credentials stored', () => {
  expect(resolveProviderHost(STORAGE_CTX)).toBeNull()
})

test('resolveProviderHost returns api.anthropic.com for anthropic provider', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ant-1' },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX)).toBe('api.anthropic.com')
})

test('resolveProviderHost returns api.openai.com for openai provider', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'openai', agent: 'codex', provider_api_key: 'sk-o' },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX)).toBe('api.openai.com')
})

test('resolveProviderHost returns the host from provider_base_url when set', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    {
      provider: 'openai-compatible',
      agent: 'opencode',
      provider_api_key: 'sk-c',
      provider_base_url: 'https://llm.corp.com/v1',
    },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX)).toBe('llm.corp.com')
})

test('resolveProviderHost returns host from base URL even for anthropic with a custom base', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    {
      provider: 'anthropic',
      agent: 'claude',
      provider_api_key: 'sk-ant-1',
      provider_base_url: 'https://proxy.example/v1',
    },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX)).toBe('proxy.example')
})

test('resolveProviderHost returns null for openai-compatible without a base URL', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'openai-compatible', agent: 'opencode', provider_api_key: 'sk-c' },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX)).toBeNull()
})
