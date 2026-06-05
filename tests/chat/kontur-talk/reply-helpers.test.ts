// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createKonturTalkReplyFn } from '../../../plugins/chat-provider-kontur-talk/reply-helpers.js'
import type { ReplyFn } from '../../../src/chat/types.js'

function makeReplyFn(): { reply: ReplyFn; posts: unknown[] } {
  const posts: unknown[] = []
  const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
    posts.push(body)
    return Promise.resolve({ event_id: '$newEvent' })
  }
  const reply = createKonturTalkReplyFn({
    roomId: '!room:host',
    threadId: undefined,
    apiFetch,
  })
  return { reply, posts }
}

describe('createKonturTalkReplyFn', () => {
  test('text() sends plain format message', async () => {
    const { reply, posts } = makeReplyFn()
    await reply.text('Hello')
    expect(posts).toEqual([{ room_id: '!room:host', message: 'Hello', format: 'plain', thread_id: null, mentions: [] }])
  })

  test('formatted() sends markdown format message', async () => {
    const { reply, posts } = makeReplyFn()
    await reply.formatted('**bold**')
    expect(posts).toEqual([
      { room_id: '!room:host', message: '**bold**', format: 'markdown', thread_id: null, mentions: [] },
    ])
  })

  test('text() passes thread_id when present', async () => {
    const posts: unknown[] = []
    const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
      posts.push(body)
      return Promise.resolve({ event_id: '$newEvent' })
    }
    const reply = createKonturTalkReplyFn({
      roomId: '!room:host',
      threadId: '$thread123',
      apiFetch,
    })
    await reply.text('In thread')
    expect(posts).toEqual([
      { room_id: '!room:host', message: 'In thread', format: 'plain', thread_id: '$thread123', mentions: [] },
    ])
  })

  test('text() uses option threadId over default', async () => {
    const posts: unknown[] = []
    const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
      posts.push(body)
      return Promise.resolve({ event_id: '$newEvent' })
    }
    const reply = createKonturTalkReplyFn({
      roomId: '!room:host',
      threadId: '$defaultThread',
      apiFetch,
    })
    await reply.text('Override', { threadId: '$otherThread' })
    expect(posts[0]).toEqual(expect.objectContaining({ thread_id: '$otherThread' }))
  })

  test('typing() is a no-op', () => {
    const { reply } = makeReplyFn()
    expect(() => reply.typing()).not.toThrow()
  })

  test('buttons() throws', async () => {
    const { reply } = makeReplyFn()
    await expect(reply.buttons('content', { buttons: [] })).rejects.toThrow(/does not support/iu)
  })
})
