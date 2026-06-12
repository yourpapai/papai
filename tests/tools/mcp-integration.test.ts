// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'
import { jsonSchema } from 'ai'

import { userCachesForTesting } from '../../src/cache.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../src/plugins/types.js'
import { buildProviderlessToolDescriptors, makeTools } from '../../src/tools/index.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CONTEXT = 'test-mcp-integration-user'

mockLogger()

const buildMcpToolSetSpy = mock((_contextId: string): Promise<ToolSet> => Promise.resolve({}))
const buildPluginMcpToolSetSpy = mock(
  (_ids: string[], _desc: unknown, _pool: unknown): Promise<ToolSet> => Promise.resolve({}),
)

function expectTaskProvider(runtimeContext: { taskProvider?: { getTask(taskId: string): Promise<unknown> } }): {
  getTask(taskId: string): Promise<unknown>
} {
  expect(runtimeContext.taskProvider).toBeDefined()
  if (runtimeContext.taskProvider === undefined) throw new Error('Expected taskProvider to be defined')
  return runtimeContext.taskProvider
}

void mock.module('../../src/mcp/user-endpoints.js', () => ({
  buildMcpToolSet: buildMcpToolSetSpy,
}))

void mock.module('../../src/mcp/index.js', () => ({
  buildMcpToolSet: buildMcpToolSetSpy,
  buildPluginMcpToolSet: buildPluginMcpToolSetSpy,
  mcpPool: { getOrCreateFromPlugin: mock(() => Promise.resolve({ hash: 'h', client: {} })) },
  convertMcpToolsToToolSet: mock(() => ({})),
}))

beforeEach(async () => {
  void mock.module('../../src/mcp/user-endpoints.js', () => ({
    buildMcpToolSet: buildMcpToolSetSpy,
  }))
  void mock.module('../../src/mcp/index.js', () => ({
    buildMcpToolSet: buildMcpToolSetSpy,
    buildPluginMcpToolSet: buildPluginMcpToolSetSpy,
    mcpPool: { getOrCreateFromPlugin: mock(() => Promise.resolve({ hash: 'h', client: {} })) },
    convertMcpToolsToToolSet: mock(() => ({})),
  }))
  await setupTestDb()
  userCachesForTesting.delete(CONTEXT)
  pluginRegistry.clearForTesting()
  contributionRegistry.deregister('providerless-safe-plugin')
  contributionRegistry.deregister('providerless-provider-plugin')
  contributionRegistry.deregister('providerless-mcp-plugin')
  contributionRegistry.deregister('provider-backed-mcp-plugin')
  contributionRegistry.deregister('providerless-provider-runtime-mcp-plugin')
  contributionRegistry.deregister('providerless-provider-task-permission-mcp-plugin')
  contributionRegistry.deregister('providerless-required-capabilities-mcp-plugin')
  buildMcpToolSetSpy.mockClear()
  buildMcpToolSetSpy.mockResolvedValue({})
  buildPluginMcpToolSetSpy.mockClear()
  buildPluginMcpToolSetSpy.mockResolvedValue({})
})

afterEach(() => {
  userCachesForTesting.delete(CONTEXT)
  pluginRegistry.clearForTesting()
  contributionRegistry.deregister('providerless-safe-plugin')
  contributionRegistry.deregister('providerless-provider-plugin')
  contributionRegistry.deregister('providerless-mcp-plugin')
  contributionRegistry.deregister('provider-backed-mcp-plugin')
  contributionRegistry.deregister('providerless-provider-runtime-mcp-plugin')
  contributionRegistry.deregister('providerless-provider-task-permission-mcp-plugin')
  contributionRegistry.deregister('providerless-required-capabilities-mcp-plugin')
})

describe('makeTools async + MCP integration', () => {
  test('makeTools returns a Promise', () => {
    const provider = createMockProvider()
    const result = makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(result).toBeInstanceOf(Promise)
  })

  test('makeTools resolves to a ToolSet with built-in tools', async () => {
    const provider = createMockProvider()
    const tools = await makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).toContain('save_memo')
  })

  test('makeTools merges MCP tools from buildMcpToolSet', async () => {
    buildMcpToolSetSpy.mockResolvedValueOnce({
      mcp_server1__remote_search: {
        description: 'Search via MCP',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })

    const provider = createMockProvider()
    const tools = await makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).toContain('mcp_server1__remote_search')
    expect(Object.keys(tools)).toContain('create_task')
  })

  test('makeTools continues when buildMcpToolSet throws', async () => {
    buildMcpToolSetSpy.mockRejectedValueOnce(new Error('MCP connection failed'))

    const provider = createMockProvider()
    const tools = await makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).toContain('create_task')
  })

  test('makeTools still exposes provider-backed plugin MCP tools', async () => {
    const providerBackedMcpPlugin: DiscoveredPlugin = {
      manifest: {
        id: 'provider-backed-mcp-plugin',
        name: 'Provider-Backed MCP Plugin',
        version: '1.0.0',
        description: 'Provider-backed MCP plugin',
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
        permissions: ['tasks.read'],
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [],
        providerCapabilities: [],
        providerTraits: [],
        providerConfigSchema: [],
        providerContextConfigSchema: [],
        providerAllowedHosts: [],
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com/provider-backed' },
      },
      pluginDir: '/tmp/provider-backed-mcp-plugin',
      entryPoint: '/tmp/provider-backed-mcp-plugin/index.ts',
      manifestHash: 'provider-backed-mcp-hash',
    }

    pluginRegistry.registerDiscovered(providerBackedMcpPlugin)
    pluginRegistry.approve(providerBackedMcpPlugin.manifest.id, 'admin', providerBackedMcpPlugin.manifestHash)
    pluginRegistry.markActive(providerBackedMcpPlugin.manifest.id)
    setPluginEnabledForContext(providerBackedMcpPlugin.manifest.id, CONTEXT, true)
    buildPluginMcpToolSetSpy.mockResolvedValueOnce({
      plugin_provider_backed_mcp_plugin__remote_search: {
        description: 'Remote MCP search',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })

    const provider = createMockProvider()
    const tools = await makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })

    expect(buildPluginMcpToolSetSpy).toHaveBeenCalledWith(
      ['provider-backed-mcp-plugin'],
      expect.any(Map),
      expect.anything(),
    )
    expect(Object.keys(tools)).toContain('plugin_provider_backed_mcp_plugin__remote_search')
  })

  test('makeTools does not call buildMcpToolSet when no contextId', async () => {
    buildMcpToolSetSpy.mockClear()
    const provider = createMockProvider()
    const tools = await makeTools(provider)
    expect(Object.keys(tools).length).toBeGreaterThan(0)
    expect(buildMcpToolSetSpy).not.toHaveBeenCalled()
  })

  test('buildProviderlessToolDescriptors exposes providerless-safe plugin tools and plugin MCP only', async () => {
    const safePlugin: DiscoveredPlugin = {
      manifest: {
        id: 'providerless-safe-plugin',
        name: 'Providerless Safe Plugin',
        version: '1.0.0',
        description: 'Providerless-safe tool plugin',
        apiVersion: PLUGIN_API_VERSION,
        main: 'index.ts',
        contributes: {
          tools: ['runtime_echo'],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
          attachmentTransformers: [],
        },
        permissions: [],
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [],
        providerCapabilities: [],
        providerTraits: [],
        providerConfigSchema: [],
        providerContextConfigSchema: [],
        providerAllowedHosts: [],
      },
      pluginDir: '/tmp/providerless-safe-plugin',
      entryPoint: '/tmp/providerless-safe-plugin/index.ts',
      manifestHash: 'providerless-safe-hash',
    }
    const providerPlugin: DiscoveredPlugin = {
      manifest: {
        ...safePlugin.manifest,
        id: 'providerless-provider-plugin',
        name: 'Providerless Provider Plugin',
        description: 'Provider-backed tool plugin',
        permissions: ['tasks.read'],
      },
      pluginDir: '/tmp/providerless-provider-plugin',
      entryPoint: '/tmp/providerless-provider-plugin/index.ts',
      manifestHash: 'providerless-provider-hash',
    }
    const mcpPlugin: DiscoveredPlugin = {
      manifest: {
        ...safePlugin.manifest,
        id: 'providerless-mcp-plugin',
        name: 'Providerless MCP Plugin',
        description: 'Providerless MCP plugin',
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
      },
      pluginDir: '/tmp/providerless-mcp-plugin',
      entryPoint: '/tmp/providerless-mcp-plugin/index.ts',
      manifestHash: 'providerless-mcp-hash',
    }

    pluginRegistry.registerDiscovered(safePlugin)
    pluginRegistry.approve(safePlugin.manifest.id, 'admin', safePlugin.manifestHash)
    pluginRegistry.markActive(safePlugin.manifest.id)
    setPluginEnabledForContext(safePlugin.manifest.id, CONTEXT, true)
    contributionRegistry.register(
      safePlugin.manifest.id,
      {
        tools: [
          {
            name: 'runtime_echo',
            description: 'Echo runtime context',
            execute: (_input, runtimeContext): Promise<unknown> => Promise.resolve(runtimeContext.chatUserId),
          },
        ],
        promptFragments: [],
      },
      safePlugin.manifest,
    )

    pluginRegistry.registerDiscovered(providerPlugin)
    pluginRegistry.approve(providerPlugin.manifest.id, 'admin', providerPlugin.manifestHash)
    pluginRegistry.markActive(providerPlugin.manifest.id)
    setPluginEnabledForContext(providerPlugin.manifest.id, CONTEXT, true)
    contributionRegistry.register(
      providerPlugin.manifest.id,
      {
        tools: [
          {
            name: 'runtime_echo',
            description: 'Needs provider facade',
            execute: (_input, runtimeContext): Promise<unknown> => expectTaskProvider(runtimeContext).getTask('task-1'),
          },
        ],
        promptFragments: [],
      },
      providerPlugin.manifest,
    )

    pluginRegistry.registerDiscovered(mcpPlugin)
    pluginRegistry.approve(mcpPlugin.manifest.id, 'admin', mcpPlugin.manifestHash)
    pluginRegistry.markActive(mcpPlugin.manifest.id)
    setPluginEnabledForContext(mcpPlugin.manifest.id, CONTEXT, true)
    buildPluginMcpToolSetSpy.mockResolvedValueOnce({
      plugin_providerless_mcp_plugin__remote_search: {
        description: 'Remote MCP search',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })

    const tools = await buildProviderlessToolDescriptors({
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })

    expect(Object.keys(tools)).toContain('plugin_providerless_safe_plugin__runtime_echo')
    expect(Object.keys(tools)).not.toContain('plugin_providerless_provider_plugin__runtime_echo')
    expect(Object.keys(tools)).toContain('plugin_providerless_mcp_plugin__remote_search')
  })

  test('buildProviderlessToolDescriptors does not expose provider-coupled plugin MCP tools', async () => {
    const providerRuntimeMcpPlugin: DiscoveredPlugin = {
      manifest: {
        id: 'providerless-provider-runtime-mcp-plugin',
        name: 'Providerless Provider Runtime MCP Plugin',
        version: '1.0.0',
        description: 'Provider-coupled MCP plugin',
        apiVersion: PLUGIN_API_VERSION,
        main: 'index.ts',
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['providerless-provider-runtime'],
          attachmentTransformers: [],
        },
        permissions: ['provider.task'],
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [],
        providerCapabilities: [],
        providerTraits: [],
        providerConfigSchema: [],
        providerContextConfigSchema: [],
        providerAllowedHosts: [],
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com/provider' },
      },
      pluginDir: '/tmp/providerless-provider-runtime-mcp-plugin',
      entryPoint: '/tmp/providerless-provider-runtime-mcp-plugin/index.ts',
      manifestHash: 'providerless-provider-runtime-mcp-hash',
    }

    pluginRegistry.registerDiscovered(providerRuntimeMcpPlugin)
    pluginRegistry.approve(providerRuntimeMcpPlugin.manifest.id, 'admin', providerRuntimeMcpPlugin.manifestHash)
    pluginRegistry.markActive(providerRuntimeMcpPlugin.manifest.id)
    setPluginEnabledForContext(providerRuntimeMcpPlugin.manifest.id, CONTEXT, true)
    buildPluginMcpToolSetSpy.mockResolvedValueOnce({
      plugin_providerless_provider_runtime_mcp_plugin__remote_search: {
        description: 'Remote MCP search',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })

    const tools = await buildProviderlessToolDescriptors({
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })

    expect(buildPluginMcpToolSetSpy).not.toHaveBeenCalled()
    expect(Object.keys(tools)).not.toContain('plugin_providerless_provider_runtime_mcp_plugin__remote_search')
  })

  test('buildProviderlessToolDescriptors does not expose plugin MCP tools from plugins requesting provider.task', async () => {
    const providerTaskMcpPlugin: DiscoveredPlugin = {
      manifest: {
        id: 'providerless-provider-task-permission-mcp-plugin',
        name: 'Providerless Provider Task Permission MCP Plugin',
        version: '1.0.0',
        description: 'Provider-task-permission MCP plugin',
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
        permissions: ['provider.task'],
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [],
        providerCapabilities: [],
        providerTraits: [],
        providerConfigSchema: [],
        providerContextConfigSchema: [],
        providerAllowedHosts: [],
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com/provider-task' },
      },
      pluginDir: '/tmp/providerless-provider-task-permission-mcp-plugin',
      entryPoint: '/tmp/providerless-provider-task-permission-mcp-plugin/index.ts',
      manifestHash: 'providerless-provider-task-permission-mcp-hash',
    }

    pluginRegistry.registerDiscovered(providerTaskMcpPlugin)
    pluginRegistry.approve(providerTaskMcpPlugin.manifest.id, 'admin', providerTaskMcpPlugin.manifestHash)
    pluginRegistry.markActive(providerTaskMcpPlugin.manifest.id)
    setPluginEnabledForContext(providerTaskMcpPlugin.manifest.id, CONTEXT, true)
    buildPluginMcpToolSetSpy.mockResolvedValueOnce({
      plugin_providerless_provider_task_permission_mcp_plugin__remote_search: {
        description: 'Remote MCP search',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })

    const tools = await buildProviderlessToolDescriptors({
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })

    expect(buildPluginMcpToolSetSpy).not.toHaveBeenCalled()
    expect(Object.keys(tools)).not.toContain('plugin_providerless_provider_task_permission_mcp_plugin__remote_search')
  })

  test('buildProviderlessToolDescriptors does not expose plugin MCP tools from plugins requiring task capabilities', async () => {
    const requiredCapabilitiesMcpPlugin: DiscoveredPlugin = {
      manifest: {
        id: 'providerless-required-capabilities-mcp-plugin',
        name: 'Providerless Required Capabilities MCP Plugin',
        version: '1.0.0',
        description: 'Required-capabilities MCP plugin',
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
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: ['tasks.count'],
        requiredChatCapabilities: [],
        configRequirements: [],
        providerCapabilities: [],
        providerTraits: [],
        providerConfigSchema: [],
        providerContextConfigSchema: [],
        providerAllowedHosts: [],
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com/task-capabilities' },
      },
      pluginDir: '/tmp/providerless-required-capabilities-mcp-plugin',
      entryPoint: '/tmp/providerless-required-capabilities-mcp-plugin/index.ts',
      manifestHash: 'providerless-required-capabilities-mcp-hash',
    }

    pluginRegistry.registerDiscovered(requiredCapabilitiesMcpPlugin)
    pluginRegistry.approve(
      requiredCapabilitiesMcpPlugin.manifest.id,
      'admin',
      requiredCapabilitiesMcpPlugin.manifestHash,
    )
    pluginRegistry.markActive(requiredCapabilitiesMcpPlugin.manifest.id)
    setPluginEnabledForContext(requiredCapabilitiesMcpPlugin.manifest.id, CONTEXT, true)
    buildPluginMcpToolSetSpy.mockResolvedValueOnce({
      plugin_providerless_required_capabilities_mcp_plugin__remote_search: {
        description: 'Remote MCP search',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })

    const tools = await buildProviderlessToolDescriptors({
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })

    expect(buildPluginMcpToolSetSpy).not.toHaveBeenCalled()
    expect(Object.keys(tools)).not.toContain('plugin_providerless_required_capabilities_mcp_plugin__remote_search')
  })
})
