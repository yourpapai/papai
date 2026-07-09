// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { setCodingGuardrails } from '../../src/coding-credentials/guardrails.js'
import { setMcpCatalog } from '../../src/coding-credentials/mcp-catalog.js'
import { setMcpPluginServerConfigs } from '../../src/coding-credentials/mcp-plugin-servers.js'
import { serializeMcpSelections } from '../../src/coding-credentials/mcp-selections.js'
import type { ResolveMcpResult } from '../../src/coding-credentials/resolve-agent-secrets.js'
import { resolveMcpServers, resolveMcpTokens } from '../../src/coding-credentials/resolve-agent-secrets.js'
import { updateCodingCredentials } from '../../src/coding-credentials/store.js'
import { verifyPluginMcpToken } from '../../src/mcp-server/token.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function assertOk(result: ResolveMcpResult): asserts result is Extract<ResolveMcpResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`)
}

function assertFail(result: ResolveMcpResult): asserts result is Extract<ResolveMcpResult, { ok: false }> {
  if (result.ok) throw new Error('expected failure, got ok')
}

function makePlugin(overrides: Partial<DiscoveredPlugin['manifest']> = {}): DiscoveredPlugin {
  return {
    manifest: {
      id: 'synthetic-web-search',
      name: 'Synthetic Web Search',
      version: '1.0.0',
      description: 'A test plugin',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
        attachmentTransformers: [],
      },
      permissions: [],
      defaultEnabled: true,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [],
      providerCapabilities: [],
      providerTraits: [],
      providerConfigSchema: [],
      providerContextConfigSchema: [],
      providerAllowedHosts: [],
      mcpServer: true,
      ...overrides,
    },
    pluginDir: '/fake/plugin-dir/synthetic-web-search',
    entryPoint: '/fake/plugin-dir/synthetic-web-search/index.ts',
    manifestHash: 'hash-synthetic-web-search',
  }
}

const MCP_PI = 'pi-mcp-servers'
const MCP_CTX = toScopedContextId({ platformInstanceId: MCP_PI, nativeContextId: 'user-int' })
const PLUGIN_ID = 'synthetic-web-search'
const INTERNAL_SERVER = `plugin:${PLUGIN_ID}`

const originalBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  pluginRegistry.clearForTesting()
  process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
})

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
  else process.env['SETTINGS_PUBLIC_BASE_URL'] = originalBaseUrl
})

function activatePlugin(overrides: Partial<DiscoveredPlugin['manifest']> = {}): void {
  const plugin = makePlugin(overrides)
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
}

test('resolveMcpServers/resolveMcpTokens resolve a mixed internal+external set', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'allow' }])
  setMcpCatalog(MCP_PI, [
    { name: 'github-mcp', upstream_url: 'https://mcp.example.com/v1', default_tool_policy: 'allow' },
  ])
  updateCodingCredentials(
    MCP_CTX,
    'mcp',
    { servers: serializeMcpSelections([{ server: INTERNAL_SERVER }, { server: 'github-mcp', upstream_token: 'sek' }]) },
    'user-int',
  )

  const result = resolveMcpServers(MCP_CTX, 'user-int')
  expect(result.ok).toBe(true)
  assertOk(result)
  expect(result.servers.map((s) => s.id).sort()).toEqual(['github-mcp', INTERNAL_SERVER].sort())
  const external = result.servers.find((s) => s.id === 'github-mcp')
  // host/allowedHosts are derived from the catalog upstream_url, not any stored value;
  // header defaults to 'Authorization' and toolPolicy.default falls back to the catalog entry.
  expect(external?.host).toBe('mcp.example.com')
  expect(external?.allowedHosts).toEqual(['mcp.example.com'])
  expect(external?.header).toBe('Authorization')
  expect(external?.toolPolicy?.default).toBe('allow')

  const tokens = resolveMcpTokens(MCP_CTX, 'user-int')
  expect(tokens['github-mcp']).toBe('sek')
  const internalToken = tokens[INTERNAL_SERVER]
  expect(internalToken).toBeDefined()
  expect(verifyPluginMcpToken(internalToken!)).toEqual({
    storageContextId: MCP_CTX,
    chatUserId: 'user-int',
    pluginId: PLUGIN_ID,
  })
})

test('resolveMcpServers fails closed and names the offending disabled internal server', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: false, default_tool_policy: 'allow' }])
  updateCodingCredentials(
    MCP_CTX,
    'mcp',
    { servers: serializeMcpSelections([{ server: INTERNAL_SERVER }]) },
    'user-int',
  )

  const result = resolveMcpServers(MCP_CTX, 'user-int')
  expect(result.ok).toBe(false)
  assertFail(result)
  expect(result.error).toContain(INTERNAL_SERVER)
})

test('resolveMcpServers fails closed when an external selection is missing its token', () => {
  setMcpCatalog(MCP_PI, [
    { name: 'github-mcp', upstream_url: 'https://mcp.example.com/v1', default_tool_policy: 'allow' },
  ])
  updateCodingCredentials(MCP_CTX, 'mcp', { servers: serializeMcpSelections([{ server: 'github-mcp' }]) }, 'user-int')

  const result = resolveMcpServers(MCP_CTX, 'user-int')
  expect(result.ok).toBe(false)
  assertFail(result)
  expect(result.error).toContain('github-mcp')
})

test('resolveMcpServers fails closed when the count exceeds maxMcpServers', () => {
  setCodingGuardrails(MCP_PI, {
    allowedAgents: ['claude', 'codex', 'opencode'],
    whoMayUse: 'members',
    forceSharedKey: false,
    maxMcpServers: 1,
  })
  setMcpCatalog(MCP_PI, [
    { name: 'github-mcp', upstream_url: 'https://mcp.example.com/v1', default_tool_policy: 'allow' },
    { name: 'jira-mcp', upstream_url: 'https://jira.example.com/v1', default_tool_policy: 'allow' },
  ])
  updateCodingCredentials(
    MCP_CTX,
    'mcp',
    {
      servers: serializeMcpSelections([
        { server: 'github-mcp', upstream_token: 'a' },
        { server: 'jira-mcp', upstream_token: 'b' },
      ]),
    },
    'user-int',
  )

  const result = resolveMcpServers(MCP_CTX, 'user-int')
  expect(result.ok).toBe(false)
  assertFail(result)
  expect(result.error).toContain('max')
})

test('resolveMcpServers/resolveMcpTokens return empty for an empty selection', () => {
  const result = resolveMcpServers(MCP_CTX, 'user-int')
  expect(result).toEqual({ ok: true, servers: [] })
  expect(resolveMcpTokens(MCP_CTX, 'user-int')).toEqual({})
})

test('resolveMcpServers fails closed when SETTINGS_PUBLIC_BASE_URL is unset (internal server not eligible)', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'allow' }])
  updateCodingCredentials(
    MCP_CTX,
    'mcp',
    { servers: serializeMcpSelections([{ server: INTERNAL_SERVER }]) },
    'user-int',
  )
  delete process.env['SETTINGS_PUBLIC_BASE_URL']

  const result = resolveMcpServers(MCP_CTX, 'user-int')
  expect(result.ok).toBe(false)
  assertFail(result)
  expect(result.error).toContain(INTERNAL_SERVER)
})

test('resolveMcpServers fails closed when SETTINGS_PUBLIC_BASE_URL is malformed (unparseable upstream URL)', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'allow' }])
  updateCodingCredentials(
    MCP_CTX,
    'mcp',
    { servers: serializeMcpSelections([{ server: INTERNAL_SERVER }]) },
    'user-int',
  )
  process.env['SETTINGS_PUBLIC_BASE_URL'] = 'not a url'

  const result = resolveMcpServers(MCP_CTX, 'user-int')
  expect(result.ok).toBe(false)
  assertFail(result)
  expect(result.error).toContain(INTERNAL_SERVER)
})

test('resolveMcpServers fails closed on a duplicate selection', () => {
  setMcpCatalog(MCP_PI, [
    { name: 'github-mcp', upstream_url: 'https://mcp.example.com/v1', default_tool_policy: 'allow' },
  ])
  updateCodingCredentials(
    MCP_CTX,
    'mcp',
    {
      servers: serializeMcpSelections([
        { server: 'github-mcp', upstream_token: 'a' },
        { server: 'github-mcp', upstream_token: 'b' },
      ]),
    },
    'user-int',
  )

  const result = resolveMcpServers(MCP_CTX, 'user-int')
  expect(result.ok).toBe(false)
  assertFail(result)
  expect(result.error).toContain('github-mcp')
})
