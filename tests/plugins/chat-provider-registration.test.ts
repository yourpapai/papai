// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ChatCapability } from '../../src/chat/types.js'
import { buildRegisterChatProviderType } from '../../src/plugins/chat-provider-registration.js'
import type { ChatProviderFactory, PluginContributions } from '../../src/plugins/runtime-types.js'
import { pluginManifestSchema } from '../../src/plugins/types.js'

const makeManifest = (overrides: Record<string, unknown> = {}): ReturnType<typeof pluginManifestSchema.parse> =>
  pluginManifestSchema.parse({
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'test',
    apiVersion: 1,
    main: 'index.ts',
    permissions: ['provider.chat'],
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      chatProviderTypes: ['test-provider'],
    },
    providerConfigSchema: [],
    providerAllowedHosts: [],
    chatProviderCapabilities: ['messages.reply-context'],
    ...overrides,
  })

const mockChatProvider = {
  name: 'test',
  threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' as const },
  capabilities: new Set<ChatCapability>(),
  traits: { observedGroupMessages: 'all' as const },
  configRequirements: [],
  registerCommand: (): void => {},
  onMessage: (): void => {},
  sendMessage: async (): Promise<void> => {},
  renderContext: (): { method: 'text'; content: string } => ({ method: 'text' as const, content: '' }),
  start: async (): Promise<void> => {},
  stop: async (): Promise<void> => {},
}

const makeFactory = (): ChatProviderFactory => (_id: string, _config: Record<string, string>) => mockChatProvider

describe('buildRegisterChatProviderType', () => {
  test('throws when plugin lacks provider.chat permission', () => {
    // Create a manifest that passes schema validation (no chatProviderTypes declared)
    // but the register function should still check the permission at runtime.
    const manifest = pluginManifestSchema.parse({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'test',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['storage'],
    })
    const collected: PluginContributions = { tools: [], promptFragments: [] }
    const guard = { assertOpen: (): void => {}, close: (): void => {} }
    const register = buildRegisterChatProviderType(manifest, collected, guard)
    expect(() => register('test-provider', makeFactory())).toThrow("without 'provider.chat'")
  })

  test('throws when type is not declared in manifest', () => {
    const manifest = makeManifest()
    const collected: PluginContributions = { tools: [], promptFragments: [] }
    const guard = { assertOpen: (): void => {}, close: (): void => {} }
    const register = buildRegisterChatProviderType(manifest, collected, guard)
    expect(() => register('wrong-type', makeFactory())).toThrow('not declared')
  })

  test('registers chat provider type successfully', () => {
    const manifest = makeManifest()
    const collected: PluginContributions = { tools: [], promptFragments: [] }
    const guard = { assertOpen: (): void => {}, close: (): void => {} }
    const register = buildRegisterChatProviderType(manifest, collected, guard)
    register('test-provider', makeFactory())
    expect(collected.chatProviderRegistration).toBeDefined()
    expect(collected.chatProviderRegistration?.type).toBe('test-provider')
  })

  test('throws on duplicate registration', () => {
    const manifest = makeManifest()
    const collected: PluginContributions = { tools: [], promptFragments: [] }
    const guard = { assertOpen: (): void => {}, close: (): void => {} }
    const register = buildRegisterChatProviderType(manifest, collected, guard)
    register('test-provider', makeFactory())
    expect(() => register('test-provider', makeFactory())).toThrow('more than once')
  })
})
