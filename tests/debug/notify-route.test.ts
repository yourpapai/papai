// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { buildNotifyTarget, handleNotifyRoute } from '../../src/debug/notify-route.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { resetNotifyTokenCacheForTesting } from '../../src/notify-token.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

interface Sent {
  platformInstanceId: string
  target: DeferredDeliveryTarget
  markdown: string
}

class RecordingRouter extends ChatRouter {
  readonly sent: Sent[] = []
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }
  override sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<boolean> {
    this.sent.push({ platformInstanceId, target, markdown })
    return Promise.resolve(true)
  }
}

function notifyReq(token: string | null, body: unknown, method = 'POST'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token !== null) headers['Authorization'] = `Bearer ${token}`
  return new Request('http://x/api/notify', { method, headers, body: JSON.stringify(body) })
}

describe('handleNotifyRoute', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetNotifyTokenCacheForTesting()
    process.env['NOTIFY_TOKEN'] = 'tok'
    insertPlatformInstance({ id: 'pi-1', type: 'telegram', config: {}, status: 'active' })
    insertTaskInstance({ id: 'ti-1', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: 'user-1', taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' })
  })
  afterEach(() => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
    clearRuntimeChatRouter()
  })

  test('delivers a DM notification and returns 200', async () => {
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'hello' }))
    expect(res.status).toBe(200)
    expect(router.sent).toHaveLength(1)
    expect(router.sent[0]?.platformInstanceId).toBe('pi-1')
    expect(router.sent[0]?.markdown).toBe('hello')
    expect(router.sent[0]?.target.contextId).toBe('user-1')
  })

  test('rejects a wrong bearer token with 401', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('nope', { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(401)
  })

  test('returns 503 when no notify_token is configured', async () => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(503)
  })

  test('returns 422 when the chat router is not running', async () => {
    clearRuntimeChatRouter()
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(422)
  })

  test('returns 404 when the context has no platform instance', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'unknown-ctx', markdown: 'x' }))
    expect(res.status).toBe(404)
  })

  test('returns 400 on an invalid body', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1' }))
    expect(res.status).toBe(400)
  })

  test('returns 405 for non-POST', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'x' }, 'GET'))
    expect(res.status).toBe(405)
  })

  test('returns 400 on malformed JSON', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const req = new Request('http://x/api/notify', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: '{not json',
    })
    const res = await handleNotifyRoute(req)
    expect(res.status).toBe(400)
  })

  test('returns 401 when no bearer is provided (no config oracle)', async () => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq(null, { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(401)
  })

  test('returns 502 when delivery throws', async () => {
    const throwingRouter = new RecordingRouter()
    throwingRouter.sendMessage = (): Promise<boolean> => Promise.reject(new Error('network down'))
    setRuntimeChatRouter(throwingRouter)
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(502)
  })
})

describe('buildNotifyTarget', () => {
  test('decodes a scoped DM context to the native user id', () => {
    const scoped = toScopedContextId({
      platformInstanceId: 'mattermost-default',
      nativeContextId: '6q9cpoqy4tb35gozuo1darzgra',
    })
    const target = buildNotifyTarget({ contextId: scoped, markdown: 'hi' })
    expect(target.contextType).toBe('dm')
    expect(target.contextId).toBe('6q9cpoqy4tb35gozuo1darzgra')
    expect(target.createdByUserId).toBe('6q9cpoqy4tb35gozuo1darzgra')
    expect(target.storageContextId).toBe(scoped)
  })

  test('routes a scoped group-thread context into its thread on the native channel', () => {
    const scoped = toScopedThreadContextId({
      platformInstanceId: 'mattermost-default',
      nativeContextId: 'channel-26-char-identifier',
      threadId: 'root-post-26-char-ident-id',
    })
    const target = buildNotifyTarget({ contextId: scoped, markdown: 'hi' })
    expect(target.contextType).toBe('group')
    expect(target.contextId).toBe('channel-26-char-identifier')
    expect(target.threadId).toBe('root-post-26-char-ident-id')
    expect(target.storageContextId).toBe(scoped)
  })
})
