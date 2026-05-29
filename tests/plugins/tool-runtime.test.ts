// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildPluginToolRuntimeContext, type PluginToolSetRuntime } from '../../src/plugins/tool-runtime.js'
import { pluginManifestSchema, type PluginManifest } from '../../src/plugins/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return pluginManifestSchema.parse({
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'Test',
    apiVersion: 1,
    main: 'index.ts',
    contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
    permissions: [],
    defaultEnabled: false,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerConfigSchema: [],
    providerAllowedHosts: [],
    activationTimeoutMs: 5000,
    ...overrides,
  })
}

function makeRuntime(overrides: Partial<PluginToolSetRuntime> = {}): PluginToolSetRuntime {
  return {
    provider: createMockProvider(),
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    ...overrides,
  }
}

describe('buildPluginToolRuntimeContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('rateLimit', () => {
    test('provides rateLimit on the runtime context', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      expect(ctx.rateLimit).toBeDefined()
      expect(typeof ctx.rateLimit.check).toBe('function')
    })

    test('allows requests within the rate limit', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      const result = ctx.rateLimit.check('actor-1')
      expect(result.allowed).toBe(true)
    })

    test('denies requests when rate limit is exceeded', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      let lastResult: { allowed: boolean; retryAfterSec?: number } = { allowed: true }
      for (let i = 0; i < 21; i++) {
        lastResult = ctx.rateLimit.check('actor-1')
      }
      expect(lastResult.allowed).toBe(false)
      expect(lastResult.retryAfterSec).toBeDefined()
      expect(lastResult.retryAfterSec!).toBeGreaterThan(0)
    })
  })

  test('tool runtime exposes identity facade for identity provider plugins', () => {
    const runtime = buildPluginToolRuntimeContext(
      'identity-plugin',
      {
        ...makeManifest(),
        permissions: ['identity'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['identity-provider'],
        },
      },
      { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
    )

    expect(runtime.identity).toBeDefined()
    expect(runtime).toHaveProperty('identity')
    expect(runtime.identity?.lookupForChatUser('chat-user-1')).toBeNull()
  })

  test('tool runtime omits identity facade when plugin lacks identity permission', () => {
    const runtime = buildPluginToolRuntimeContext(
      'no-identity-plugin',
      {
        ...makeManifest(),
        permissions: [],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['identity-provider'],
        },
      },
      { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
    )

    expect(runtime.identity).toBeUndefined()
    expect(runtime).not.toHaveProperty('identity')
  })

  test('tool runtime omits identity facade when plugin contributes no provider types', () => {
    const runtime = buildPluginToolRuntimeContext(
      'no-provider-plugin',
      {
        ...makeManifest(),
        permissions: ['identity'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
        },
      },
      { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
    )

    expect(runtime.identity).toBeUndefined()
    expect(runtime).not.toHaveProperty('identity')
  })

  test('tool runtime omits identity facade when plugin contributes multiple provider types', () => {
    const runtime = buildPluginToolRuntimeContext(
      'multi-provider-plugin',
      {
        ...makeManifest(),
        permissions: ['identity'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['identity-provider-a', 'identity-provider-b'],
        },
      } as PluginManifest,
      { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
    )

    expect(runtime.identity).toBeUndefined()
    expect(runtime).not.toHaveProperty('identity')
  })
})
