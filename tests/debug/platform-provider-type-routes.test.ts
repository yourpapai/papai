// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { z } from 'zod'

import { PlatformProviderTypeViewSchema } from '../../client/admin/instance-fetcher-schemas.js'
import { registerContributedChatProviderType, unregisterContributedChatProviderType } from '../../src/chat/registry.js'
import type { ChatCapability, ChatProvider } from '../../src/chat/types.js'
import { handlePlatformProviderTypes } from '../../src/debug/platform-provider-type-routes.js'

const mockChatProvider: ChatProvider = {
  name: 'test',
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
}

const registerTestProviders = (): void => {
  registerContributedChatProviderType('telegram', {
    pluginId: 'chat-provider-telegram',
    factory: (): ChatProvider => mockChatProvider,
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
    factory: (): ChatProvider => mockChatProvider,
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
    factory: (): ChatProvider => mockChatProvider,
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
    factory: (): ChatProvider => mockChatProvider,
    capabilities: new Set(['messages.reply-context']),
    traits: { observedGroupMessages: 'all', maxMessageLength: 4096 },
    threadCapabilities: { supportsThreads: true, canCreateThreads: true, threadScope: 'message' },
    displayName: 'Kontur Talk',
    instanceConfigSchema: [{ key: 'jwtToken', label: 'JWT Token', required: true, sensitive: true, scope: 'instance' }],
  })
}

const route = (path: string, method = 'GET'): Response | null =>
  handlePlatformProviderTypes(new Request(`http://localhost${path}`, { method }), new URL(`http://localhost${path}`))

const expectArray = (value: unknown): readonly unknown[] => {
  expect(Array.isArray(value)).toBe(true)
  if (!Array.isArray(value)) throw new Error('expected array')
  return value
}

const expectObject = (value: unknown): object => {
  expect(typeof value).toBe('object')
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object')
  return value
}

const pick = (value: object, key: string): unknown => Reflect.get(value, key)

const readSchemaKeys = (entry: object): readonly unknown[] =>
  expectArray(pick(entry, 'instanceConfigSchema')).map((field) => pick(expectObject(field), 'key'))

describe('handlePlatformProviderTypes', () => {
  beforeEach(() => {
    unregisterContributedChatProviderType('chat-provider-telegram')
    unregisterContributedChatProviderType('chat-provider-mattermost')
    unregisterContributedChatProviderType('chat-provider-discord')
    unregisterContributedChatProviderType('chat-provider-kontur-talk')
    registerTestProviders()
  })

  test('GET /api/platform-provider-types returns platform descriptors', async () => {
    const res = route('/api/platform-provider-types')
    expect(res?.status).toBe(200)
    const body = expectArray(await res?.json()).map((entry) => expectObject(entry))

    expect(body.map((entry) => pick(entry, 'type'))).toEqual(['telegram', 'mattermost', 'discord', 'kontur-talk'])
    expect(readSchemaKeys(expectObject(body.find((entry) => pick(entry, 'type') === 'mattermost')))).toEqual([
      'baseUrl',
      'token',
    ])
  })

  test('GET /api/platform-provider-types matches the admin client schema', async () => {
    const res = route('/api/platform-provider-types')
    expect(res?.status).toBe(200)

    const parsed = z.array(PlatformProviderTypeViewSchema).parse(await res?.json())

    expect(parsed.find((entry) => entry.type === 'mattermost')?.traits.observedGroupMessages).toBe('all')
  })
})
