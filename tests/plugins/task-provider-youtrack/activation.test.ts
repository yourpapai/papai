// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import factory from '../../../plugins/task-provider-youtrack/index.js'
import manifestJson from '../../../plugins/task-provider-youtrack/plugin.json' with { type: 'json' }
import { YouTrackProvider } from '../../../plugins/task-provider-youtrack/provider.js'
import type {
  PluginAdminConfig,
  PluginContext,
  PluginKvStore,
  PluginLogger,
  PluginRegistration,
} from '../../../src/plugins/context.js'
import { pluginManifestSchema, type PluginPermission } from '../../../src/plugins/types.js'
import type { TaskProviderConfigValidator, TaskProviderFactory } from '../../../src/providers/registry.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('task-provider-youtrack activation', () => {
  // NOTE: full registry registration (activate() → registerContributedTaskProviderType) will only work
  // after Task 4.5 removes the youtrack built-in descriptor. Until then, calling activate() on the real
  // ctx throws because the built-in guard blocks overriding built-in provider types.
  // This test exercises the factory and provider construction path directly.

  test('factory produces a YouTrackProvider with name youtrack', () => {
    mockLogger()
    const provider = new YouTrackProvider({ baseUrl: 'https://youtrack.invalid', token: 'token-abc' })
    expect(provider.name).toBe('youtrack')
  })

  test('manifest parses and declares youtrack task provider type', () => {
    const manifest = pluginManifestSchema.parse(manifestJson)
    expect(manifest.id).toBe('task-provider-youtrack')
    expect(manifest.contributes.taskProviderTypes).toContain('youtrack')
    expect(manifest.providerCapabilities.length).toBeGreaterThan(0)
  })

  test('factory export is a function that returns an object with activate', () => {
    const instance = factory()
    expect(typeof instance.activate).toBe('function')
  })

  test('activate() registers a factory that builds a youtrack provider from raw config', () => {
    mockLogger()
    let capturedFactory: TaskProviderFactory | undefined

    const stubKv: PluginKvStore = {
      get(_key: string): string | undefined {
        return undefined
      },
      set(_key: string, _value: string): void {},
      delete(_key: string): void {},
      list(_prefix?: string): Array<{ key: string; value: string }> {
        return []
      },
    }

    const stubLog: PluginLogger = {
      debug(_data: Record<string, unknown>, _msg: string): void {},
      info(_data: Record<string, unknown>, _msg: string): void {},
      warn(_data: Record<string, unknown>, _msg: string): void {},
      error(_data: Record<string, unknown>, _msg: string): void {},
    }

    const stubAdminConfig: PluginAdminConfig = {
      get(_key: string): string | undefined {
        return undefined
      },
    }

    const stubRegistration: PluginRegistration = {
      registerTaskProviderType(
        type: string,
        descriptor: { factory: TaskProviderFactory; validateConfig?: TaskProviderConfigValidator },
      ): void {
        expect(type).toBe('youtrack')
        capturedFactory = descriptor.factory
      },
      registerTool(): void {},
      registerPromptFragment(): void {},
      registerCommand(): void {},
      registerScheduledJob(): void {},
    }

    const mockCtx: PluginContext = {
      pluginId: 'task-provider-youtrack',
      contextId: '__system__',
      permissions: new Set<PluginPermission>(),
      kv: stubKv,
      log: stubLog,
      adminConfig: stubAdminConfig,
      registration: stubRegistration,
    }

    void factory().activate(mockCtx)

    expect(capturedFactory).toBeDefined()

    const provider = capturedFactory?.({
      baseUrl: 'https://yt.invalid',
      token: 'tkn',
    })
    expect(provider?.name).toBe('youtrack')
    expect(provider).toBeInstanceOf(YouTrackProvider)
  })
})
