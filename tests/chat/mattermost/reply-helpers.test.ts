// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { createMattermostReplyFn } from '../../../src/chat/mattermost/reply-helpers.js'
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

  function makeReplyFn(callbackBaseUrl: string | null = 'https://bot.example'): ReplyFnResult {
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
      getWsSeq: () => 1,
      apiFetch,
      wsSend,
      uploadFile,
      platformInstanceId: 'mattermost-main',
      callbackBaseUrl,
      createActionContext: (input) => ({
        version: 1,
        platformInstanceId: input.platformInstanceId,
        callbackData: input.callbackData,
        sourceMessageText: input.sourceMessageText,
        expiresAt: input.expiresAt,
        nonce: 'nonce-nonce-nonce',
        signature: 'signature-signature-signature-signature-signature',
      }),
    })

    return { reply, posts }
  }

  describe('buttons', () => {
    test('posts Mattermost attachment actions', async () => {
      const { reply, posts } = makeReplyFn()

      await reply.buttons('choose', {
        buttons: [
          { text: 'Allow', callbackData: 'perm:a:abc12345', style: 'primary' },
          { text: 'Deny', callbackData: 'perm:d:abc12345' },
        ],
      })

      expect(posts).toHaveLength(1)
      expect(posts[0]).toMatchObject({
        channel_id: 'chan-1',
        message: 'choose',
        root_id: '',
        props: {
          attachments: [
            {
              actions: [
                {
                  id: 'action0',
                  type: 'button',
                  name: 'Allow',
                  style: 'primary',
                  integration: {
                    url: 'https://bot.example/mattermost/actions',
                    context: { callbackData: 'perm:a:abc12345', sourceMessageText: 'choose' },
                  },
                },
                {
                  id: 'action1',
                  type: 'button',
                  name: 'Deny',
                  style: 'default',
                  integration: {
                    url: 'https://bot.example/mattermost/actions',
                    context: { callbackData: 'perm:d:abc12345', sourceMessageText: 'choose' },
                  },
                },
              ],
            },
          ],
        },
      })
    })

    test('rejects when callback base URL is missing', async () => {
      const { reply } = makeReplyFn(null)

      await expect(
        reply.buttons('choose', {
          buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345' }],
        }),
      ).rejects.toThrow('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL')
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
