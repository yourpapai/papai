// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { providerForResolveContextForManagedInstance } from '../../src/chat/router-helpers.js'
import { registerCommandForManagedInstance } from '../../src/chat/router-helpers.js'
import { registerMessageEditHandlerForManagedInstance } from '../../src/chat/router-helpers.js'
import type { ManagedChatInstance } from '../../src/chat/router-types.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../../src/chat/types.js'
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

const fakeReply: ReplyFn = {
  text: (): Promise<void> => Promise.resolve(),
  formatted: (): Promise<void> => Promise.resolve(),
  typing: () => {},
  buttons: (): Promise<undefined> => Promise.resolve(undefined),
}

const fakeAuth: AuthorizationResult = {
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'user-1',
}

const makeIncomingMessage = (): IncomingMessage => ({
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'user-1',
  contextType: 'dm',
  isMentioned: false,
  text: 'hello',
  platformInstanceId: 'wrong-id',
})

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
    test('wraps the handler with routedMessageHandler so the edit arrives with the instance platformInstanceId', async (): Promise<void> => {
      let captured: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
      const instance = makeInstance({
        id: 'inst-1',
        provider: makeProvider({
          onMessageEdit: (handler): void => {
            captured = handler
          },
        }),
      })
      const seen: IncomingMessage[] = []
      const captureHandler = (msg: IncomingMessage): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      }
      registerMessageEditHandlerForManagedInstance(instance, captureHandler)

      expect(captured).not.toBeNull()
      await captured!(makeIncomingMessage(), fakeReply)

      expect(seen.map((msg): string => msg.platformInstanceId)).toEqual(['inst-1'])
    })

    test('is a no-op when the provider lacks onMessageEdit', (): void => {
      const instance = makeInstance()
      expect((): void => registerMessageEditHandlerForManagedInstance(instance, noopHandler)).not.toThrow()
    })
  })

  describe('registerCommandForManagedInstance', () => {
    test('wraps the command handler so the message arrives with the instance platformInstanceId', async (): Promise<void> => {
      let captured: CommandHandler | null = null
      const instance = makeInstance({
        id: 'inst-1',
        provider: makeProvider({
          registerCommand: (_name, handler): void => {
            captured = handler
          },
        }),
      })
      const seen: IncomingMessage[] = []
      const captureHandler = (msg: IncomingMessage): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      }
      registerCommandForManagedInstance(instance, 'cmd', captureHandler)

      expect(captured).not.toBeNull()
      await captured!(makeIncomingMessage(), fakeReply, fakeAuth)

      expect(seen.map((msg): string => msg.platformInstanceId)).toEqual(['inst-1'])
    })

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
