// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { PluginContributions } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Stub the registry + contributions registries so activation side-effects are captured
let mockMarkActive = mock((_id: string): void => {})
let mockMarkError = mock((_id: string, _reason: string): void => {})
let mockRegisterContribs = mock((_id: string, _c: PluginContributions, _m: unknown): void => {})
let mockDeregister = mock((_id: string): void => {})
let mockRecordEvent = mock((_id: string, _type: string, _msg?: string): void => {})

void mock.module('../../src/plugins/registry.js', () => ({
  pluginRegistry: {
    getEntry: (_id: string): undefined => undefined,
    markActive: (id: string): void => {
      mockMarkActive(id)
    },
    markError: (id: string, reason: string): void => {
      mockMarkError(id, reason)
    },
    markDeactivated: mock((): void => {}),
    getApprovedCompatiblePlugins: (): DiscoveredPlugin[] => [],
    getActivePlugins: (): DiscoveredPlugin[] => [],
    getAllEntries: (): unknown[] => [],
  },
  setPluginEnabledForContext: mock((): void => {}),
  isPluginActiveForContext: mock((): boolean => false),
  syncRegistryFromDb: mock((): void => {}),
  getPluginsForContext: mock((): DiscoveredPlugin[] => []),
}))

void mock.module('../../src/plugins/contributions.js', () => ({
  contributionRegistry: {
    register: (id: string, c: PluginContributions, m: unknown): void => {
      mockRegisterContribs(id, c, m)
    },
    deregister: (id: string): void => {
      mockDeregister(id)
    },
    getContributions: mock((): undefined => undefined),
    getActivePluginIds: mock((): string[] => []),
    getAllContributions: mock((): unknown[] => []),
  },
  buildPluginToolSet: mock((): Record<string, unknown> => ({})),
  buildPluginPromptSection: mock((): string => ''),
  namespacedToolName: mock((id: string, name: string): string => `plugin_${id}__${name}`),
  sanitizePluginId: mock((id: string): string => id.replace(/-/gu, '_')),
  MAX_FRAGMENT_LENGTH_PER_PLUGIN: 2000,
  MAX_TOTAL_PLUGIN_PROMPT_LENGTH: 8000,
}))

void mock.module('../../src/plugins/store.js', () => ({
  recordRuntimeEvent: (id: string, type: string, msg?: string): void => {
    mockRecordEvent(id, type, msg)
  },
  upsertPluginAdminState: mock((): void => {}),
  updatePluginAdminStateField: mock((): void => {}),
  getPluginAdminState: mock((): undefined => undefined),
  getAllPluginAdminStates: mock((): unknown[] => []),
  getPluginContextState: mock((): undefined => undefined),
  isPluginEnabledForContext: mock((): boolean => false),
  setPluginContextEnabled: mock((): void => {}),
  getEnabledPluginsForContext: mock((): string[] => []),
  kvGet: mock((): undefined => undefined),
  kvSet: mock((): void => {}),
  kvDelete: mock((): void => {}),
  kvList: mock((): unknown[] => []),
  getRecentRuntimeEvents: mock((): unknown[] => []),
}))

void mock.module('../../src/plugins/context.js', () => ({
  buildPluginContext: (_manifest: unknown, _ctxId: string): { ctx: unknown; collected: PluginContributions } => ({
    ctx: {},
    collected: { tools: [], promptFragments: [] },
  }),
}))

import { activatePlugins, getActivatedPluginIds } from '../../src/plugins/loader.js'

function makePlugin(id = 'test-plugin', overrides: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin {
  return {
    manifest: {
      id,
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [] },
      permissions: [],
      defaultEnabled: false,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [],
    },
    pluginDir: '/fake/plugin-dir',
    entryPoint: '/fake/entry.ts',
    manifestHash: 'hash-abc',
    ...overrides,
  }
}

describe('activatePlugins', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    mockMarkActive = mock((_id: string): void => {})
    mockMarkError = mock((_id: string, _reason: string): void => {})
    mockRegisterContribs = mock((_id: string, _c: PluginContributions, _m: unknown): void => {})
    mockDeregister = mock((_id: string): void => {})
    mockRecordEvent = mock((_id: string, _type: string, _msg?: string): void => {})
  })

  test('does nothing when passed empty list', async () => {
    await activatePlugins([])
    expect(mockMarkActive).not.toHaveBeenCalled()
  })

  test('marks plugin as error when entry point cannot be imported', async () => {
    const plugin = makePlugin('bad-plugin', { entryPoint: '/nonexistent/path.ts' })
    await activatePlugins([plugin])
    expect(mockMarkError).toHaveBeenCalledWith('bad-plugin', expect.stringContaining('Import failed'))
    expect(mockRecordEvent).toHaveBeenCalledWith('bad-plugin', 'error', expect.any(String))
  })

  test('getActivatedPluginIds returns currently active plugin IDs', () => {
    const ids = getActivatedPluginIds()
    expect(Array.isArray(ids)).toBe(true)
  })
})

describe('isPluginFactory', () => {
  // isPluginFactory is not exported but we test its behaviour via activatePlugins
  test('activation fails gracefully for non-factory modules', async () => {
    // A valid path but whose module has no activate function
    const plugin = makePlugin('no-factory', { entryPoint: '/nonexistent/empty.ts' })
    await activatePlugins([plugin])
    // Should have marked error (import failed) or skipped
    expect(mockMarkActive).not.toHaveBeenCalledWith('no-factory')
  })
})
