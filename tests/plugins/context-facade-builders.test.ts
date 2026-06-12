// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

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
