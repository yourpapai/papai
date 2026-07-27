// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { providerForResolveContextForManagedInstance } from '../../src/chat/router-helpers.js'
import { registerCommandForManagedInstance } from '../../src/chat/router-helpers.js'
import { registerMessageEditHandlerForManagedInstance } from '../../src/chat/router-helpers.js'
import type { ManagedChatInstance } from '../../src/chat/router-types.js'
import type { ChatProvider, CommandHandler, ResolveUserContext } from '../../src/chat/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type ContextRenderedShape = { method: 'text'; content: string }

const makeProvider = (overrides: Partial<ChatProvider> = {}): ChatProvider => ({
  name: 'test',
  threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
  capabilities: new Set(),
  traits: { observedGroupMessages: 'all' },
  configRequirements: [],
  registerCommand: (): void => {},
  onMessage: (): void => {},
  sendMessage: (): Promise<void> => Promise.resolve(),
  renderContext: (): ContextRenderedShape => ({ method: 'text', content: '' }),
  start: (): Promise<void> => Promise.resolve(),
  stop: (): Promise<void> => Promise.resolve(),
  ...overrides,
})

const makeInstance = (overrides: Partial<ManagedChatInstance> = {}): ManagedChatInstance => ({
  id: 'inst-1',
  type: 'telegram',
  provider: makeProvider(),
  status: 'active',
  configFingerprint: 'fp',
  ...overrides,
})

const noopHandler = (): Promise<void> => Promise.resolve()

describe('router-helpers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('providerForResolveContextForManagedInstance', () => {
    test('returns the provider for the context platformInstanceId', (): void => {
      const provider = makeProvider()
      const instances = new Map([['telegram-1', makeInstance({ id: 'telegram-1', provider })]])
      const context: ResolveUserContext = { contextId: 'c', contextType: 'dm', platformInstanceId: 'telegram-1' }
      expect(providerForResolveContextForManagedInstance(instances, context)).toBe(provider)
    })

    test('returns null when platformInstanceId is unknown', (): void => {
      const instances = new Map<string, ManagedChatInstance>()
      const context: ResolveUserContext = { contextId: 'c', contextType: 'dm', platformInstanceId: 'missing' }
      expect(providerForResolveContextForManagedInstance(instances, context)).toBeNull()
    })
  })

  describe('registerMessageEditHandlerForManagedInstance', () => {
    test('registers via provider.onMessageEdit when present', (): void => {
      let called = false
      const instance = makeInstance({
        provider: makeProvider({
          onMessageEdit: (): void => {
            called = true
          },
        }),
      })
      registerMessageEditHandlerForManagedInstance(instance, noopHandler)
      expect(called).toBe(true)
    })

    test('is a no-op when the provider lacks onMessageEdit', (): void => {
      const instance = makeInstance()
      expect((): void => registerMessageEditHandlerForManagedInstance(instance, noopHandler)).not.toThrow()
    })
  })

  describe('registerCommandForManagedInstance', () => {
    test('registers via provider.registerCommand with the given name', (): void => {
      const names: string[] = []
      const instance = makeInstance({
        provider: makeProvider({
          registerCommand: (name: string): void => {
            names.push(name)
          },
        }),
      })
      const handler: CommandHandler = (): Promise<void> => Promise.resolve()
      registerCommandForManagedInstance(instance, 'cmd', handler)
      expect(names).toEqual(['cmd'])
    })
  })
})
