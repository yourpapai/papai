// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  handleMattermostActionRequest,
  registerMattermostActionDispatcher,
  unregisterMattermostActionDispatcher,
} from '../../../src/chat/mattermost/action-callbacks.js'
import { createMattermostActionContext } from '../../../src/chat/mattermost/action-signing.js'

const secret = 'test-secret'

const validContext = (): ReturnType<typeof createMattermostActionContext> =>
  createMattermostActionContext(
    {
      platformInstanceId: 'mattermost-main',
      channelId: 'chan-1',
      callbackData: 'perm:a:abc12345',
      sourceMessageText: 'Run `delete_task`?\n\nReason',
      expiresAt: Date.now() + 60_000,
    },
    secret,
  )

const requestWithContext = (context: unknown, channelId = 'chan-1'): Request =>
  new Request('https://bot.example/mattermost/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 'user-1',
      post_id: 'post-1',
      channel_id: channelId,
      team_id: 'team-1',
      context,
    }),
  })

describe('Mattermost action callbacks', () => {
  afterEach(() => unregisterMattermostActionDispatcher('mattermost-main'))

  test('dispatches valid signed callbacks to registered provider', async () => {
    const calls: unknown[] = []
    registerMattermostActionDispatcher('mattermost-main', (payload) => {
      calls.push(payload)
      return Promise.resolve({ update: { message: 'updated', props: {} } })
    })

    const res = await handleMattermostActionRequest(requestWithContext(validContext()), { getSecret: () => secret })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ update: { message: 'updated', props: {} } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      userId: 'user-1',
      postId: 'post-1',
      channelId: 'chan-1',
      teamId: 'team-1',
      action: { platformInstanceId: 'mattermost-main', channelId: 'chan-1', callbackData: 'perm:a:abc12345' },
    })
  })

  test('returns original prompt plus decision update for permission callbacks', async () => {
    const { askPermissionViaChat, resetPermissionPromptForTesting } =
      await import('../../../src/chat/permission-prompt.js')
    const { routeInteraction } = await import('../../../src/chat/interaction-router.js')
    resetPermissionPromptForTesting()
    try {
      const calls: Array<{ content: string; options: { buttons?: Array<{ callbackData: string }> } }> = []
      const promptReply = {
        text: (): Promise<void> => Promise.resolve(),
        formatted: (): Promise<void> => Promise.resolve(),
        typing: (): void => {},
        buttons: (content: string, options: { buttons?: Array<{ callbackData: string }> }): Promise<void> => {
          calls.push({ content, options })
          return Promise.resolve()
        },
      }
      void askPermissionViaChat(promptReply, 'chan-1', { toolName: 'delete_task', reason: 'cleanup' })
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      const capturedContent = calls[0]!.content
      const callbackData = calls[0]!.options.buttons![0]!.callbackData
      const context = createMattermostActionContext(
        {
          platformInstanceId: 'mattermost-main',
          channelId: 'chan-1',
          callbackData,
          sourceMessageText: capturedContent,
          expiresAt: Date.now() + 60_000,
        },
        secret,
      )
      registerMattermostActionDispatcher('mattermost-main', async (payload) => {
        let response: { update: { message: string; props: Record<string, unknown> } } | { ephemeral_text: string } = {
          ephemeral_text: 'not handled',
        }
        const reply = {
          text: (content: string): Promise<void> => {
            response = { ephemeral_text: content }
            return Promise.resolve()
          },
          formatted: (content: string): Promise<void> => {
            response = { ephemeral_text: content }
            return Promise.resolve()
          },
          typing: (): void => {},
          buttons: (): Promise<void> => Promise.resolve(),
          replaceText: (content: string): Promise<void> => {
            response = { update: { message: content, props: {} } }
            return Promise.resolve()
          },
        }
        await routeInteraction(
          {
            kind: 'button',
            user: { id: payload.userId, username: null, isAdmin: false },
            contextId: payload.channelId,
            contextType: 'group',
            platformInstanceId: payload.action.platformInstanceId,
            storageContextId: payload.channelId,
            callbackData: payload.action.callbackData,
            messageId: payload.postId,
            sourceMessageText: payload.action.sourceMessageText,
          },
          reply,
          { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: payload.channelId },
        )
        return response
      })

      const res = await handleMattermostActionRequest(requestWithContext(context), { getSecret: () => secret })

      expect(await res.json()).toEqual({
        update: { message: `${capturedContent}\n\nAllowed.`, props: {} },
      })
    } finally {
      unregisterMattermostActionDispatcher('mattermost-main')
      resetPermissionPromptForTesting()
    }
  })

  test('returns Mattermost error when request channel differs from signed context channel', async () => {
    const calls: unknown[] = []
    registerMattermostActionDispatcher('mattermost-main', (payload) => {
      calls.push(payload)
      return Promise.resolve({ update: { message: 'updated', props: {} } })
    })

    const res = await handleMattermostActionRequest(requestWithContext(validContext(), 'chan-2'), {
      getSecret: () => secret,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: { message: 'This action is no longer valid.' } })
    expect(calls).toHaveLength(0)
  })

  test('returns Mattermost error for invalid signature', async () => {
    const context = { ...validContext(), callbackData: 'perm:d:abc12345' }
    const res = await handleMattermostActionRequest(requestWithContext(context), { getSecret: () => secret })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: { message: 'This action is no longer valid.' } })
  })

  test('returns unavailable response when no dispatcher is registered', async () => {
    const res = await handleMattermostActionRequest(requestWithContext(validContext()), { getSecret: () => secret })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ephemeral_text: 'Action is no longer available.' })
  })
})
