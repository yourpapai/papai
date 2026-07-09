// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { setMcpCatalog } from '../../src/coding-credentials/mcp-catalog.js'
import { serializeMcpSelections } from '../../src/coding-credentials/mcp-selections.js'
import { updateCodingCredentials } from '../../src/coding-credentials/store.js'
import { buildCodingSecretsFacade } from '../../src/plugins/coding-secrets-facade.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const STORAGE_CTX = 'pi:telegram:ctx:user-3'
// STORAGE_CTX is not parseable (non-standard format) → identityContext returns configContextOf(STORAGE_CTX) = STORAGE_CTX
const CHAT_USER_ID = 'user-3'

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
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolve()).toEqual({ ANTHROPIC_API_KEY: 'sk-1' })
})

test('resolve returns null when not configured', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolve()).toBeNull()
})

test('resolve throws without the coding.secrets permission', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, false, CHAT_USER_ID)
  expect(() => facade.resolve()).toThrow("does not have 'coding.secrets' permission")
})

test('resolveForgeToken via facade; denied without permission', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_1' }, 'user-3')
  expect(buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID).resolveForgeToken()).toBe('ghp_1')
  expect(() => buildCodingSecretsFacade('acp', STORAGE_CTX, false, CHAT_USER_ID).resolveForgeToken()).toThrow(
    "'coding.secrets'",
  )
})

test('resolveAgent returns stored agent when set', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { agent: 'codex', provider_api_key: 'sk-1' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveAgent()).toBe('codex')
})

test('resolveAgent returns null when agent not set', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-1' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveAgent()).toBeNull()
})

test('resolveAgent returns null when no credentials stored', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveAgent()).toBeNull()
})

test('resolveAgent throws without the coding.secrets permission', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, false, CHAT_USER_ID)
  expect(() => facade.resolveAgent()).toThrow("does not have 'coding.secrets' permission")
})

test('resolveForge returns typed forge for a gitlab-self-hosted vault', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'forge',
    { kind: 'gitlab-self-hosted', instance_url: 'https://gl.corp.com', forge_token: 'glpat-1' },
    'user-3',
  )
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveForge()).toEqual({ kind: 'gitlab', apiBaseUrl: 'https://gl.corp.com/api/v4' })
})

test('resolveForge returns github SaaS defaults for a legacy token-only vault', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_legacy' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveForge()).toEqual({ kind: 'github', apiBaseUrl: 'https://api.github.com' })
})

test('resolveForge returns null when no forge vault stored', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveForge()).toBeNull()
})

test('resolveForge throws without the coding.secrets permission', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, false, CHAT_USER_ID)
  expect(() => facade.resolveForge()).toThrow("does not have 'coding.secrets' permission")
})

test('resolveProviderHost returns api.anthropic.com for anthropic provider', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider: 'anthropic', provider_api_key: 'sk-1' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveProviderHost()).toBe('api.anthropic.com')
})

test('resolveProviderHost returns null when no credentials stored', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveProviderHost()).toBeNull()
})

test('resolveProviderHost returns host from base URL for openai-compatible', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'openai-compatible', provider_api_key: 'sk-c', provider_base_url: 'https://llm.corp.com/v1' },
    'user-3',
  )
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true, CHAT_USER_ID)
  expect(facade.resolveProviderHost()).toBe('llm.corp.com')
})

test('resolveProviderHost throws without the coding.secrets permission', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, false, CHAT_USER_ID)
  expect(() => facade.resolveProviderHost()).toThrow("does not have 'coding.secrets' permission")
})

test('resolveMcpServers and resolveMcpTokens via facade; denied without permission', () => {
  // resolveMcpServers is catalog-driven and needs a platform instance to resolve the catalog against,
  // so this test (unlike the others in this file) uses a scoped storage context id rather than
  // the module's non-parseable STORAGE_CTX.
  const pi = 'pi-facade-mcp'
  const mcpCtx = toScopedContextId({ platformInstanceId: pi, nativeContextId: 'user-3' })
  setMcpCatalog(pi, [
    { name: 'Jira', upstream_url: 'https://mcp.example.com/v1', default_tool_policy: 'allow' as const },
  ])
  updateCodingCredentials(
    mcpCtx,
    'mcp',
    { servers: serializeMcpSelections([{ server: 'Jira', upstream_token: 'sek' }]) },
    'user-3',
  )
  const facade = buildCodingSecretsFacade('acp', mcpCtx, true, CHAT_USER_ID)
  expect(facade.resolveMcpServers()).toEqual({
    ok: true,
    servers: [
      {
        id: 'Jira',
        url: 'https://mcp.example.com/v1',
        host: 'mcp.example.com',
        header: 'Authorization',
        allowedHosts: ['mcp.example.com'],
        toolPolicy: { default: 'allow' },
      },
    ],
  })
  expect(facade.resolveMcpTokens()).toEqual({ Jira: 'sek' })
  expect(() => buildCodingSecretsFacade('acp', mcpCtx, false, CHAT_USER_ID).resolveMcpServers()).toThrow(
    "'coding.secrets'",
  )
  expect(() => buildCodingSecretsFacade('acp', mcpCtx, false, CHAT_USER_ID).resolveMcpTokens()).toThrow(
    "'coding.secrets'",
  )
})
