// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createChatProviderFromConfig, listPlatformProviderTypes } from '../../src/chat/registry.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('chat registry', () => {
  test('createChatProviderFromConfig constructs adapters from typed instance config without env mapping', () => {
    mockLogger()
    const telegram = createChatProviderFromConfig('telegram-default', 'telegram', { token: 'secret-token' })
    const mattermost = createChatProviderFromConfig('mattermost-default', 'mattermost', {
      baseUrl: 'https://mm.invalid',
      token: 'secret',
    })
    const discord = createChatProviderFromConfig('discord-default', 'discord', { token: 'secret-token' })
    const konturTalk = createChatProviderFromConfig('kontur-talk-main', 'kontur-talk', { jwtToken: 'secret-token' })

    expect(telegram.name).toBe('telegram')
    expect('start' in telegram).toBe(true)
    expect(mattermost.name).toBe('mattermost')
    expect('start' in mattermost).toBe(true)
    expect(discord.name).toBe('discord')
    expect('start' in discord).toBe(true)
    expect(konturTalk.name).toBe('kontur-talk')
    expect('start' in konturTalk).toBe(true)
  })

  test('createChatProviderFromConfig creates telegram from encrypted-row config token', () => {
    const provider = createChatProviderFromConfig('telegram-default', 'telegram', { token: '123:test-token' })

    expect(provider.name).toBe('telegram')
  })

  test('createChatProviderFromConfig creates discord from encrypted-row config token', () => {
    const provider = createChatProviderFromConfig('discord-default', 'discord', { token: 'discord-token' })

    expect(provider.name).toBe('discord')
  })

  test('createChatProviderFromConfig creates mattermost from descriptor-shaped baseUrl and token', () => {
    const provider = createChatProviderFromConfig('mattermost-default', 'mattermost', {
      baseUrl: 'https://mattermost.example.test',
      token: 'mattermost-token',
    })

    expect(provider.name).toBe('mattermost')
  })

  test('createChatProviderFromConfig rejects mattermost persisted legacy url without baseUrl', () => {
    expect(() =>
      createChatProviderFromConfig('mattermost-main', 'mattermost', {
        url: 'https://mm.invalid',
        token: 'secret',
      }),
    ).toThrow('Missing mattermost instance config')
  })

  test('createChatProviderFromConfig rejects missing config values before adapter construction', () => {
    expect(() =>
      createChatProviderFromConfig('mattermost-default', 'mattermost', { token: 'mattermost-token' }),
    ).toThrow('Missing mattermost instance config')
  })

  test('createChatProviderFromConfig creates kontur talk from encrypted-row config jwtToken', () => {
    const provider = createChatProviderFromConfig('kontur-talk-main', 'kontur-talk', { jwtToken: 'test-token' })

    expect(provider.name).toBe('kontur-talk')
  })

  test('createChatProviderFromConfig rejects kontur talk missing JWT token', () => {
    expect(() => createChatProviderFromConfig('kontur-talk-main', 'kontur-talk', {})).toThrow(
      'Missing kontur-talk instance config',
    )
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
