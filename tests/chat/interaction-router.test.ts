// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import { askPermissionViaChat, resetPermissionPromptForTesting } from '../../src/chat/permission-prompt.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from '../../src/chat/types.js'
import { createMockReply } from '../utils/test-helpers.js'

const auth = (allowed: boolean): AuthorizationResult => ({
  allowed,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'tg:u1',
})

const interaction = (callbackData: string): IncomingInteraction => ({
  kind: 'button',
  user: { id: 'u1', username: null, isAdmin: false },
  contextId: 'tg:u1',
  contextType: 'dm',
  platformInstanceId: 'tg',
  storageContextId: 'tg:u1',
  callbackData,
})

async function createPendingPermissionId(): Promise<string> {
  const calls: Array<{ options: { buttons?: Array<{ callbackData: string }> } }> = []
  const reply: ReplyFn = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: (_content: string, options: { buttons?: Array<{ callbackData: string }> }) => {
      calls.push({ options })
      return Promise.resolve()
    },
  }
  void askPermissionViaChat(reply, 'tg:u1', { toolName: 'delete_task', reason: 'cleanup' })
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  return calls[0]!.options.buttons![0]!.callbackData.replace('perm:a:', '')
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
      { ...interaction(`perm:a:${id}`), sourceMessageText: 'Run `delete_task`?\n\ncleanup' },
      reply,
      auth(true),
    )

    expect(handled).toBe(true)
    expect(replacements).toEqual(['Run `delete_task`?\n\ncleanup\n\nAllowed.'])
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
      { ...interaction(`perm:d:${id}`), sourceMessageText: 'Run `delete_task`?\n\ncleanup' },
      reply,
      auth(true),
    )

    expect(handled).toBe(true)
    expect(replacements).toEqual(['Run `delete_task`?\n\ncleanup\n\nDenied.'])
  })

  test('reports missing permission requests as unavailable', async () => {
    const { reply, getReplies } = createMockReply()
    const handled = await routeInteraction(interaction('perm:a:missing1'), reply, auth(true))

    expect(handled).toBe(true)
    expect(getReplies()[0]).toContain('Action is no longer available')
  })
})
