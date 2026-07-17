// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type {
  MattermostActionContextInput,
  MattermostSignedActionContext,
} from '../../../src/chat/mattermost/action-signing.js'
import { createMattermostReplyFn, sendMattermostDeferredButtons } from '../../../src/chat/mattermost/reply-helpers.js'
import type { ReplyFn } from '../../../src/chat/types.js'
import { mockLogger } from '../../utils/test-helpers.js'

interface ReplyFnResult {
  reply: ReplyFn
  posts: unknown[]
  apiCalls: Array<{ method: string; path: string; body: unknown }>
}

describe('createMattermostReplyFn', () => {
  beforeEach(() => {
    mockLogger()
  })

  function makeReplyFn(callbackBaseUrl: string | null = 'https://bot.example', threadId?: string): ReplyFnResult {
    const posts: unknown[] = []
    const apiCalls: Array<{ method: string; path: string; body: unknown }> = []
    const apiFetch = (method: string, path: string, body: unknown): Promise<Record<string, string>> => {
      apiCalls.push({ method, path, body })
      if (method === 'POST' && path === '/api/v4/posts') {
        posts.push(body)
      }
      return Promise.resolve({ id: 'post-1' })
    }
    const wsSend = (): void => {}
    const uploadFile = (): Promise<string> => Promise.resolve('file-1')

    const reply = createMattermostReplyFn({
      channelId: 'chan-1',
      postId: 'post-1',
      threadId,
      getWsSeq: () => 1,
      apiFetch,
      wsSend,
      uploadFile,
      platformInstanceId: 'mattermost-main',
      callbackBaseUrl,
      createActionContext: (input) => {
        const threadPatch = input.threadId === undefined ? {} : { threadId: input.threadId }
        return {
          version: 1,
          platformInstanceId: input.platformInstanceId,
          channelId: input.channelId,
          callbackData: input.callbackData,
          sourceMessageText: input.sourceMessageText,
          expiresAt: input.expiresAt,
          nonce: 'nonce-nonce-nonce',
          signature: 'signature-signature-signature-signature-signature',
          ...threadPatch,
        }
      },
    })

    return { reply, posts, apiCalls }
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
                    context: { channelId: 'chan-1', callbackData: 'perm:a:abc12345', sourceMessageText: 'choose' },
                  },
                },
                {
                  id: 'action1',
                  type: 'button',
                  name: 'Deny',
                  style: 'default',
                  integration: {
                    url: 'https://bot.example/mattermost/actions',
                    context: { channelId: 'chan-1', callbackData: 'perm:d:abc12345', sourceMessageText: 'choose' },
                  },
                },
              ],
            },
          ],
        },
      })
    })

    test('returns a handle whose remove() issues DELETE for the created post id', async () => {
      const { reply, apiCalls } = makeReplyFn()

      const handle = await reply.buttons('choose', {
        buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345', style: 'primary' }],
      })

      expect(handle).toBeDefined()
      await handle!.remove()

      const deleteCall = apiCalls.find((c) => c.method === 'DELETE')
      expect(deleteCall).toBeDefined()
      expect(deleteCall!.path).toBe('/api/v4/posts/post-1')
    })

    test('returns a handle whose redact() issues PUT patch with new text and clears props', async () => {
      const { reply, apiCalls } = makeReplyFn()

      const handle = await reply.buttons('choose', {
        buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345', style: 'primary' }],
      })

      expect(handle).toBeDefined()
      await handle!.redact('Prompt expired.')

      const putCall = apiCalls.find((c) => c.method === 'PUT')
      expect(putCall).toBeDefined()
      expect(putCall!.path).toBe('/api/v4/posts/post-1/patch')
      expect(putCall!.body).toMatchObject({ message: 'Prompt expired.', props: {} })
    })

    test('rejects when callback base URL is missing', async () => {
      const { reply } = makeReplyFn(null)

      await expect(
        reply.buttons('choose', {
          buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345' }],
        }),
      ).rejects.toThrow('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL')
    })

    test('includes the active thread id in action context', async () => {
      const { reply, posts } = makeReplyFn('https://bot.example', 'root-post-1')

      await reply.buttons('choose', {
        buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345' }],
      })

      expect(posts[0]).toMatchObject({
        root_id: 'root-post-1',
        props: {
          attachments: [
            {
              actions: [
                {
                  integration: {
                    context: { threadId: 'root-post-1' },
                  },
                },
              ],
            },
          ],
        },
      })
    })

    test('prefers an explicit reply thread id in action context', async () => {
      const { reply, posts } = makeReplyFn('https://bot.example', 'root-post-1')

      await reply.buttons('choose', {
        threadId: 'root-post-2',
        buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345' }],
      })

      expect(posts[0]).toMatchObject({
        root_id: 'root-post-2',
        props: {
          attachments: [
            {
              actions: [
                {
                  integration: {
                    context: { threadId: 'root-post-2' },
                  },
                },
              ],
            },
          ],
        },
      })
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

  describe('createStatus', () => {
    test('posts the status then updates and dismisses it', async () => {
      const { reply, apiCalls } = makeReplyFn()
      assert(reply.createStatus !== undefined, 'expected createStatus')

      const handle = await reply.createStatus('💭 Thinking…')
      assert(handle !== undefined, 'expected a status handle')
      await handle.update('📝 Creating task…')
      await handle.dismiss()

      const postCall = apiCalls.find((c) => c.method === 'POST')
      expect(postCall).toBeDefined()
      expect(postCall?.path).toBe('/api/v4/posts')
      expect(postCall?.body).toMatchObject({ message: '💭 Thinking…' })

      const patchCall = apiCalls.find((c) => c.method === 'PUT')
      expect(patchCall).toBeDefined()
      expect(patchCall?.path).toBe('/api/v4/posts/post-1/patch')
      expect(patchCall?.body).toMatchObject({ message: '📝 Creating task…' })

      const delCall = apiCalls.find((c) => c.method === 'DELETE')
      expect(delCall).toBeDefined()
      expect(delCall?.path).toBe('/api/v4/posts/post-1')
    })

    test('returns undefined (never rejects) when the post fails', async () => {
      const reply = createMattermostReplyFn({
        channelId: 'chan-1',
        getWsSeq: () => 1,
        apiFetch: (): Promise<unknown> => Promise.reject(new Error('mattermost down')),
        wsSend: () => {},
        uploadFile: () => Promise.resolve('file-1'),
        platformInstanceId: 'mattermost-main',
        callbackBaseUrl: 'https://bot.example',
        createActionContext: () => {
          throw new Error('not used in this test')
        },
      })
      assert(reply.createStatus !== undefined, 'expected createStatus')
      expect(await reply.createStatus('💭 Thinking…')).toBeUndefined()
    })
  })
})

function fakeButtonActionContext(input: MattermostActionContextInput): MattermostSignedActionContext {
  const threadPatch = input.threadId === undefined ? {} : { threadId: input.threadId }
  return {
    version: 1,
    platformInstanceId: input.platformInstanceId,
    channelId: input.channelId,
    callbackData: input.callbackData,
    sourceMessageText: input.sourceMessageText,
    expiresAt: input.expiresAt,
    nonce: 'nonce-nonce-nonce',
    signature: 'signature-signature-signature-signature-signature',
    ...threadPatch,
  }
}

function makeRecordingApiFetch(
  calls: Array<{ method: string; path: string; body: unknown }>,
  responses: Partial<Record<string, unknown>>,
): (method: string, path: string, body: unknown) => Promise<unknown> {
  return (method: string, path: string, body: unknown): Promise<unknown> => {
    calls.push({ method, path, body })
    return Promise.resolve(responses[path] ?? { id: 'post-1' })
  }
}

describe('sendMattermostDeferredButtons', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('posts props.attachments.actions for a group thread', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const apiFetch = makeRecordingApiFetch(calls, {})
    const id = await sendMattermostDeferredButtons(
      'bot-user',
      {
        contextId: 'chan-1',
        contextType: 'group',
        threadId: 'root-1',
        audience: 'shared',
        mentionUserIds: [],
        createdByUserId: '',
        createdByUsername: null,
      },
      '🔐 Approve?',
      [
        { text: '✅ Allow', callbackData: 'mperm:a:abc', style: 'primary' },
        { text: '🚫 Deny', callbackData: 'mperm:d:abc', style: 'danger' },
      ],
      {
        platformInstanceId: 'pi-1',
        callbackBaseUrl: 'https://papai.example',
        createActionContext: fakeButtonActionContext,
        apiFetch,
      },
    )
    expect(id).toBe('post-1')
    const post = calls.find((c) => c.path === '/api/v4/posts')!
    expect(post.body).toMatchObject({
      root_id: 'root-1',
      props: {
        attachments: [
          {
            actions: [
              { integration: { context: { callbackData: 'mperm:a:abc' } } },
              { integration: { context: { callbackData: 'mperm:d:abc' } } },
            ],
          },
        ],
      },
    })
  })

  test('resolves the direct channel first for a DM target', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const apiFetch = makeRecordingApiFetch(calls, { '/api/v4/channels/direct': { id: 'dm-chan-1' } })
    const id = await sendMattermostDeferredButtons(
      'bot-user',
      {
        contextId: 'user-1',
        contextType: 'dm',
        threadId: null,
        audience: 'personal',
        mentionUserIds: [],
        createdByUserId: 'user-1',
        createdByUsername: null,
      },
      '🔐 Approve?',
      [{ text: '✅ Allow', callbackData: 'mperm:a:abc', style: 'primary' }],
      {
        platformInstanceId: 'pi-1',
        callbackBaseUrl: 'https://papai.example',
        createActionContext: fakeButtonActionContext,
        apiFetch,
      },
    )
    expect(id).toBe('post-1')
    const dmCall = calls.find((c) => c.path === '/api/v4/channels/direct')
    expect(dmCall).toBeDefined()
    expect(dmCall!.body).toEqual(['bot-user', 'user-1'])
    const post = calls.find((c) => c.path === '/api/v4/posts')!
    expect(post.body).toMatchObject({ channel_id: 'dm-chan-1' })
  })

  test('throws when callback base URL is missing', async () => {
    const apiFetch = (): Promise<unknown> => Promise.resolve({ id: 'post-1' })
    await expect(
      sendMattermostDeferredButtons(
        'bot-user',
        {
          contextId: 'chan-1',
          contextType: 'group',
          threadId: null,
          audience: 'shared',
          mentionUserIds: [],
          createdByUserId: '',
          createdByUsername: null,
        },
        '🔐 Approve?',
        [{ text: '✅ Allow', callbackData: 'mperm:a:abc', style: 'primary' }],
        {
          platformInstanceId: 'pi-1',
          callbackBaseUrl: null,
          createActionContext: () => {
            throw new Error('not used in this test')
          },
          apiFetch,
        },
      ),
    ).rejects.toThrow('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL')
  })
})
