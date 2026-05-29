// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { handlePermissionInteraction } from '../../src/chat/permission-interaction-handler.js'
import { askPermissionViaChat, resetPermissionPromptForTesting } from '../../src/chat/permission-prompt.js'
import type { ButtonReplyOptions, IncomingInteraction, ReplyFn } from '../../src/chat/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type CapturedTextCall = string
type CapturedButtonCall = { body: string; options: ButtonReplyOptions }

function makeReply(): {
  reply: ReplyFn
  textCalls: CapturedTextCall[]
  buttonCalls: CapturedButtonCall[]
} {
  const textCalls: CapturedTextCall[] = []
  const buttonCalls: CapturedButtonCall[] = []
  const reply: ReplyFn = {
    text: (content: string) => {
      textCalls.push(content)
      return Promise.resolve()
    },
    formatted: mock(() => Promise.resolve()),
    typing: mock(() => {}),
    buttons: (body: string, options: ButtonReplyOptions) => {
      buttonCalls.push({ body, options })
      return Promise.resolve()
    },
  }
  return { reply, textCalls, buttonCalls }
}

function makeInteraction(callbackData: string, userId = 'u-1', contextId = 'u-1'): IncomingInteraction {
  return {
    kind: 'button',
    callbackData,
    user: { id: userId, username: null, isAdmin: false },
    contextType: 'dm',
    contextId,
    storageContextId: contextId,
    platformInstanceId: 'p-1',
  }
}

async function tickAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function startPrompt(reply: ReplyFn, contextId = 'u-1'): Promise<'allow' | 'deny'> {
  return askPermissionViaChat(reply, contextId, { toolName: 'demo_tool', reason: 'why' })
}

function extractAllowId(buttonCalls: CapturedButtonCall[]): string {
  const btns = buttonCalls[0]?.options.buttons ?? []
  return btns[0]!.callbackData.replace('perm:a:', '')
}

describe('handlePermissionInteraction', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetPermissionPromptForTesting()
  })
  afterEach(() => resetPermissionPromptForTesting())

  test('ignores non-perm: callbacks', async () => {
    const { reply } = makeReply()
    const result = await handlePermissionInteraction(makeInteraction('tgl:dom:task'), reply)
    expect(result).toBe(false)
  })

  test('resolves promise with allow on perm:a', async () => {
    const { reply, buttonCalls } = makeReply()
    const pending = startPrompt(reply)
    await tickAsync()
    const id = extractAllowId(buttonCalls)
    const handled = await handlePermissionInteraction(makeInteraction(`perm:a:${id}`), reply)
    expect(handled).toBe(true)
    await expect(pending).resolves.toBe('allow')
  })

  test('resolves promise with deny on perm:d', async () => {
    const { reply, buttonCalls } = makeReply()
    const pending = startPrompt(reply)
    await tickAsync()
    const id = extractAllowId(buttonCalls)
    await handlePermissionInteraction(makeInteraction(`perm:d:${id}`), reply)
    await expect(pending).resolves.toBe('deny')
  })

  test('expired id replies with expiry message without throwing', async () => {
    const { reply, textCalls } = makeReply()
    const handled = await handlePermissionInteraction(makeInteraction('perm:a:zzzzzzzz'), reply)
    expect(handled).toBe(true)
    expect(textCalls.length).toBeGreaterThan(0)
  })

  test('rejects when user cannot manage the target context', async () => {
    const { reply: promptReply, buttonCalls } = makeReply()
    void startPrompt(promptReply, 'group-A')
    await tickAsync()
    const id = extractAllowId(buttonCalls)
    const { reply: handlerReply, textCalls } = makeReply()
    const handled = await handlePermissionInteraction(
      makeInteraction(`perm:a:${id}`, 'other-user', 'other-user'),
      handlerReply,
    )
    expect(handled).toBe(true)
    expect(textCalls.length).toBeGreaterThan(0)
  })
})
