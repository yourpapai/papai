// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/smoke/harness/fake-mattermost-server.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { waitFor } from '../../utils/test-helpers.js'
import { startFakeMattermostServer } from './fake-mattermost-server.js'

const channelSchema = z.object({ id: z.string(), type: z.string() })
const frameSchema = z.record(z.string(), z.unknown())
const postedFrameSchema = z.object({ data: z.object({ post: z.string() }) })
const embeddedPostSchema = z.object({ message: z.string(), user_id: z.string() })
const singlePostSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  message: z.string(),
  create_at: z.number(),
})
const threadSchema = z.object({ order: z.array(z.string()), posts: z.record(z.string(), z.object({ id: z.string() })) })

describe('fake Mattermost server', () => {
  test('handshakes, delivers a posted event, and captures the outbound reply', async () => {
    const mm = startFakeMattermostServer({ botUserId: 'bot-1', botUsername: 'smokebot' })
    try {
      expect(await (await fetch(`${mm.localBaseUrl}/api/v4/users/me`)).json()).toEqual({
        id: 'bot-1',
        username: 'smokebot',
      })

      const channel = channelSchema.parse(await (await fetch(`${mm.localBaseUrl}/api/v4/channels/dm-1`)).json())
      expect(channel.type).toBe('D')

      const ws = new WebSocket(`${mm.localBaseUrl.replace('http', 'ws')}/api/v4/websocket`)
      const frames: Array<Record<string, unknown>> = []
      ws.addEventListener('message', (e) => {
        const raw: unknown = JSON.parse(String(e.data))
        frames.push(frameSchema.parse(raw))
      })
      await new Promise<void>((resolve) => {
        ws.addEventListener('open', () => resolve())
      })
      ws.send(JSON.stringify({ seq: 1, action: 'authentication_challenge', data: { token: 't' } }))
      await mm.whenConnected()
      // whenConnected() resolves once the server has sent the `hello` frame, but delivery to
      // this client is a real socket round trip on a later event-loop tick; poll for arrival
      // instead of asserting on a fixed-timing race (see tests/CLAUDE.md).
      await waitFor(() => frames.some((f) => f['event'] === 'hello'))
      expect(frames.some((f) => f['event'] === 'hello')).toBe(true)

      mm.deliverMessage({ channelId: 'dm-1', message: 'hello there', userId: 'admin-user-1' })
      // Same client-side frame-receipt race as the `hello` frame above: poll for arrival
      // instead of a fixed sleep (see tests/CLAUDE.md).
      await waitFor(() => frames.some((f) => f['event'] === 'posted'))
      const posted = frames.find((f) => f['event'] === 'posted')
      expect(posted).toBeDefined()
      const postedFrame = postedFrameSchema.parse(posted)
      const rawEmbedded: unknown = JSON.parse(postedFrame.data.post)
      const embedded = embeddedPostSchema.parse(rawEmbedded)
      expect(embedded.message).toBe('hello there')
      expect(embedded.user_id).toBe('admin-user-1')

      const captured = mm.waitForPost()
      await fetch(`${mm.localBaseUrl}/api/v4/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel_id: 'dm-1', message: 'reply body', root_id: 'in-1' }),
      })
      expect(await captured).toEqual({ channel_id: 'dm-1', message: 'reply body', root_id: 'in-1' })
      ws.close()
    } finally {
      await mm.stop()
    }
  })
})

describe('fake Mattermost server — T3 post + thread endpoints', () => {
  test('serves a seeded single post and records the GET', async () => {
    const mm = startFakeMattermostServer({ botUserId: 'bot-1', botUsername: 'bot' })
    try {
      mm.seedPost({
        id: 'post-1',
        channelId: 'chan-1',
        userId: 'author-1',
        message: 'ship it',
        createAt: 1_700_000_000_000,
      })
      const res = await fetch(`${mm.localBaseUrl}/api/v4/posts/post-1`)
      expect(res.status).toBe(200)
      const body = singlePostSchema.parse(await res.json())
      expect(body).toMatchObject({
        id: 'post-1',
        channel_id: 'chan-1',
        message: 'ship it',
        create_at: 1_700_000_000_000,
      })
      expect(mm.observedGets()).toContain('/api/v4/posts/post-1')
    } finally {
      await mm.stop()
    }
  })

  test('serves a seeded post thread as { order, posts }', async () => {
    const mm = startFakeMattermostServer()
    try {
      mm.seedPost({ id: 'root-1', channelId: 'chan-1', userId: 'author-1', message: 'hello', createAt: 1000 })
      const res = await fetch(`${mm.localBaseUrl}/api/v4/posts/root-1/thread`)
      expect(res.status).toBe(200)
      const body = threadSchema.parse(await res.json())
      expect(body.order).toEqual(['root-1'])
      expect(body.posts['root-1']?.id).toBe('root-1')
      expect(mm.observedGets()).toContain('/api/v4/posts/root-1/thread')
    } finally {
      await mm.stop()
    }
  })

  test('returns 404 for an unseeded single post', async () => {
    const mm = startFakeMattermostServer()
    try {
      const res = await fetch(`${mm.localBaseUrl}/api/v4/posts/missing`)
      expect(res.status).toBe(404)
    } finally {
      await mm.stop()
    }
  })
})
