// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createChatProvider, listPlatformProviderTypes } from '../../src/chat/registry.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('chat registry', () => {
  const originalDiscordToken = process.env['DISCORD_BOT_TOKEN']
  const originalTelegramToken = process.env['TELEGRAM_BOT_TOKEN']

  beforeEach(() => {
    mockLogger()
    process.env['DISCORD_BOT_TOKEN'] = 'fake-discord-token'
    process.env['TELEGRAM_BOT_TOKEN'] = 'fake-telegram-token'
  })

  afterEach(() => {
    if (originalDiscordToken === undefined) {
      delete process.env['DISCORD_BOT_TOKEN']
    } else {
      process.env['DISCORD_BOT_TOKEN'] = originalDiscordToken
    }
    if (originalTelegramToken === undefined) {
      delete process.env['TELEGRAM_BOT_TOKEN']
    } else {
      process.env['TELEGRAM_BOT_TOKEN'] = originalTelegramToken
    }
  })

  test('createChatProvider("discord") returns a DiscordChatProvider instance', () => {
    const provider = createChatProvider('discord', {
      env: { DISCORD_BOT_TOKEN: 'fake-discord-token' },
    })
    expect(provider.name).toBe('discord')
  })

  test('createChatProvider("telegram") returns a TelegramChatProvider instance', () => {
    const provider = createChatProvider('telegram', {
      env: { TELEGRAM_BOT_TOKEN: 'fake-telegram-token' },
    })
    expect(provider.name).toBe('telegram')
  })

  // Failure paths: pass { env: {} } so validation fires before the constructor reads process.env
  test('createChatProvider throws for unknown provider', () => {
    expect(() => createChatProvider('unknown', { env: {} })).toThrow(/CHAT_PROVIDER must be/u)
  })

  test('createChatProvider("discord") throws when DISCORD_BOT_TOKEN is missing', () => {
    expect(() => createChatProvider('discord', { env: {} })).toThrow(/Missing discord env vars/u)
  })

  test('createChatProvider("telegram") throws when TELEGRAM_BOT_TOKEN is missing', () => {
    expect(() => createChatProvider('telegram', { env: {} })).toThrow(/Missing telegram env vars/u)
  })

  test('createChatProvider("mattermost") throws when required env vars are missing', () => {
    expect(() => createChatProvider('mattermost', { env: {} })).toThrow(/Missing mattermost env vars/u)
  })

  test('createChatProviderFromConfig creates telegram from encrypted-row config token', async () => {
    const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

    const provider = createChatProviderFromConfig('telegram-default', 'telegram', { token: '123:test-token' })

    expect(provider.name).toBe('telegram')
  })

  test('createChatProviderFromConfig creates discord from encrypted-row config token', async () => {
    const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

    const provider = createChatProviderFromConfig('discord-default', 'discord', { token: 'discord-token' })

    expect(provider.name).toBe('discord')
  })

  test('createChatProviderFromConfig creates mattermost from encrypted-row url and token', async () => {
    const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

    const provider = createChatProviderFromConfig('mattermost-default', 'mattermost', {
      url: 'https://mattermost.example.test',
      token: 'mattermost-token',
    })

    expect(provider.name).toBe('mattermost')
  })

  test('createChatProviderFromConfig creates mattermost from descriptor-shaped baseUrl and token', async () => {
    const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

    const provider = createChatProviderFromConfig('mattermost-default', 'mattermost', {
      baseUrl: 'https://mattermost.example.test',
      token: 'mattermost-token',
    })

    expect(provider.name).toBe('mattermost')
  })

  test('createChatProviderFromConfig rejects missing config values before adapter construction', async () => {
    const { createChatProviderFromConfig } = await import('../../src/chat/registry.js')

    expect(() =>
      createChatProviderFromConfig('mattermost-default', 'mattermost', { token: 'mattermost-token' }),
    ).toThrow('Missing mattermost instance config')
  })

  test('createChatProvider("kontur-talk") creates provider', () => {
    process.env['KONTUR_TALK_JWT_TOKEN'] = 'test-token'
    const provider = createChatProvider('kontur-talk', { env: process.env as Record<string, string | undefined> })
    expect(provider.name).toBe('kontur-talk')
  })

  test('createChatProvider("kontur-talk") throws when JWT token is missing', () => {
    expect(() => createChatProvider('kontur-talk', { env: {} })).toThrow()
  })

  test('listPlatformProviderTypes exposes built-in descriptor metadata', () => {
    const descriptors = listPlatformProviderTypes()
    const mattermost = descriptors.find((descriptor) => descriptor.type === 'mattermost')

    expect(descriptors.map((descriptor) => descriptor.type)).toEqual([
      'telegram',
      'mattermost',
      'discord',
      'kontur-talk',
    ])
    expect(mattermost?.instanceConfigSchema.map((field) => field.key)).toEqual(['baseUrl', 'token'])
    expect(mattermost?.capabilities.has('users.resolve')).toBe(true)
    expect(mattermost?.traits.observedGroupMessages).toBe('all')
  })
})
