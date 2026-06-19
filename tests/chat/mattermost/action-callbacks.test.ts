// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../../src/chat/interaction-router.js'
import {
  dispatchMattermostProviderAction,
  handleMattermostActionRequest,
  type MattermostProviderActionDispatchDeps,
  registerMattermostActionDispatcher,
  unregisterMattermostActionDispatcher,
} from '../../../src/chat/mattermost/action-callbacks.js'
import { createMattermostActionContext } from '../../../src/chat/mattermost/action-signing.js'
import { toScopedThreadContextId } from '../../../src/chat/scoped-context.js'

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

const requestWithContext = (context: unknown, channelId = 'chan-1', threadId?: string): Request =>
  new Request('https://bot.example/mattermost/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 'user-1',
      post_id: 'post-1',
      channel_id: channelId,
      team_id: 'team-1',
      ...(threadId === undefined ? {} : { root_id: threadId }),
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
    resetPermissionPromptForTesting()
    try {
      const threadId = 'root-post-1'
      const expectedStorageContextId = toScopedThreadContextId({
        platformInstanceId: 'mattermost-main',
        nativeContextId: 'chan-1',
        threadId,
      })
      const calls: Array<{ content: string; options: { buttons?: Array<{ callbackData: string }> } }> = []
      const promptReply = {
        text: (): Promise<void> => Promise.resolve(),
        formatted: (): Promise<void> => Promise.resolve(),
        typing: (): void => {},
        buttons: (content: string, options: { buttons?: Array<{ callbackData: string }> }): Promise<undefined> => {
          calls.push({ content, options })
          return Promise.resolve(undefined)
        },
      }
      void askPermissionViaChat(promptReply, expectedStorageContextId, {
        toolName: 'delete_task',
        reason: 'cleanup',
        args: {},
      })
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
          threadId,
          expiresAt: Date.now() + 60_000,
        },
        secret,
      )
      const routedInteractions: Array<{
        platformInstanceId: string
        storageContextId: string
        threadId: string | undefined
      }> = []
      const apiCalls: string[] = []
      const apiResponses: Record<string, unknown> = {
        'GET /api/v4/channels/chan-1': { type: 'O' },
        'GET /api/v4/channels/chan-1/members/user-1': { roles: '' },
      }
      const deps = {
        platformInstanceId: 'mattermost-main',
        apiFetch: (method, path): Promise<unknown> => {
          const key = `${method} ${path}`
          apiCalls.push(key)
          return Promise.resolve(apiResponses[key])
        },
        interactionHandler: async (interaction, reply): Promise<void> => {
          routedInteractions.push({
            platformInstanceId: interaction.platformInstanceId,
            storageContextId: interaction.storageContextId,
            threadId: interaction.threadId,
          })
          await routeInteraction(interaction, reply, {
            allowed: true,
            isBotAdmin: false,
            isGroupAdmin: false,
            storageContextId: interaction.storageContextId,
          })
        },
      } satisfies MattermostProviderActionDispatchDeps
      registerMattermostActionDispatcher('mattermost-main', (payload) =>
        dispatchMattermostProviderAction(payload, deps),
      )

      const res = await handleMattermostActionRequest(requestWithContext(context, 'chan-1', threadId), {
        getSecret: () => secret,
      })

      expect(await res.json()).toEqual({
        update: { message: `${capturedContent}\n\nAllowed.`, props: {} },
      })
      expect(apiCalls).toEqual(['GET /api/v4/channels/chan-1', 'GET /api/v4/channels/chan-1/members/user-1'])
      expect(routedInteractions).toEqual([
        { platformInstanceId: 'mattermost-main', storageContextId: expectedStorageContextId, threadId },
      ])
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
