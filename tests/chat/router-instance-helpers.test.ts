// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { sendProactiveButtonsReturningIdForManagedInstance } from '../../src/chat/router-instance-helpers.js'
import type { ManagedChatInstance } from '../../src/chat/router-types.js'
import { dmTarget } from '../../src/chat/types.js'
import type { ChatButton, ChatProvider, DeferredDeliveryTarget } from '../../src/chat/types.js'

const target = (): DeferredDeliveryTarget => dmTarget('user-1')

const buttons: ChatButton[] = [{ text: 'Allow', callbackData: 'mperm:a:abc' }]

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

const instanceWithProvider = (provider: ChatProvider): Map<string, ManagedChatInstance> =>
  new Map([['pi-1', { id: 'pi-1', type: 'mattermost', provider, status: 'active', configFingerprint: 'fp' }]])

describe('sendProactiveButtonsReturningIdForManagedInstance', () => {
  test('reports unsupported without sending when the provider lacks sendButtonsReturningId', async () => {
    const instances = instanceWithProvider(baseProvider('mattermost'))

    const res = await sendProactiveButtonsReturningIdForManagedInstance(
      instances,
      () => true,
      'pi-1',
      target(),
      'hi',
      buttons,
    )

    expect(res).toEqual({ delivered: false, messageId: null, supported: false })
  })

  test('delegates to the provider and reports supported when it implements sendButtonsReturningId', async () => {
    const sendButtonsReturningId = mock(() => Promise.resolve('post-9'))
    const instances = instanceWithProvider({ ...baseProvider('mattermost'), sendButtonsReturningId })

    const res = await sendProactiveButtonsReturningIdForManagedInstance(
      instances,
      () => true,
      'pi-1',
      target(),
      'hi',
      buttons,
    )

    expect(res).toEqual({ delivered: true, messageId: 'post-9', supported: true })
    expect(sendButtonsReturningId).toHaveBeenCalledWith('pi-1', target(), 'hi', buttons)
  })

  test('reports not-delivered but supported for an unknown platform instance id', async () => {
    const instances = instanceWithProvider(baseProvider('mattermost'))

    const res = await sendProactiveButtonsReturningIdForManagedInstance(
      instances,
      () => true,
      'missing',
      target(),
      'hi',
      buttons,
    )

    expect(res).toEqual({ delivered: false, messageId: null, supported: true })
  })
})
