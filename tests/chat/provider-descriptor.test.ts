// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ChatProviderDescriptor } from '../../src/chat/provider-descriptor.js'

describe('ChatProviderDescriptor', () => {
  test('supports builtin source', () => {
    const descriptor: ChatProviderDescriptor = {
      type: 'telegram',
      displayName: 'Telegram',
      source: 'builtin',
      instanceConfigSchema: [],
      contextConfigSchema: [],
      capabilities: new Set(['commands.menu']),
      traits: { observedGroupMessages: 'all' },
    }
    expect(descriptor.source).toBe('builtin')
  })

  test('supports plugin source', () => {
    const descriptor: ChatProviderDescriptor = {
      type: 'telegram',
      displayName: 'Telegram',
      source: { plugin: 'chat-provider-telegram' },
      instanceConfigSchema: [],
      contextConfigSchema: [],
      capabilities: new Set(['commands.menu']),
      traits: { observedGroupMessages: 'all' },
    }
    expect(descriptor.source).toEqual({ plugin: 'chat-provider-telegram' })
  })
})
