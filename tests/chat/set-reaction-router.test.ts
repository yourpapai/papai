// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { ChatRouter, type ManagedChatInstanceFactory } from '../../src/chat/router.js'
import { dmTarget } from '../../src/chat/types.js'
import type { ChatProvider } from '../../src/chat/types.js'
import type { PlatformInstanceType } from '../../src/instances/types.js'

const target = dmTarget('user-1')

const baseProvider = (name: string): ChatProvider => ({
  name,
  threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
  capabilities: new Set(),
  traits: { observedGroupMessages: 'all' },
  configRequirements: [],
  registerCommand: (): void => {},
  onMessage: (): void => {},
  sendMessage: (): Promise<boolean> => Promise.resolve(true),
  renderContext: () => ({ method: 'text', content: `${name} context` }) as const,
  start: (): Promise<void> => Promise.resolve(),
  stop: (): Promise<void> => Promise.resolve(),
})

describe('ChatRouter.setReaction', () => {
  test('delegates to the addressed instance provider when it supports setReaction', async () => {
    const setReaction = mock(() => Promise.resolve(true))
    const factory: ManagedChatInstanceFactory = (_id, type: PlatformInstanceType): ChatProvider => ({
      ...baseProvider(type),
      setReaction,
    })
    const router = new ChatRouter(factory)
    router.addInstance('mm-main', 'mattermost', {})

    const result = await router.setReaction('mm-main', target, 'm1', '👀', '⏳')

    expect(setReaction).toHaveBeenCalledWith('mm-main', target, 'm1', '👀', '⏳')
    expect(result).toBe(true)
  })

  test('resolves false without throwing when the provider lacks setReaction', async () => {
    const factory: ManagedChatInstanceFactory = (_id, type: PlatformInstanceType): ChatProvider => baseProvider(type)
    const router = new ChatRouter(factory)
    router.addInstance('tg-main', 'telegram', {})

    const result = await router.setReaction('tg-main', target, 'm1', '👀')

    expect(result).toBe(false)
  })

  test('resolves false for an unknown platform instance id', async () => {
    const factory: ManagedChatInstanceFactory = (_id, type: PlatformInstanceType): ChatProvider => baseProvider(type)
    const router = new ChatRouter(factory)

    const result = await router.setReaction('missing', target, 'm1', '👀')

    expect(result).toBe(false)
  })
})
