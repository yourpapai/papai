// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setPluginConfig } from '../../src/config.js'
import { buildContextDynamicHosts, buildDynamicHosts } from '../../src/plugins/dynamic-hosts.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import type { PluginManifest } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'tier-test-plugin',
    name: 'Tier Test',
    version: '1.0.0',
    description: 'Tier separation test',
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
    permissions: ['http'],
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
    ...overrides,
  }
}

// These functions are exercised indirectly through context.test.ts.
// This file exists to satisfy the TDD hook for context-facade-builders.ts
// (extracted pure helpers from context.ts).
describe('context-facade-builders (import smoke)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('buildDeniedKvStore throws on get', async () => {
    const { buildDeniedKvStore } = await import('../../src/plugins/context-facade-builders.js')
    const store = buildDeniedKvStore('my-plugin')
    expect(() => store.get('key')).toThrow("Plugin my-plugin does not have 'storage' permission")
  })

  test('buildDeniedKvStore throws on set', async () => {
    const { buildDeniedKvStore } = await import('../../src/plugins/context-facade-builders.js')
    const store = buildDeniedKvStore('my-plugin')
    expect(() => store.set('key', 'val')).toThrow("Plugin my-plugin does not have 'storage' permission")
  })

  test('buildPluginLogger returns a logger with all four methods', async () => {
    const { buildPluginLogger } = await import('../../src/plugins/context-facade-builders.js')
    const log = buildPluginLogger('my-plugin')
    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  test('buildAdminConfig hides keys not declared as admin-scoped', async () => {
    const { buildAdminConfig } = await import('../../src/plugins/context-facade-builders.js')
    const manifest = {
      id: 'test-plugin',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      apiVersion: PLUGIN_API_VERSION as 1,
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
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [
        { key: 'api_key', label: 'API Key', required: false, sensitive: true, scope: 'admin' as const },
      ],
      providerCapabilities: [],
      providerTraits: [],
      providerConfigSchema: [],
      providerContextConfigSchema: [],
      providerAllowedHosts: [],
      providerAllowedHostsFromConfig: [],
    }
    const config = buildAdminConfig(manifest)
    // context-scoped key not in admin set returns undefined
    expect(config.get('context_only_key')).toBeUndefined()
  })
})

describe('buildDynamicHosts / buildContextDynamicHosts tier separation', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('buildDynamicHosts ignores context config values (context-scoped key not in admin config)', () => {
    // key declared as context-scoped only: admin thunk must return empty set
    // even if a context config value is set for that key
    const manifest = makeManifest({
      providerAllowedHostsFromConfig: ['base_url'],
      configRequirements: [
        { key: 'base_url', scope: 'context' as const, label: 'Base URL', required: false, sensitive: false },
      ],
    })
    setPluginConfig('ctx-a', 'tier-test-plugin', 'base_url', 'https://context-host.example.com')
    const adminThunk = buildDynamicHosts(manifest)
    // admin thunk reads getPluginAdminConfig, not context config — must be empty
    expect(adminThunk().size).toBe(0)
  })

  test('buildContextDynamicHosts ignores admin config values (admin-scoped key not in context config)', () => {
    // key declared as admin-scoped only: context thunk must return empty set
    // even if an admin config value is set for that key
    const manifest = makeManifest({
      providerAllowedHostsFromConfig: ['base_url'],
      configRequirements: [
        { key: 'base_url', scope: 'admin' as const, label: 'Base URL', required: false, sensitive: false },
      ],
    })
    setPluginAdminConfig('tier-test-plugin', 'base_url', 'https://admin-host.example.com', 'admin')
    const contextThunk = buildContextDynamicHosts(manifest)
    // context thunk filters to context-scoped keys only — admin-scoped key is excluded
    expect(contextThunk().size).toBe(0)
  })

  test('buildContextDynamicHosts resolves context-scoped key to the configured host', async () => {
    const manifest = makeManifest({
      providerAllowedHostsFromConfig: ['base_url'],
      configRequirements: [
        { key: 'base_url', scope: 'context' as const, label: 'Base URL', required: false, sensitive: false },
      ],
    })
    setPluginConfig('ctx-b', 'tier-test-plugin', 'base_url', 'https://context-host.example.com')
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve()
      }, 0)
    })
    const contextThunk = buildContextDynamicHosts(manifest)
    const hosts = contextThunk()
    expect(hosts.has('context-host.example.com')).toBe(true)
    expect(hosts.size).toBe(1)
  })
})
