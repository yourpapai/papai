// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  askPermissionViaChat,
  formatPermissionDecisionText,
  resolvePermissionRequest,
  resetPermissionPromptForTesting,
} from '../../src/chat/permission-prompt.js'
import type { ButtonReplyOptions, ChatButton, ReplyFn } from '../../src/chat/types.js'

type CapturedButtonCall = { body: string; options: ButtonReplyOptions }

function makeReply(): {
  reply: ReplyFn
  getButtonCall: () => CapturedButtonCall | undefined
  getButtonCalls: () => CapturedButtonCall[]
} {
  const buttonCalls: CapturedButtonCall[] = []
  const reply: ReplyFn = {
    text: mock(() => Promise.resolve()),
    formatted: mock(() => Promise.resolve()),
    typing: mock(() => {}),
    buttons: (body: string, options: ButtonReplyOptions) => {
      buttonCalls.push({ body, options })
      return Promise.resolve()
    },
  }
  return {
    reply,
    getButtonCall: () => buttonCalls[0],
    getButtonCalls: () => buttonCalls,
  }
}

function extractButtons(call: CapturedButtonCall): ChatButton[] {
  return call.options.buttons ?? []
}

async function tickAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('askPermissionViaChat', () => {
  beforeEach(() => resetPermissionPromptForTesting())
  afterEach(() => resetPermissionPromptForTesting())

  test('posts an Allow/Deny prompt and resolves on allow', async () => {
    const { reply, getButtonCall } = makeReply()
    const promise = askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'cleanup T-123' })

    await tickAsync()
    const call = getButtonCall()
    expect(call).toBeDefined()
    const btns = extractButtons(call!)
    expect(btns).toHaveLength(2)
    const allowId = btns[0]!.callbackData.replace('perm:a:', '')
    expect(btns[0]!.callbackData).toBe(`perm:a:${allowId}`)
    expect(btns[1]!.callbackData).toBe(`perm:d:${allowId}`)

    const resolved = resolvePermissionRequest(allowId, 'allow')
    expect(resolved).toBe(true)
    await expect(promise).resolves.toBe('allow')
  })

  test('resolves on deny', async () => {
    const { reply, getButtonCall } = makeReply()
    const promise = askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'r' })
    await tickAsync()
    const btns = extractButtons(getButtonCall()!)
    const id = btns[0]!.callbackData.replace('perm:a:', '')
    expect(resolvePermissionRequest(id, 'deny')).toBe(true)
    await expect(promise).resolves.toBe('deny')
  })

  test('resolvePermissionRequest returns false for unknown id', () => {
    expect(resolvePermissionRequest('nope', 'allow')).toBe(false)
  })

  test('callback data uses 8-char base64url id', async () => {
    const { reply, getButtonCall } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 't', reason: 'r' })
    await tickAsync()
    const btns = extractButtons(getButtonCall()!)
    const id = btns[0]!.callbackData.replace('perm:a:', '')
    expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/u)
  })

  test('prompt body contains tool name and reason', async () => {
    const { reply, getButtonCall } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'cleanup' })
    await tickAsync()
    const call = getButtonCall()!
    expect(call.body).toContain('delete_task')
    expect(call.body).toContain('cleanup')
  })

  test('reason markdown control characters are escaped', async () => {
    const { reply, getButtonCall } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', {
      toolName: 'delete_task',
      reason: '*click here* [tap](https://attacker.example) `code` _italic_',
    })
    await tickAsync()
    const body = getButtonCall()!.body
    // Each disruptive char must be backslash-escaped so the markdown lexer treats it as literal text.
    expect(body).toContain('\\*click here\\*')
    expect(body).toContain('\\[tap\\]\\(https://attacker.example\\)')
    expect(body).toContain('\\`code\\`')
    expect(body).toContain('\\_italic\\_')
    // Raw unescaped sequences must not appear in the interpolated section.
    expect(body).not.toContain('*click here*')
    expect(body).not.toContain('[tap](')
  })

  test('reason without special characters is unchanged', async () => {
    const { reply, getButtonCall } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 't', reason: 'plain text reason' })
    await tickAsync()
    expect(getButtonCall()!.body).toContain('plain text reason')
  })

  test('tool name backticks in template still render as code span', async () => {
    const { reply, getButtonCall } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'no markdown' })
    await tickAsync()
    expect(getButtonCall()!.body).toContain('`delete_task`')
  })
})

describe('formatPermissionDecisionText', () => {
  test('keeps prompt text and appends allow decision', () => {
    expect(formatPermissionDecisionText('Run `delete_task`?\n\nReason', 'allow')).toBe(
      'Run `delete_task`?\n\nReason\n\nAllowed.',
    )
  })

  test('keeps prompt text and appends deny decision', () => {
    expect(formatPermissionDecisionText('Run `delete_task`?\n\nReason', 'deny')).toBe(
      'Run `delete_task`?\n\nReason\n\nDenied.',
    )
  })
})
