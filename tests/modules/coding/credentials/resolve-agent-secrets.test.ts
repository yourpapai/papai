// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { addAuthorizedGroup } from '../../../../src/authorized-groups.js'
import {
  getConfigContextIdFromStorageContextId,
  toScopedContextId,
  toScopedThreadContextId,
} from '../../../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../../../src/db/drizzle.js'
import { authorizedGroups } from '../../../../src/db/schema.js'
import {
  adminCodingGuardrailsContextId,
  setCodingGuardrails,
} from '../../../../src/modules/coding/credentials/guardrails.js'
import {
  resolveAgent,
  resolveAgentSecrets,
  resolveForge,
  resolveForgeToken,
  resolveModel,
  resolveProviderHost,
} from '../../../../src/modules/coding/credentials/resolve-agent-secrets.js'
import { updateCodingCredentials } from '../../../../src/modules/coding/credentials/store.js'
import { mockLogger, setupTestDb } from '../../../utils/test-helpers.js'

const STORAGE_CTX = 'pi:telegram:ctx:user-9'
// STORAGE_CTX is not parseable (non-standard format) → pi === undefined → legacy path unchanged

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  await setupTestDb()
})
afterEach(() => {
  delete process.env['INSTANCE_CONFIG_KEY']
})

test('returns null when no api key configured', () => {
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toBeNull()
})

test('maps the stored key to ANTHROPIC_API_KEY when provider is anthropic', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ant-1' },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toEqual({
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
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toEqual({
    OPENAI_API_KEY: 'sk-o',
  })
})

test('defaults to anthropic env when provider field absent', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-ant-1' }, 'user-9')
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toEqual({
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
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toEqual({
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
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toEqual({
    OPENAI_API_KEY: 'sk-o',
    OPENAI_BASE_URL: 'https://openai-proxy.example',
  })
})

test('reads credentials at the acting user context when called with a thread-scoped storage context id (initiator policy)', () => {
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'pi-test',
    nativeContextId: 'group-42',
    threadId: 'thread-7',
  })
  // With initiator policy (default), identityContext resolves to the acting user's personal context,
  // not the group config-context. Store creds at the user's context.
  const userContextId = toScopedContextId({ platformInstanceId: 'pi-test', nativeContextId: 'user-9' })
  updateCodingCredentials(
    userContextId,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ant-thread' },
    'user-9',
  )
  expect(resolveAgentSecrets(threadContextId, 'user-9')).toEqual({
    ANTHROPIC_API_KEY: 'sk-ant-thread',
  })
})

test('resolveForgeToken returns the stored forge token, or null when absent', () => {
  expect(resolveForgeToken(STORAGE_CTX, 'user-9')).toBeNull()
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_1' }, 'user-9')
  expect(resolveForgeToken(STORAGE_CTX, 'user-9')).toBe('ghp_1')
})

test('resolveAgent returns the stored agent or null when absent', () => {
  expect(resolveAgent(STORAGE_CTX, 'user-9')).toBeNull()
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { agent: 'codex', provider_api_key: 'sk-o' }, 'user-9')
  expect(resolveAgent(STORAGE_CTX, 'user-9')).toBe('codex')
})

test('resolveAgent returns null when agent field is absent', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-1' }, 'user-9')
  expect(resolveAgent(STORAGE_CTX, 'user-9')).toBeNull()
})

test('resolveForge returns null when no forge vault stored', () => {
  expect(resolveForge(STORAGE_CTX, 'user-9')).toBeNull()
})

test('resolveForge returns gitlab kind and derived apiBaseUrl for gitlab-self-hosted vault', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'forge',
    { kind: 'gitlab-self-hosted', instance_url: 'https://gl.corp.com', forge_token: 'glpat-1' },
    'user-9',
  )
  expect(resolveForge(STORAGE_CTX, 'user-9')).toEqual({ kind: 'gitlab', apiBaseUrl: 'https://gl.corp.com/api/v4' })
})

test('resolveForge defaults to github SaaS for a legacy token-only vault', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { forge_token: 'ghp_legacy' }, 'user-9')
  expect(resolveForge(STORAGE_CTX, 'user-9')).toEqual({ kind: 'github', apiBaseUrl: 'https://api.github.com' })
})

test('resolveForge returns github kind and apiBaseUrl for a typed github vault', () => {
  updateCodingCredentials(STORAGE_CTX, 'forge', { kind: 'github', forge_token: 'ghp_1' }, 'user-9')
  expect(resolveForge(STORAGE_CTX, 'user-9')).toEqual({ kind: 'github', apiBaseUrl: 'https://api.github.com' })
})

test('resolveForge returns null for a partial self-hosted vault (instance_url present, kind missing)', () => {
  // A vault carrying an instance_url but no kind is an inconsistent partial save
  // (e.g. the UI persisted instance_url + token but the kind never saved). Refuse
  // rather than silently mis-deriving GitHub SaaS and ignoring the instance_url —
  // that previously pushed a GitLab PAT at api.github.com and 401'd.
  updateCodingCredentials(
    STORAGE_CTX,
    'forge',
    { instance_url: 'https://gl.corp.com', forge_token: 'glpat-1' },
    'user-9',
  )
  expect(resolveForge(STORAGE_CTX, 'user-9')).toBeNull()
})

// MCP resolution (resolveMcpServers/resolveMcpTokens) is covered by
// tests/modules/coding/credentials/resolve-mcp-servers.test.ts.

test('resolveProviderHost returns null when no credentials stored', () => {
  expect(resolveProviderHost(STORAGE_CTX, 'user-9')).toBeNull()
})

test('resolveProviderHost returns api.anthropic.com for anthropic provider', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ant-1' },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX, 'user-9')).toBe('api.anthropic.com')
})

test('resolveProviderHost returns api.openai.com for openai provider', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'openai', agent: 'codex', provider_api_key: 'sk-o' },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX, 'user-9')).toBe('api.openai.com')
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
  expect(resolveProviderHost(STORAGE_CTX, 'user-9')).toBe('llm.corp.com')
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
  expect(resolveProviderHost(STORAGE_CTX, 'user-9')).toBe('proxy.example')
})

test('resolveProviderHost returns null for openai-compatible without a base URL', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'openai-compatible', agent: 'opencode', provider_api_key: 'sk-c' },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX, 'user-9')).toBeNull()
})

test('resolveProviderHost returns null when provider_base_url is malformed (parse error)', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    {
      provider: 'openai-compatible',
      agent: 'opencode',
      provider_api_key: 'sk-c',
      provider_base_url: 'not-a-url',
    },
    'user-9',
  )
  expect(resolveProviderHost(STORAGE_CTX, 'user-9')).toBeNull()
})

// force-shared-key tests

const PI_1 = 'pi-1'
const SCOPED_STORAGE_CTX = toScopedContextId({ platformInstanceId: PI_1, nativeContextId: 'group-42' })
const ADMIN_CTX = adminCodingGuardrailsContextId(PI_1)
const USER_CTX = getConfigContextIdFromStorageContextId(SCOPED_STORAGE_CTX)

test('forceSharedKey:true — resolveAgentSecrets returns the shared (admin) key, not the user key', () => {
  setCodingGuardrails(PI_1, {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: true,
    maxMcpServers: 3,
  })
  updateCodingCredentials(
    ADMIN_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-shared' },
    'admin',
  )
  updateCodingCredentials(
    USER_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-user' },
    'user-9',
  )
  expect(resolveAgentSecrets(SCOPED_STORAGE_CTX, 'group-42')).toEqual({ ANTHROPIC_API_KEY: 'sk-shared' })
})

test('forceSharedKey:true — resolveProviderHost returns the shared (admin) host, not the user host', () => {
  setCodingGuardrails(PI_1, {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: true,
    maxMcpServers: 3,
  })
  updateCodingCredentials(
    ADMIN_CTX,
    'agent-provider',
    {
      provider: 'anthropic',
      agent: 'claude',
      provider_api_key: 'sk-shared',
      provider_base_url: 'https://shared.proxy.example',
    },
    'admin',
  )
  updateCodingCredentials(
    USER_CTX,
    'agent-provider',
    {
      provider: 'anthropic',
      agent: 'claude',
      provider_api_key: 'sk-user',
      provider_base_url: 'https://user.proxy.example',
    },
    'user-9',
  )
  expect(resolveProviderHost(SCOPED_STORAGE_CTX, 'group-42')).toBe('shared.proxy.example')
})

test('forceSharedKey:true — resolveForgeToken still returns the user token (forge stays per-identity)', () => {
  setCodingGuardrails(PI_1, {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: true,
    maxMcpServers: 3,
  })
  updateCodingCredentials(ADMIN_CTX, 'forge', { forge_token: 'ghp-admin-token' }, 'admin')
  updateCodingCredentials(USER_CTX, 'forge', { forge_token: 'ghp-user-token' }, 'user-9')
  expect(resolveForgeToken(SCOPED_STORAGE_CTX, 'group-42')).toBe('ghp-user-token')
})

test('forceSharedKey:false — resolveAgentSecrets returns the user key unchanged', () => {
  setCodingGuardrails(PI_1, {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: false,
    maxMcpServers: 3,
  })
  updateCodingCredentials(
    ADMIN_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-shared' },
    'admin',
  )
  updateCodingCredentials(
    USER_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-user' },
    'user-9',
  )
  expect(resolveAgentSecrets(SCOPED_STORAGE_CTX, 'group-42')).toEqual({ ANTHROPIC_API_KEY: 'sk-user' })
})

test('forceSharedKey:false — resolveProviderHost returns the user host unchanged', () => {
  setCodingGuardrails(PI_1, {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: false,
    maxMcpServers: 3,
  })
  updateCodingCredentials(
    ADMIN_CTX,
    'agent-provider',
    {
      provider: 'anthropic',
      agent: 'claude',
      provider_api_key: 'sk-shared',
      provider_base_url: 'https://shared.proxy.example',
    },
    'admin',
  )
  updateCodingCredentials(
    USER_CTX,
    'agent-provider',
    {
      provider: 'anthropic',
      agent: 'claude',
      provider_api_key: 'sk-user',
      provider_base_url: 'https://user.proxy.example',
    },
    'user-9',
  )
  expect(resolveProviderHost(SCOPED_STORAGE_CTX, 'group-42')).toBe('user.proxy.example')
})

test('non-scoped/legacy context id — sharedKeyContext returns null and resolveAgentSecrets uses the user context', () => {
  // STORAGE_CTX is 'pi:telegram:ctx:user-9' which parseScopedContextId returns null for
  setCodingGuardrails('telegram', {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: true,
    maxMcpServers: 3,
  })
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-legacy-user' },
    'user-9',
  )
  // should NOT use the shared key; legacy context falls back to configContextOf
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toEqual({ ANTHROPIC_API_KEY: 'sk-legacy-user' })
})

// group-session identity tests (A1)

const PI_GROUP = 'pi9'
const GROUP_CTX = toScopedContextId({ platformInstanceId: PI_GROUP, nativeContextId: 'group-1' })
const ALICE_CTX = toScopedContextId({ platformInstanceId: PI_GROUP, nativeContextId: 'alice' })
const BOB_CTX = toScopedContextId({ platformInstanceId: PI_GROUP, nativeContextId: 'bob' })
const GROUP_THREAD_CTX = toScopedThreadContextId({
  platformInstanceId: PI_GROUP,
  nativeContextId: 'group-1',
  threadId: 't1',
})

test("group initiator (default policy): resolveAgentSecrets returns the acting user's creds, not the group's", () => {
  // No coding_identity row set — default is 'initiator'
  addAuthorizedGroup(GROUP_CTX, 'admin')
  updateCodingCredentials(
    GROUP_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-GROUP' },
    'admin',
  )
  updateCodingCredentials(
    ALICE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ALICE' },
    'alice',
  )
  expect(resolveAgentSecrets(GROUP_THREAD_CTX, 'alice')).toEqual({ ANTHROPIC_API_KEY: 'sk-ALICE' })
})

test('group initiator: two users in the same thread each resolve their OWN creds (isolation)', () => {
  addAuthorizedGroup(GROUP_CTX, 'admin')
  updateCodingCredentials(
    GROUP_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-GROUP' },
    'admin',
  )
  updateCodingCredentials(
    ALICE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ALICE' },
    'alice',
  )
  updateCodingCredentials(
    BOB_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-BOB' },
    'bob',
  )
  // Same thread context, different acting users → each gets their own, neither gets the group's.
  expect(resolveAgentSecrets(GROUP_THREAD_CTX, 'alice')).toEqual({ ANTHROPIC_API_KEY: 'sk-ALICE' })
  expect(resolveAgentSecrets(GROUP_THREAD_CTX, 'bob')).toEqual({ ANTHROPIC_API_KEY: 'sk-BOB' })
})

test("group initiator: resolveForgeToken returns the acting user's token", () => {
  addAuthorizedGroup(GROUP_CTX, 'admin')
  updateCodingCredentials(GROUP_CTX, 'forge', { forge_token: 'ghp-GROUP' }, 'admin')
  updateCodingCredentials(ALICE_CTX, 'forge', { forge_token: 'ghp-ALICE' }, 'alice')
  expect(resolveForgeToken(GROUP_THREAD_CTX, 'alice')).toBe('ghp-ALICE')
})

test("group initiator: resolveAgent returns the acting user's agent", () => {
  addAuthorizedGroup(GROUP_CTX, 'admin')
  updateCodingCredentials(GROUP_CTX, 'agent-provider', { agent: 'codex', provider_api_key: 'sk-GROUP' }, 'admin')
  updateCodingCredentials(ALICE_CTX, 'agent-provider', { agent: 'claude', provider_api_key: 'sk-ALICE' }, 'alice')
  expect(resolveAgent(GROUP_THREAD_CTX, 'alice')).toBe('claude')
})

test('group shared policy: resolveAgentSecrets returns the group vault', () => {
  addAuthorizedGroup(GROUP_CTX, 'admin')
  // Set coding_identity = 'shared' directly since setGroupCodingIdentity is deferred to A2
  getDrizzleDb()
    .update(authorizedGroups)
    .set({ codingIdentity: 'shared' })
    .where(eq(authorizedGroups.groupId, GROUP_CTX))
    .run()
  updateCodingCredentials(
    GROUP_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-GROUP' },
    'admin',
  )
  updateCodingCredentials(
    ALICE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ALICE' },
    'alice',
  )
  expect(resolveAgentSecrets(GROUP_THREAD_CTX, 'alice')).toEqual({ ANTHROPIC_API_KEY: 'sk-GROUP' })
})

test("group designated:<u> policy: resolveAgentSecrets returns the designated user's creds", () => {
  addAuthorizedGroup(GROUP_CTX, 'admin')
  getDrizzleDb()
    .update(authorizedGroups)
    .set({ codingIdentity: 'designated:bob' })
    .where(eq(authorizedGroups.groupId, GROUP_CTX))
    .run()
  updateCodingCredentials(
    GROUP_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-GROUP' },
    'admin',
  )
  updateCodingCredentials(
    ALICE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ALICE' },
    'alice',
  )
  updateCodingCredentials(
    BOB_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-BOB' },
    'bob',
  )
  expect(resolveAgentSecrets(GROUP_THREAD_CTX, 'alice')).toEqual({ ANTHROPIC_API_KEY: 'sk-BOB' })
})

test("DM path is byte-identical: resolveAgentSecrets with a DM scoped context uses the user's own creds", () => {
  const dmCtx = toScopedContextId({ platformInstanceId: PI_GROUP, nativeContextId: 'alice' })
  updateCodingCredentials(
    ALICE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ALICE-DM' },
    'alice',
  )
  // For a DM, configContextOf(dmCtx) === dmCtx === ALICE_CTX; no authorized_groups row
  // identityContext returns toScopedContextId({pi, nativeContextId: 'alice'}) === ALICE_CTX
  expect(resolveAgentSecrets(dmCtx, 'alice')).toEqual({ ANTHROPIC_API_KEY: 'sk-ALICE-DM' })
})

test('forceSharedKey:true + initiator policy: provider key from admin, forge from acting user', () => {
  addAuthorizedGroup(GROUP_CTX, 'admin')
  // coding_identity defaults to 'initiator'
  setCodingGuardrails(PI_GROUP, {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: true,
    maxMcpServers: 3,
  })
  const adminCtx = adminCodingGuardrailsContextId(PI_GROUP)
  updateCodingCredentials(
    adminCtx,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ADMIN-SHARED' },
    'admin',
  )
  updateCodingCredentials(
    ALICE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ALICE' },
    'alice',
  )
  updateCodingCredentials(ALICE_CTX, 'forge', { forge_token: 'ghp-ALICE' }, 'alice')
  // resolveAgentSecrets uses sharedKeyContext (admin) → sk-ADMIN-SHARED
  expect(resolveAgentSecrets(GROUP_THREAD_CTX, 'alice')).toEqual({ ANTHROPIC_API_KEY: 'sk-ADMIN-SHARED' })
  // resolveForgeToken uses identityContext (alice) → ghp-ALICE
  expect(resolveForgeToken(GROUP_THREAD_CTX, 'alice')).toBe('ghp-ALICE')
})

test('resolveModel returns the stored model from the identity context', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { agent: 'claude', provider_api_key: 'sk-1', model: 'claude-sonnet-4-6' },
    'user-9',
  )
  expect(resolveModel(STORAGE_CTX, 'user-9')).toBe('claude-sonnet-4-6')
})

test('resolveModel returns null when model is absent', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { agent: 'claude', provider_api_key: 'sk-1' }, 'user-9')
  expect(resolveModel(STORAGE_CTX, 'user-9')).toBeNull()
})

test('resolveModel returns null when model is blank', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { agent: 'claude', provider_api_key: 'sk-1', model: '   ' },
    'user-9',
  )
  expect(resolveModel(STORAGE_CTX, 'user-9')).toBeNull()
})

test('resolveModel returns null when no credentials stored', () => {
  expect(resolveModel(STORAGE_CTX, 'user-9')).toBeNull()
})

test('emits CLAUDE_CODE_OAUTH_TOKEN (and nothing else) for anthropic oauth-subscription', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    {
      provider: 'anthropic',
      agent: 'claude',
      auth_method: 'oauth-subscription',
      provider_api_key: 'sk-ant-oat01-xyz',
      provider_base_url: 'https://ignored.example',
    },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toEqual({
    CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-xyz',
  })
})

test('api-key auth_method keeps the ANTHROPIC_API_KEY mapping', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', auth_method: 'api-key', provider_api_key: 'sk-ant-1' },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX, 'user-9')).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-1' })
})

test('forceSharedKey:true — resolveModel returns the user model, not the shared (admin) model', () => {
  addAuthorizedGroup(GROUP_CTX, 'admin')
  setCodingGuardrails(PI_GROUP, {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: true,
    maxMcpServers: 3,
  })
  const adminCtx = adminCodingGuardrailsContextId(PI_GROUP)
  updateCodingCredentials(
    adminCtx,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ADMIN-SHARED', model: 'admin-model' },
    'admin',
  )
  updateCodingCredentials(
    ALICE_CTX,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ALICE', model: 'alice-model' },
    'alice',
  )
  // resolveModel is identity-context only — forceSharedKey does NOT override it
  expect(resolveModel(GROUP_THREAD_CTX, 'alice')).toBe('alice-model')
})
