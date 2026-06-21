// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { routeRequestForTest } from '../../src/debug/server.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { resetNotifyTokenCacheForTesting } from '../../src/notify-token.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

class OkRouter extends ChatRouter {
  constructor() {
    super(() => {
      throw new Error('unused')
    })
  }
  override sendMessage(_p: string, _t: DeferredDeliveryTarget, _m: string): Promise<boolean> {
    return Promise.resolve(true)
  }
}

describe('/api/notify routing', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetNotifyTokenCacheForTesting()
    process.env['NOTIFY_TOKEN'] = 'tok'
    insertPlatformInstance({ id: 'pi-1', type: 'telegram', config: {}, status: 'active' })
    insertTaskInstance({ id: 'ti-1', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: 'user-1', taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' })
    setRuntimeChatRouter(new OkRouter())
  })
  afterEach(() => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
    clearRuntimeChatRouter()
  })

  test('is reachable with its own token even when debug is disabled', async () => {
    const req = new Request('http://x/api/notify', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextId: 'user-1', markdown: 'hi' }),
    })
    const res = await routeRequestForTest(req, { debugEnabled: false })
    expect(res.status).toBe(200)
  })

  test('handled here (own 401), not the dashboard session 401', async () => {
    const req = new Request('http://x/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextId: 'user-1', markdown: 'hi' }),
    })
    const res = await routeRequestForTest(req, { debugEnabled: false })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })
})
