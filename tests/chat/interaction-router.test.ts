// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import { askPermissionViaChat, resetPermissionPromptForTesting } from '../../src/chat/permission-prompt.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from '../../src/chat/types.js'
import { createMockReply } from '../utils/test-helpers.js'

const auth = (allowed: boolean, storageContextId = 'tg:u1'): AuthorizationResult => ({
  allowed,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId,
})

const interaction = (callbackData: string, contextId = 'tg:u1'): IncomingInteraction => ({
  kind: 'button',
  user: { id: 'u1', username: null, isAdmin: false },
  contextId,
  contextType: 'dm',
  platformInstanceId: 'tg',
  storageContextId: contextId,
  callbackData,
})

async function createPendingPermission(contextId = 'tg:u1'): Promise<{ id: string; decision: Promise<string> }> {
  const calls: Array<{
    options: { buttons?: Array<{ callbackData: string }> }
  }> = []
  const reply: ReplyFn = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: (_content: string, options: { buttons?: Array<{ callbackData: string }> }) => {
      calls.push({ options })
      return Promise.resolve(undefined)
    },
  }
  const decision = askPermissionViaChat(reply, contextId, {
    toolName: 'delete_task',
    reason: 'cleanup',
    args: { id: 'task-123' },
  })
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  return {
    id: calls[0]!.options.buttons![0]!.callbackData.replace('perm:a:', ''),
    decision,
  }
}

async function createPendingPermissionId(contextId = 'tg:u1'): Promise<string> {
  const { id } = await createPendingPermission(contextId)
  return id
}

describe('routeInteraction (post-retirement)', () => {
  beforeEach(() => resetPermissionPromptForTesting())
  afterEach(() => resetPermissionPromptForTesting())

  test('rejects an unauthorized interaction', async () => {
    const { reply, getReplies } = createMockReply()
    const handled = await routeInteraction(interaction('anything'), reply, auth(false))
    expect(handled).toBe(true)
    expect(getReplies()[0]).toContain('not authorized')
  })

  test('matches no route for any callback and returns false', async () => {
    const { reply } = createMockReply()
    for (const data of ['cfg:edit:x', 'gsel:foo', 'wizard_confirm', 'plg:enable:p', 'tgl:dom:x', 'whatever']) {
      expect(await routeInteraction(interaction(data), reply, auth(true))).toBe(false)
    }
  })

  test('resolves allow permission callbacks and replaces the prompt when possible', async () => {
    const id = await createPendingPermissionId()
    const replacements: string[] = []
    const { reply } = createMockReply()
    reply.replaceText = (content: string): Promise<void> => {
      replacements.push(content)
      return Promise.resolve()
    }

    const handled = await routeInteraction(
      {
        ...interaction(`perm:a:${id}`),
        sourceMessageText: 'Run `delete_task`?\n\ncleanup',
      },
      reply,
      auth(true),
    )

    expect(handled).toBe(true)
    expect(replacements).toEqual(['Run `delete_task`?\n\ncleanup\n\nAllowed delete_task ✅'])
  })

  test('resolves deny permission callbacks and replaces the prompt when possible', async () => {
    const id = await createPendingPermissionId()
    const replacements: string[] = []
    const { reply } = createMockReply()
    reply.replaceText = (content: string): Promise<void> => {
      replacements.push(content)
      return Promise.resolve()
    }

    const handled = await routeInteraction(
      {
        ...interaction(`perm:d:${id}`),
        sourceMessageText: 'Run `delete_task`?\n\ncleanup',
      },
      reply,
      auth(true),
    )

    expect(handled).toBe(true)
    expect(replacements).toEqual(['Run `delete_task`?\n\ncleanup\n\nDenied delete_task 🚫'])
  })

  test('reports missing permission requests as unavailable', async () => {
    const { reply, getReplies } = createMockReply()
    const handled = await routeInteraction(interaction('perm:a:missing1'), reply, auth(true))

    expect(handled).toBe(true)
    expect(getReplies()[0]).toContain('Action is no longer available')
  })

  test('does not resolve permission callbacks from another context', async () => {
    const { id, decision } = await createPendingPermission('ctx-a')
    const blockedReply = createMockReply()

    const blocked = await routeInteraction(
      interaction(`perm:a:${id}`, 'ctx-b'),
      blockedReply.reply,
      auth(true, 'ctx-b'),
    )

    expect(blocked).toBe(true)
    expect(blockedReply.getReplies()[0]).toContain('Action is no longer available')

    const allowedReply = createMockReply()
    const allowed = await routeInteraction(
      interaction(`perm:a:${id}`, 'ctx-a'),
      allowedReply.reply,
      auth(true, 'ctx-a'),
    )

    expect(allowed).toBe(true)
    expect(await decision).toBe('allow')
  })

  test('falls back to text when replacing the permission prompt fails', async () => {
    const id = await createPendingPermissionId()
    const { reply, getReplies } = createMockReply()
    reply.replaceText = (): Promise<void> => Promise.reject(new Error('edit failed'))

    const handled = await routeInteraction(
      {
        ...interaction(`perm:a:${id}`),
        sourceMessageText: 'Run `delete_task`?\n\ncleanup',
      },
      reply,
      auth(true),
    )

    expect(handled).toBe(true)
    expect(getReplies()).toEqual(['Run `delete_task`?\n\ncleanup\n\nAllowed delete_task ✅'])
  })

  test('ephemeral platform: removes the prompt handle and sends ephemeralConfirm on allow', async () => {
    const spyHandle = {
      redact: mock(() => Promise.resolve()),
      remove: mock(() => Promise.resolve()),
    }
    const ephemeralConfirmSpy: ReturnType<typeof mock<(text: string) => Promise<void>>> = mock((_text: string) =>
      Promise.resolve(),
    )
    const capturedCallbackData: string[] = []
    const ephemeralReply: ReplyFn = {
      text: mock(() => Promise.resolve()),
      formatted: mock(() => Promise.resolve()),
      typing: mock(() => {}),
      buttons: mock((_body: string, options: { buttons?: Array<{ callbackData: string }> }) => {
        capturedCallbackData.push(options.buttons![0]!.callbackData)
        return Promise.resolve(spyHandle)
      }),
      ephemeralConfirm: ephemeralConfirmSpy,
    }

    void askPermissionViaChat(ephemeralReply, 'ctx-1', {
      toolName: 'web_fetch',
      reason: 'r',
      args: {},
    })
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    const id = capturedCallbackData[0]!.replace('perm:a:', '')

    const handled = await routeInteraction(
      { ...interaction(`perm:a:${id}`, 'ctx-1'), sourceMessageText: undefined },
      ephemeralReply,
      auth(true, 'ctx-1'),
    )

    expect(handled).toBe(true)
    expect(spyHandle.remove.mock.calls).toHaveLength(1)
    expect(ephemeralConfirmSpy.mock.calls[0]![0]).toBe('Allowed web_fetch ✅')
  })

  test('non-ephemeral platform: replaceText with confirmation; handle.remove not called on deny', async () => {
    const spyHandle = {
      redact: mock(() => Promise.resolve()),
      remove: mock(() => Promise.resolve()),
    }
    const capturedCallbackData: string[] = []
    const replacements: string[] = []
    const nonEphemeralReply: ReplyFn = {
      text: mock(() => Promise.resolve()),
      formatted: mock(() => Promise.resolve()),
      typing: mock(() => {}),
      buttons: mock((_body: string, options: { buttons?: Array<{ callbackData: string }> }) => {
        capturedCallbackData.push(options.buttons![0]!.callbackData)
        return Promise.resolve(spyHandle)
      }),
      replaceText: (content: string): Promise<void> => {
        replacements.push(content)
        return Promise.resolve()
      },
    }

    void askPermissionViaChat(nonEphemeralReply, 'ctx-1', {
      toolName: 'delete_task',
      reason: 'r',
      args: {},
    })
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    const id = capturedCallbackData[0]!.replace('perm:a:', '')

    const handled = await routeInteraction(
      {
        ...interaction(`perm:d:${id}`, 'ctx-1'),
        sourceMessageText: 'Run `delete_task`?',
      },
      nonEphemeralReply,
      auth(true, 'ctx-1'),
    )

    expect(handled).toBe(true)
    expect(spyHandle.remove.mock.calls).toHaveLength(0)
    expect(replacements).toEqual(['Run `delete_task`?\n\nDenied delete_task 🚫'])
  })
})
