// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { ChatRouter } from '../../src/chat/router.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { buildNotifyTarget, handleNotifyRoute } from '../../src/debug/notify-route.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { resetNotifyTokenCacheForTesting } from '../../src/notify-token.js'
import { kvGet, kvSet } from '../../src/plugins/store.js'
import * as proactiveHistoryModule from '../../src/proactive-history.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

interface Sent {
  platformInstanceId: string
  target: DeferredDeliveryTarget
  markdown: string
}

interface ReactionCall {
  platformInstanceId: string
  target: DeferredDeliveryTarget
  messageId: string
  emoji: string | null
  previousEmoji: string | null | undefined
}

class RecordingRouter extends ChatRouter {
  readonly sent: Sent[] = []
  readonly reactionCalls: ReactionCall[] = []
  /** Controls {@link setReaction}'s outcome: `'throw'` simulates a provider error; everything
   *  else is the resolved return value. */
  reactionResult: boolean | 'throw' = true
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }
  override sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<boolean> {
    this.sent.push({ platformInstanceId, target, markdown })
    return Promise.resolve(true)
  }
  override async sendProactiveReturningId(
    platformInstanceId: string,
    target: DeferredDeliveryTarget,
    markdown: string,
  ): Promise<{ delivered: boolean; messageId: string | null }> {
    const delivered = await this.sendMessage(platformInstanceId, target, markdown)
    return { delivered, messageId: delivered ? 'P1' : null }
  }
  override setReaction(
    platformInstanceId: string,
    target: DeferredDeliveryTarget,
    messageId: string,
    emoji: string | null,
    previousEmoji?: string | null,
  ): Promise<boolean> {
    this.reactionCalls.push({ platformInstanceId, target, messageId, emoji, previousEmoji })
    if (this.reactionResult === 'throw') return Promise.reject(new Error('reactions unsupported'))
    return Promise.resolve(this.reactionResult)
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
    delete process.env['SETTINGS_PUBLIC_BASE_URL']
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

  test('routes a thread-less authorized-group context to the group channel, not a DM', async () => {
    const scoped = toScopedContextId({
      platformInstanceId: 'mattermost-default',
      nativeContextId: 'channel-26-char-identifier',
    })
    addAuthorizedGroup(scoped, 'admin-user')
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: scoped, markdown: 'done' }))
    expect(res.status).toBe(200)
    expect(router.sent[0]?.target.contextType).toBe('group')
    expect(router.sent[0]?.target.contextId).toBe('channel-26-char-identifier')
    expect(router.sent[0]?.platformInstanceId).toBe('mattermost-default')
  })

  test('returns the thread-scoped storageContextId for a group root post', async () => {
    const scoped = toScopedContextId({
      platformInstanceId: 'mattermost-default',
      nativeContextId: 'channel-26-char-identifier',
    })
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: scoped, contextType: 'group', markdown: 'ack' }))
    expect(res.status).toBe(200)
    const body = z.object({ sent: z.boolean(), storageContextId: z.string().optional() }).parse(await res.json())
    expect(body.sent).toBe(true)
    expect(body.storageContextId).toBe(
      toScopedThreadContextId({
        platformInstanceId: 'mattermost-default',
        nativeContextId: 'channel-26-char-identifier',
        threadId: 'P1',
      }),
    )
  })

  test('does not thread-scope a DM even when a post id is returned', async () => {
    const scoped = toScopedContextId({
      platformInstanceId: 'mattermost-default',
      nativeContextId: '6q9cpoqy4tb35gozuo1darzgra',
    })
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: scoped, contextType: 'dm', markdown: 'ack' }))
    expect(res.status).toBe(200)
    const body = z.object({ sent: z.boolean(), storageContextId: z.string().optional() }).parse(await res.json())
    expect(body.sent).toBe(true)
    expect(body.storageContextId).toBe(scoped)
  })

  test('returns 502 when delivery throws', async () => {
    const throwingRouter = new RecordingRouter()
    throwingRouter.sendMessage = (): Promise<boolean> => Promise.reject(new Error('network down'))
    setRuntimeChatRouter(throwingRouter)
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(502)
  })

  test('appends a transcript link when magiSessionId is present and a public base URL is configured', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://papai.example'
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)
    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'done', magiSessionId: 'sess-1' }),
    )
    expect(res.status).toBe(200)
    expect(router.sent[0]?.markdown).toContain('done')
    expect(router.sent[0]?.markdown).toMatch(/https:\/\/papai\.example\/t\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u)
  })

  test('leaves markdown unchanged when magiSessionId is absent (backward compat)', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://papai.example'
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'done' }))
    expect(res.status).toBe(200)
    expect(router.sent[0]?.markdown).toBe('done')
  })

  test('leaves markdown unchanged when magiSessionId is present but no public base URL is configured', async () => {
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)
    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'done', magiSessionId: 'sess-1' }),
    )
    expect(res.status).toBe(200)
    expect(router.sent[0]?.markdown).toBe('done')
  })

  test('accepts a body with messageId and a structured status', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'm', messageId: 'x', status: 'review' }),
    )
    // A valid status/messageId pair drives a reaction transition (P7) rather than a text post.
    expect(res.status).toBe(204)
  })

  test('rejects an invalid status value with 400', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'm', status: 'not_a_real_status' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('handleNotifyRoute — proactive history recording', () => {
  const spies: Array<{ mockRestore: () => void }> = []

  const track = <T extends { mockRestore: () => void }>(spy: T): T => {
    spies.push(spy)
    return spy
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetNotifyTokenCacheForTesting()
    process.env['NOTIFY_TOKEN'] = 'tok'
    insertPlatformInstance({ id: 'pi-1', type: 'telegram', config: {}, status: 'active' })
    insertTaskInstance({ id: 'ti-1', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: 'pi:inst:ctx:user', taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' })
  })

  afterEach(() => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
    clearRuntimeChatRouter()
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  test('records the delivered notify markdown into history on success', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )

    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'pi:inst:ctx:user', markdown: 'Milestone hit' }))

    expect(res.status).toBe(200)
    expect(recordCalls).toHaveLength(1)
    expect(recordCalls[0]).toEqual(['pi:inst:ctx:user', 'Milestone hit'])
  })

  test('does not record history when delivery fails', async () => {
    const failingRouter = new RecordingRouter()
    failingRouter.sendMessage = (): Promise<boolean> => Promise.resolve(false)
    setRuntimeChatRouter(failingRouter)
    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )

    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'pi:inst:ctx:user', markdown: 'Milestone hit' }))

    expect(res.status).toBe(502)
    expect(recordCalls).toHaveLength(0)
  })
})

describe('handleNotifyRoute — reaction transitions (P7)', () => {
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

  test('drives a reaction transition, records the new emoji, and suppresses the text post when there is no extra substance', async () => {
    kvSet('nerv-reactions', 'user-1', 'reaction:m1', '⏳')
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)

    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'm', messageId: 'm1', status: 'review' }),
    )

    expect(res.status).toBe(204)
    expect(router.reactionCalls).toHaveLength(1)
    expect(router.reactionCalls[0]).toMatchObject({
      platformInstanceId: 'pi-1',
      messageId: 'm1',
      emoji: '👀',
      previousEmoji: '⏳',
    })
    expect(router.sent).toHaveLength(0)
    expect(kvGet('nerv-reactions', 'user-1', 'reaction:m1')).toBe('👀')
  })

  test('drives a reaction transition AND posts extraMarkdown substance (MR link), dropping only the redundant status line', async () => {
    kvSet('nerv-reactions', 'user-1', 'reaction:m1', '⏳')
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)

    const res = await handleNotifyRoute(
      notifyReq('tok', {
        contextId: 'user-1',
        markdown: 'm',
        messageId: 'm1',
        status: 'review',
        extraMarkdown: '**Merge Request:** [!1](url)',
      }),
    )

    expect(res.status).toBe(200)
    expect(router.reactionCalls).toHaveLength(1)
    expect(router.reactionCalls[0]).toMatchObject({ emoji: '👀', previousEmoji: '⏳' })
    expect(router.sent).toHaveLength(1)
    expect(router.sent[0]?.markdown).toBe('**Merge Request:** [!1](url)')
    expect(router.sent[0]?.markdown).not.toBe('m')
    expect(kvGet('nerv-reactions', 'user-1', 'reaction:m1')).toBe('👀')
  })

  test('react-success without extraMarkdown still fully suppresses (204, no post)', async () => {
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)

    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'm', messageId: 'm1', status: 'completed' }),
    )

    expect(res.status).toBe(204)
    expect(router.reactionCalls).toHaveLength(1)
    expect(router.sent).toHaveLength(0)
  })

  test('posts text as today when status/messageId are absent (regression)', async () => {
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)

    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'hello' }))

    expect(res.status).toBe(200)
    expect(router.reactionCalls).toHaveLength(0)
    expect(router.sent).toHaveLength(1)
  })

  test('falls back to the text post when the provider lacks reaction support', async () => {
    const router = new RecordingRouter()
    router.reactionResult = false
    setRuntimeChatRouter(router)

    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'm', messageId: 'm1', status: 'review' }),
    )

    expect(res.status).toBe(200)
    expect(router.reactionCalls).toHaveLength(1)
    expect(router.sent).toHaveLength(1)
    expect(kvGet('nerv-reactions', 'user-1', 'reaction:m1')).toBeUndefined()
  })

  test('falls back to the text post when the provider throws (never 500)', async () => {
    const router = new RecordingRouter()
    router.reactionResult = 'throw'
    setRuntimeChatRouter(router)

    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'm', messageId: 'm1', status: 'completed' }),
    )

    expect(res.status).toBe(200)
    expect(router.sent).toHaveLength(1)
  })

  test('reacts with the status emoji and no previous emoji on the first transition', async () => {
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)

    const res = await handleNotifyRoute(
      notifyReq('tok', { contextId: 'user-1', markdown: 'm', messageId: 'm1', status: 'coding' }),
    )

    expect(res.status).toBe(204)
    expect(router.reactionCalls).toHaveLength(1)
    expect(router.reactionCalls[0]).toMatchObject({ emoji: '⏳', previousEmoji: undefined })
    expect(kvGet('nerv-reactions', 'user-1', 'reaction:m1')).toBe('⏳')
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

  test('routes a thread-less context known to be a group to the native channel, not a DM', () => {
    // magi can echo back a thread-stripped group context id; without the thread it
    // is indistinguishable from a DM by shape alone, so the known-group hint decides.
    const scoped = toScopedContextId({
      platformInstanceId: 'mattermost-default',
      nativeContextId: 'channel-26-char-identifier',
    })
    const target = buildNotifyTarget({ contextId: scoped, markdown: 'hi' }, true)
    expect(target.contextType).toBe('group')
    expect(target.contextId).toBe('channel-26-char-identifier')
    expect(target.threadId).toBeNull()
    expect(target.storageContextId).toBe(scoped)
  })

  test('treats a thread-less context that is not a known group as a DM', () => {
    const scoped = toScopedContextId({
      platformInstanceId: 'mattermost-default',
      nativeContextId: '6q9cpoqy4tb35gozuo1darzgra',
    })
    const target = buildNotifyTarget({ contextId: scoped, markdown: 'hi' }, false)
    expect(target.contextType).toBe('dm')
    expect(target.contextId).toBe('6q9cpoqy4tb35gozuo1darzgra')
  })
})
