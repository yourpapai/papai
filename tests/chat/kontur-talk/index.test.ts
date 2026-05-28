// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { KonturTalkChatProvider } from '../../../src/chat/kontur-talk/index.js'
import type { DeferredDeliveryTarget } from '../../../src/chat/types.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

// JWT token with sub="bot123" (base64-encoded payload: {"sub":"bot123","owner":"admin1","iat":1757061777})
const TEST_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib3QxMjMiLCJvd25lciI6ImFkbWluMSIsImlhdCI6MTc1NzA2MTc3N30.test'

const emptyUpdatesResponse = (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify({ updates: [] }), { status: 200 }))

const sentResponse = (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify({ event_id: '$sent' }), { status: 200 }))

const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const GROUP_TARGET: DeferredDeliveryTarget = {
  contextId: '!room:host',
  contextType: 'group',
  threadId: null,
  audience: 'shared',
  mentionUserIds: [],
  createdByUserId: 'user1',
  createdByUsername: null,
}

const DM_TARGET: DeferredDeliveryTarget = {
  contextId: '@user:host',
  contextType: 'dm',
  threadId: null,
  audience: 'personal',
  mentionUserIds: [],
  createdByUserId: 'user1',
  createdByUsername: null,
}

const THREAD_TARGET: DeferredDeliveryTarget = {
  contextId: '!room:host',
  contextType: 'group',
  threadId: '$thread123',
  audience: 'shared',
  mentionUserIds: [],
  createdByUserId: 'user1',
  createdByUsername: null,
}

function parseBody(options: RequestInit | undefined): unknown {
  const body = options?.body
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return JSON.parse(body)
  return undefined
}

function findObjectBody(bodies: unknown[]): object | undefined {
  for (const b of bodies) {
    if (typeof b === 'object' && b !== null && !Array.isArray(b)) {
      return b
    }
  }
  return undefined
}

describe('KonturTalkChatProvider', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    process.env['KONTUR_TALK_JWT_TOKEN'] = TEST_JWT
  })

  afterEach(() => {
    process.env = { ...origEnv }
    restoreFetch()
  })

  test('name is kontur-talk', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.name).toBe('kontur-talk')
  })

  test('capabilities include messages.reply-context', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.capabilities.has('messages.reply-context')).toBe(true)
  })

  test('capabilities do not include messages.buttons', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.capabilities.has('messages.buttons')).toBe(false)
  })

  test('traits observe all group messages', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.traits.observedGroupMessages).toBe('all')
  })

  test('traits max message length is 4096', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.traits.maxMessageLength).toBe(4096)
  })

  test('thread capabilities support threads', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.threadCapabilities.supportsThreads).toBe(true)
    expect(provider.threadCapabilities.canCreateThreads).toBe(true)
    expect(provider.threadCapabilities.threadScope).toBe('message')
  })

  test('config requirements include KONTUR_TALK_JWT_TOKEN', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.configRequirements).toEqual([
      { key: 'KONTUR_TALK_JWT_TOKEN', label: 'Kontur Talk JWT Token', required: true },
    ])
  })

  test('start() extracts botUserId from JWT', async () => {
    setMockFetch(() => emptyUpdatesResponse())
    const provider = new KonturTalkChatProvider()
    await provider.start()
    expect(provider.getBotUserId()).toBe('bot123')
    await provider.stop()
  })

  test('stop() sets running to false', async () => {
    setMockFetch(() => emptyUpdatesResponse())
    const provider = new KonturTalkChatProvider()
    await provider.start()
    await provider.stop()
    expect(provider.isRunning()).toBe(false)
  })

  test('sendMessage for group sends to API', async () => {
    const capturedBodies: unknown[] = []
    setMockFetch((_url: string, options?: RequestInit) => {
      capturedBodies.push(parseBody(options))
      return sentResponse()
    })
    const provider = new KonturTalkChatProvider()

    await provider.sendMessage('kontur-talk-default', GROUP_TARGET, 'Hello group')

    const body = findObjectBody(capturedBodies)
    expect(body).toEqual({
      room_id: '!room:host',
      message: 'Hello group',
      format: 'markdown',
      thread_id: null,
      mentions: [],
    })
  })

  test('sendMessage for DM does not make API call', async () => {
    let fetchCallCount = 0
    setMockFetch(() => {
      fetchCallCount++
      return sentResponse()
    })
    const provider = new KonturTalkChatProvider()
    const callsBefore = fetchCallCount

    await provider.sendMessage('kontur-talk-default', DM_TARGET, 'Hello DM')

    expect(fetchCallCount).toBe(callsBefore)
  })

  test('sendMessage passes threadId when present', async () => {
    const capturedBodies: unknown[] = []
    setMockFetch((_url: string, options?: RequestInit) => {
      capturedBodies.push(parseBody(options))
      return sentResponse()
    })
    const provider = new KonturTalkChatProvider()

    await provider.sendMessage('kontur-talk-default', THREAD_TARGET, 'In thread')

    const body = findObjectBody(capturedBodies)
    expect(body).toHaveProperty('thread_id', '$thread123')
  })

  test('renderContext returns formatted context', () => {
    const provider = new KonturTalkChatProvider()
    const result = provider.renderContext({
      modelName: 'gpt-4',
      totalTokens: 1000,
      maxTokens: 8000,
      approximate: false,
      sections: [],
    })
    expect(result.method).toBe('formatted')
  })

  test('registerCommand stores handler', () => {
    const provider = new KonturTalkChatProvider()
    provider.registerCommand('test', () => Promise.resolve())
  })

  test('onMessage stores handler', () => {
    const provider = new KonturTalkChatProvider()
    provider.onMessage(() => Promise.resolve())
  })

  test('pollLoop skips updates from bot itself', async () => {
    const handledUpdates: Array<Record<string, unknown>> = []
    let callCount = 0
    setMockFetch(() => {
      callCount++
      return delay(10).then(
        () =>
          new Response(
            JSON.stringify({
              updates: [
                {
                  event_id: '$frombot',
                  user_id: 'bot123',
                  room_id: '!room:host',
                  room_is_direct: false,
                  type: 'm.room.message',
                  timestamp: 1000,
                  message_type: 'text',
                  body: 'own message',
                },
              ],
            }),
            { status: 200 },
          ),
      )
    })
    const provider = new KonturTalkChatProvider()
    provider.onMessage((msg) => {
      handledUpdates.push({ text: msg.text })
      return Promise.resolve()
    })
    await provider.start()

    await delay(200)
    await provider.stop()

    expect(handledUpdates).toEqual([])
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  test('pollLoop handles API errors gracefully', async () => {
    let callCount = 0
    setMockFetch(() => {
      callCount++
      return delay(10).then(() => new Response('server error', { status: 500 }))
    })
    const provider = new KonturTalkChatProvider()
    await provider.start()

    await delay(200)
    await provider.stop()

    expect(callCount).toBeGreaterThanOrEqual(1)
  })
})
