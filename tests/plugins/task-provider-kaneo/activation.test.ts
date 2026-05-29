// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import factory from '../../../plugins/task-provider-kaneo/index.js'
import manifestJson from '../../../plugins/task-provider-kaneo/plugin.json' with { type: 'json' }
import { KaneoProvider } from '../../../plugins/task-provider-kaneo/provider.js'
import type {
  PluginAdminConfig,
  PluginContext,
  PluginKvStore,
  PluginLogger,
  PluginRegistration,
} from '../../../src/plugins/context.js'
import { pluginManifestSchema, type PluginPermission } from '../../../src/plugins/types.js'
import type { TaskProviderFactory } from '../../../src/providers/registry.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('task-provider-kaneo activation', () => {
  // NOTE: full registry registration (activate() → registerContributedTaskProviderType) will only work
  // after Task 3.6 removes the kaneo built-in descriptor. Until then, calling activate() on the real
  // ctx throws because the built-in guard blocks overriding built-in provider types.
  // This test exercises the factory and provider construction path directly.

  test('factory produces a KaneoProvider with name kaneo (api-key path)', () => {
    mockLogger()
    const provider = new KaneoProvider({ apiKey: 'test-api-key', baseUrl: 'https://kaneo.invalid' }, 'ws-1')
    expect(provider.name).toBe('kaneo')
  })

  test('factory produces a KaneoProvider with name kaneo (session-cookie path)', () => {
    mockLogger()
    const provider = new KaneoProvider(
      {
        apiKey: '',
        baseUrl: 'https://kaneo.invalid',
        sessionCookie: 'better-auth.session_token=abc123',
      },
      'ws-1',
    )
    expect(provider.name).toBe('kaneo')
  })

  test('manifest parses and declares kaneo task provider type', () => {
    const manifest = pluginManifestSchema.parse(manifestJson)
    expect(manifest.id).toBe('task-provider-kaneo')
    expect(manifest.contributes.taskProviderTypes).toContain('kaneo')
    expect(manifest.providerCapabilities.length).toBeGreaterThan(0)
  })

  test('factory export is a function that returns an object with activate', () => {
    const instance = factory()
    expect(typeof instance.activate).toBe('function')
  })

  test('activate() registers a factory that builds a kaneo provider from raw config (both credential shapes)', () => {
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
      registerTaskProviderType(type: string, providerFactory: TaskProviderFactory): void {
        expect(type).toBe('kaneo')
        capturedFactory = providerFactory
      },
      registerTool(): void {},
      registerPromptFragment(): void {},
      registerCommand(): void {},
      registerScheduledJob(): void {},
    }

    const mockCtx: PluginContext = {
      pluginId: 'task-provider-kaneo',
      contextId: '__system__',
      permissions: new Set<PluginPermission>(),
      kv: stubKv,
      log: stubLog,
      adminConfig: stubAdminConfig,
      registration: stubRegistration,
    }

    void factory().activate(mockCtx)

    expect(capturedFactory).toBeDefined()

    // Plain api-key credential → Authorization: Bearer path (isKaneoSessionCookie returns false)
    const apiKeyProvider = capturedFactory?.({
      baseUrl: 'https://kaneo.invalid',
      credential: 'plain-api-key',
      workspaceId: 'ws-1',
    })
    expect(apiKeyProvider?.name).toBe('kaneo')

    // Session-cookie credential (starts with 'better-auth.session_token=') → isKaneoSessionCookie returns true
    const cookieProvider = capturedFactory?.({
      baseUrl: 'https://kaneo.invalid',
      credential: 'better-auth.session_token=abc123',
      workspaceId: 'ws-1',
    })
    expect(cookieProvider?.name).toBe('kaneo')
  })
})
