// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  askPermissionViaChat,
  formatArguments,
  formatPermissionDecisionText,
  formatPrompt,
  resolvePermissionRequest,
  resetPermissionPromptForTesting,
} from '../../src/chat/permission-prompt.js'
import type { ButtonReplyOptions, ChatButton, PromptHandle, ReplyFn } from '../../src/chat/types.js'

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
      return Promise.resolve(undefined)
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
    const promise = askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'cleanup T-123', args: {} })

    await tickAsync()
    const call = getButtonCall()
    expect(call).toBeDefined()
    const btns = extractButtons(call!)
    expect(btns).toHaveLength(2)
    const allowId = btns[0]!.callbackData.replace('perm:a:', '')
    expect(btns[0]!.callbackData).toBe(`perm:a:${allowId}`)
    expect(btns[1]!.callbackData).toBe(`perm:d:${allowId}`)

    const resolved = resolvePermissionRequest(allowId, 'allow')
    expect(resolved.resolved).toBe(true)
    await expect(promise).resolves.toBe('allow')
  })

  test('resolves on deny', async () => {
    const { reply, getButtonCall } = makeReply()
    const promise = askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'r', args: {} })
    await tickAsync()
    const btns = extractButtons(getButtonCall()!)
    const id = btns[0]!.callbackData.replace('perm:a:', '')
    expect(resolvePermissionRequest(id, 'deny').resolved).toBe(true)
    await expect(promise).resolves.toBe('deny')
  })

  test('resolvePermissionRequest returns false for unknown id', () => {
    expect(resolvePermissionRequest('nope', 'allow').resolved).toBe(false)
  })

  test('callback data uses 8-char base64url id', async () => {
    const { reply, getButtonCall } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 't', reason: 'r', args: {} })
    await tickAsync()
    const btns = extractButtons(getButtonCall()!)
    const id = btns[0]!.callbackData.replace('perm:a:', '')
    expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/u)
  })

  test('prompt body contains tool name and reason', async () => {
    const { reply, getButtonCall } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'cleanup', args: {} })
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
      args: {},
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
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 't', reason: 'plain text reason', args: {} })
    await tickAsync()
    expect(getButtonCall()!.body).toContain('plain text reason')
  })

  test('tool name backticks in template still render as code span', async () => {
    const { reply, getButtonCall } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'no markdown', args: {} })
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

describe('formatArguments', () => {
  test('formats flat object', () => {
    expect(formatArguments({ id: 'task-123', name: 'Test' })).toBe('id: task-123\nname: Test')
  })

  test('flattens nested objects', () => {
    expect(formatArguments({ assignee: { name: 'John' } })).toBe('assignee.name: John')
  })

  test('formats arrays as comma-separated', () => {
    expect(formatArguments({ tags: ['bug', 'urgent'] })).toBe('tags: bug, urgent')
  })

  test('masks sensitive values', () => {
    expect(formatArguments({ apiKey: 'sk-abc123def' })).toBe('apiKey: sk-...def')
  })

  test('masks sensitive field names', () => {
    expect(formatArguments({ token: 'abc123def456' })).toBe('token: abc...456')
  })

  test('handles empty args', () => {
    expect(formatArguments({})).toBe('')
  })

  test('flattens up to 3 levels, then shows [Object]', () => {
    const deep = { a: { b: { c: { d: 'value' } } } }
    expect(formatArguments(deep)).toBe('a.b.c.d: value')
  })

  test('shows [Object] for deeply nested objects beyond 3 levels', () => {
    const veryDeep = { a: { b: { c: { d: { e: 'value' } } } } }
    expect(formatArguments(veryDeep)).toBe('a.b.c.d: [Object]')
  })

  test('handles null values', () => {
    expect(formatArguments({ id: null })).toBe('id: (empty)')
  })

  test('handles undefined values', () => {
    expect(formatArguments({ id: undefined })).toBe('id: (empty)')
  })

  test('handles boolean values', () => {
    expect(formatArguments({ active: true })).toBe('active: true')
  })

  test('handles numeric values', () => {
    expect(formatArguments({ count: 42 })).toBe('count: 42')
  })
})

describe('formatPrompt', () => {
  test('includes arguments before reason', () => {
    const result = formatPrompt('delete_task', 'cleanup', { id: 'task-123' })
    expect(result).toContain('**Arguments:**\nid: task-123')
    expect(result.indexOf('**Arguments:**')).toBeLessThan(result.indexOf('cleanup'))
  })

  test('skips arguments section when args empty', () => {
    const result = formatPrompt('delete_task', 'cleanup', {})
    expect(result).not.toContain('**Arguments:**')
    expect(result).toContain('🔐 Run `delete_task`?\n\ncleanup')
  })

  test('escapes markdown in reason', () => {
    const result = formatPrompt('delete_task', 'cleanup *task*', { id: 'task-123' })
    expect(result).toContain('cleanup \\*task\\*')
  })
})

describe('askPermissionViaChat handle lifecycle', () => {
  type SpyHandle = {
    redact: ReturnType<typeof mock<() => Promise<void>>>
    remove: ReturnType<typeof mock<() => Promise<void>>>
  }
  type MockButtons = ReturnType<typeof mock<(body: string, options: ButtonReplyOptions) => Promise<PromptHandle>>>

  function makeReplyWithHandle(): { reply: ReplyFn; handle: SpyHandle; buttonsMock: MockButtons } {
    const handle: SpyHandle = {
      redact: mock(() => Promise.resolve()),
      remove: mock(() => Promise.resolve()),
    }
    const buttonsMock: MockButtons = mock((_body: string, _options: ButtonReplyOptions) =>
      Promise.resolve<PromptHandle>(handle),
    )
    const reply: ReplyFn = {
      text: mock(() => Promise.resolve()),
      formatted: mock(() => Promise.resolve()),
      typing: mock(() => undefined),
      buttons: buttonsMock,
    }
    return { reply, handle, buttonsMock }
  }

  test('resolvePermissionRequest returns the stored handle', async () => {
    resetPermissionPromptForTesting()
    const { reply, handle, buttonsMock } = makeReplyWithHandle()
    const decisionPromise = askPermissionViaChat(reply, 'ctx-1', { toolName: 'web_fetch', reason: 'r', args: {} })
    const call = buttonsMock.mock.calls[0]!
    const callbackData = call[1].buttons![0]!.callbackData
    const id = callbackData.replace('perm:a:', '')
    await tickAsync()
    const result = resolvePermissionRequest(id, 'allow')
    expect(result.resolved).toBe(true)
    expect(result.handle).toBe(handle)
    await expect(decisionPromise).resolves.toBe('allow')
  })
})
