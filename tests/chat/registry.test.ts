// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import {
  createChatProviderFromConfig,
  listPlatformProviderTypes,
  registerContributedChatProviderType,
  unregisterContributedChatProviderType,
} from '../../src/chat/registry.js'
import type { ChatCapability, ChatProvider } from '../../src/chat/types.js'
import { mockLogger } from '../utils/test-helpers.js'

const makeMockChatProvider = (name: string): ChatProvider => ({
  name,
  threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
  capabilities: new Set<ChatCapability>(),
  traits: { observedGroupMessages: 'all' },
  configRequirements: [],
  registerCommand: (): void => {},
  onMessage: (): void => {},
  sendMessage: async (): Promise<void> => {},
  renderContext: (): { method: 'text'; content: string } => ({ method: 'text', content: '' }),
  start: async (): Promise<void> => {},
  stop: async (): Promise<void> => {},
})

const registerTestProviders = (): void => {
  registerContributedChatProviderType('telegram', {
    pluginId: 'chat-provider-telegram',
    factory: (_id, _config) => makeMockChatProvider('telegram'),
    capabilities: new Set(['commands.menu', 'messages.reply-context']),
    traits: { observedGroupMessages: 'all', maxMessageLength: 4096 },
    threadCapabilities: { supportsThreads: true, canCreateThreads: true, threadScope: 'message' },
    displayName: 'Telegram',
    instanceConfigSchema: [
      { key: 'token', label: 'Telegram Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
  })
  registerContributedChatProviderType('mattermost', {
    pluginId: 'chat-provider-mattermost',
    factory: (_id, _config) => makeMockChatProvider('mattermost'),
    capabilities: new Set(['messages.reply-context', 'users.resolve']),
    traits: { observedGroupMessages: 'all', maxMessageLength: 16383 },
    threadCapabilities: { supportsThreads: true, canCreateThreads: true, threadScope: 'post' },
    displayName: 'Mattermost',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'Mattermost URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'token', label: 'Mattermost Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
  })
  registerContributedChatProviderType('discord', {
    pluginId: 'chat-provider-discord',
    factory: (_id, _config) => makeMockChatProvider('discord'),
    capabilities: new Set(['messages.reply-context', 'users.resolve']),
    traits: { observedGroupMessages: 'mentions_only', maxMessageLength: 2000 },
    threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
    displayName: 'Discord',
    instanceConfigSchema: [
      { key: 'token', label: 'Discord Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
  })
  registerContributedChatProviderType('kontur-talk', {
    pluginId: 'chat-provider-kontur-talk',
    factory: (_id, _config) => makeMockChatProvider('kontur-talk'),
    capabilities: new Set(['messages.reply-context']),
    traits: { observedGroupMessages: 'all', maxMessageLength: 4096 },
    threadCapabilities: { supportsThreads: true, canCreateThreads: true, threadScope: 'message' },
    displayName: 'Kontur Talk',
    instanceConfigSchema: [{ key: 'jwtToken', label: 'JWT Token', required: true, sensitive: true, scope: 'instance' }],
  })
}

describe('chat registry', () => {
  beforeEach(() => {
    // Clean up any previously registered providers
    unregisterContributedChatProviderType('chat-provider-telegram')
    unregisterContributedChatProviderType('chat-provider-mattermost')
    unregisterContributedChatProviderType('chat-provider-discord')
    unregisterContributedChatProviderType('chat-provider-kontur-talk')
  })

  test('createChatProviderFromConfig constructs adapters from typed instance config', () => {
    mockLogger()
    registerTestProviders()

    const telegram = createChatProviderFromConfig('telegram-default', 'telegram', { token: 'secret-token' })
    const mattermost = createChatProviderFromConfig('mattermost-default', 'mattermost', {
      baseUrl: 'https://mm.invalid',
      token: 'secret',
    })
    const discord = createChatProviderFromConfig('discord-default', 'discord', { token: 'secret-token' })
    const konturTalk = createChatProviderFromConfig('kontur-talk-main', 'kontur-talk', { jwtToken: 'secret-token' })

    expect(telegram.name).toBe('telegram')
    expect(mattermost.name).toBe('mattermost')
    expect(discord.name).toBe('discord')
    expect(konturTalk.name).toBe('kontur-talk')
  })

  test('createChatProviderFromConfig rejects missing config values', () => {
    mockLogger()
    registerTestProviders()

    expect(() =>
      createChatProviderFromConfig('mattermost-default', 'mattermost', { token: 'mattermost-token' }),
    ).toThrow('Missing mattermost instance config')
  })

  test('listPlatformProviderTypes returns registered provider descriptors', () => {
    registerTestProviders()

    const descriptors = listPlatformProviderTypes()
    const types = descriptors.map((d) => d.type)

    expect(types).toContain('telegram')
    expect(types).toContain('mattermost')
    expect(types).toContain('discord')
    expect(types).toContain('kontur-talk')
  })

  test('listPlatformProviderTypes includes config schema and capabilities', () => {
    registerTestProviders()

    const descriptors = listPlatformProviderTypes()
    const mattermost = descriptors.find((d) => d.type === 'mattermost')

    expect(mattermost?.instanceConfigSchema.map((f) => f.key)).toEqual(['baseUrl', 'token'])
    expect(mattermost?.capabilities.has('users.resolve')).toBe(true)
    expect(mattermost?.traits.observedGroupMessages).toBe('all')
  })

  test('listPlatformProviderTypes shows plugin source', () => {
    registerTestProviders()

    const descriptors = listPlatformProviderTypes()
    const telegram = descriptors.find((d) => d.type === 'telegram')

    expect(telegram?.source).toEqual({ plugin: 'chat-provider-telegram' })
  })
})
