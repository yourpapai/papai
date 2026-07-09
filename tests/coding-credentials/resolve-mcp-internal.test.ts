// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { setMcpPluginServerConfigs } from '../../src/coding-credentials/mcp-plugin-servers.js'
import { resolveMcp, resolveMcpToken } from '../../src/coding-credentials/resolve-agent-secrets.js'
import { updateCodingCredentials } from '../../src/coding-credentials/store.js'
import { verifyPluginMcpToken } from '../../src/mcp-server/token.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

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

const MCP_PI = 'pi-mcp-internal'
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

test('resolveMcp returns a derived internal entry (no token in vault) for an enabled plugin server', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'allow' }])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: INTERNAL_SERVER }, 'user-int')

  expect(resolveMcp(MCP_CTX, 'user-int')).toEqual({
    url: 'https://bot.example.com/mcp/plugin/synthetic-web-search',
    host: 'bot.example.com',
    header: 'Authorization',
    allowedHosts: ['bot.example.com'],
    toolPolicy: { default: 'allow', tools: undefined },
  })
})

test('resolveMcpToken mints a verifiable token for an internal plugin server', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'allow' }])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: INTERNAL_SERVER }, 'user-int')

  const token = resolveMcpToken(MCP_CTX, 'user-int')
  expect(token).toBeDefined()
  const claims = verifyPluginMcpToken(token!)
  expect(claims).toEqual({
    storageContextId: MCP_CTX,
    chatUserId: 'user-int',
    pluginId: PLUGIN_ID,
  })
})

test('resolveMcp returns null when the plugin is disabled by the operator (fail-closed)', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: false, default_tool_policy: 'allow' }])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: INTERNAL_SERVER }, 'user-int')

  expect(resolveMcp(MCP_CTX, 'user-int')).toBeNull()
})

test('resolveMcp returns null when SETTINGS_PUBLIC_BASE_URL is unset (fail-closed)', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'allow' }])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: INTERNAL_SERVER }, 'user-int')
  delete process.env['SETTINGS_PUBLIC_BASE_URL']

  expect(resolveMcp(MCP_CTX, 'user-int')).toBeNull()
})

test('resolveMcpToken returns undefined for a disabled internal plugin server (fail-closed)', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: false, default_tool_policy: 'allow' }])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: INTERNAL_SERVER }, 'user-int')

  expect(resolveMcpToken(MCP_CTX, 'user-int')).toBeUndefined()
})

test('resolveMcpToken returns undefined when SETTINGS_PUBLIC_BASE_URL is unset (fail-closed)', () => {
  activatePlugin()
  setMcpPluginServerConfigs(MCP_PI, [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'allow' }])
  updateCodingCredentials(MCP_CTX, 'mcp', { server: INTERNAL_SERVER }, 'user-int')
  delete process.env['SETTINGS_PUBLIC_BASE_URL']

  expect(resolveMcpToken(MCP_CTX, 'user-int')).toBeUndefined()
})
