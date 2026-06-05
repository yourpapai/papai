// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { createMattermostReplyFn } from '../../../plugins/chat-provider-mattermost/reply-helpers.js'
import type { ReplyFn } from '../../../src/chat/types.js'
import { mockLogger } from '../../utils/test-helpers.js'

interface ReplyFnResult {
  reply: ReplyFn
  posts: unknown[]
}

describe('createMattermostReplyFn', () => {
  beforeEach(() => {
    mockLogger()
  })

  function makeReplyFn(): ReplyFnResult {
    const posts: unknown[] = []
    const apiFetch = (_method: string, _path: string, body: unknown): Promise<Record<string, string>> => {
      posts.push(body)
      return Promise.resolve({ id: 'post-1' })
    }
    const wsSend = (): void => {}
    const uploadFile = (): Promise<string> => Promise.resolve('file-1')

    const reply = createMattermostReplyFn({
      channelId: 'chan-1',
      postId: 'post-1',
      threadId: undefined,
      baseUrl: 'http://localhost:8065',
      getWsSeq: () => 1,
      apiFetch,
      wsSend,
      uploadFile,
    })

    return { reply, posts }
  }

  describe('buttons', () => {
    test('throws error when called', async () => {
      const { reply } = makeReplyFn()

      await expect(
        reply.buttons('choose', {
          buttons: [{ text: 'Yes', callbackData: 'cb:y' }],
        }),
      ).rejects.toThrow('This platform does not support interactive buttons.')
    })

    test('error message states platform does not support interactive buttons', async () => {
      const { reply } = makeReplyFn()

      await expect(
        reply.buttons('choose', {
          buttons: [{ text: 'Yes', callbackData: 'cb:y' }],
        }),
      ).rejects.toThrow('This platform does not support interactive buttons.')
    })
  })

  describe('text', () => {
    test('posts message via apiFetch', async () => {
      const { reply, posts } = makeReplyFn()

      await reply.text('hello world')

      expect(posts).toHaveLength(1)
      expect(posts[0]).toMatchObject({
        channel_id: 'chan-1',
        message: 'hello world',
      })
    })
  })

  describe('formatted', () => {
    test('posts markdown via apiFetch', async () => {
      const { reply, posts } = makeReplyFn()

      await reply.formatted('**bold** text')

      expect(posts).toHaveLength(1)
      expect(posts[0]).toMatchObject({
        channel_id: 'chan-1',
        message: '**bold** text',
      })
    })
  })
})
