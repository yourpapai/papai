// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { buildTelegramPromptHandle, type TelegramBotEditApi } from '../../../src/chat/telegram/prompt-handle-builder.js'
import { mockLogger } from '../../utils/test-helpers.js'

function makeApi(): {
  api: TelegramBotEditApi
  editCalls: Array<[number, number, string, Record<string, unknown> | undefined]>
  deleteCalls: Array<[number, number]>
} {
  const editCalls: Array<[number, number, string, Record<string, unknown> | undefined]> = []
  const deleteCalls: Array<[number, number]> = []
  const api: TelegramBotEditApi = {
    editMessageText: mock(
      (chatId: number, messageId: number, text: string, other?: Record<string, unknown>): Promise<unknown> => {
        editCalls.push([chatId, messageId, text, other])
        return Promise.resolve(true)
      },
    ),
    deleteMessage: mock((chatId: number, messageId: number): Promise<unknown> => {
      deleteCalls.push([chatId, messageId])
      return Promise.resolve(true)
    }),
  }
  return { api, editCalls, deleteCalls }
}

describe('buildTelegramPromptHandle', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('redact edits the message with empty inline keyboard', async () => {
    const { api, editCalls } = makeApi()
    const handle = buildTelegramPromptHandle(api, 99, 42)

    await handle.redact('Timed out')

    expect(editCalls).toHaveLength(1)
    const call = editCalls[0]
    expect(call).toBeDefined()
    expect(call?.[0]).toBe(99)
    expect(call?.[1]).toBe(42)
    expect(call?.[2]).toBe('Timed out')
    expect(call?.[3]).toEqual({ reply_markup: { inline_keyboard: [] } })
  })

  test('remove deletes the message', async () => {
    const { api, deleteCalls } = makeApi()
    const handle = buildTelegramPromptHandle(api, 99, 42)

    await handle.remove()

    expect(deleteCalls).toHaveLength(1)
    const call = deleteCalls[0]
    expect(call).toBeDefined()
    expect(call?.[0]).toBe(99)
    expect(call?.[1]).toBe(42)
  })

  test('redact swallows errors and logs a warning', async () => {
    const api: TelegramBotEditApi = {
      editMessageText: (): Promise<unknown> => Promise.reject(new Error('Telegram error')),
      deleteMessage: (): Promise<unknown> => Promise.resolve(true),
    }
    const handle = buildTelegramPromptHandle(api, 99, 42)

    await expect(handle.redact('oops')).resolves.toBeUndefined()
  })

  test('remove swallows errors and logs a warning', async () => {
    const api: TelegramBotEditApi = {
      editMessageText: (): Promise<unknown> => Promise.resolve(true),
      deleteMessage: (): Promise<unknown> => Promise.reject(new Error('Telegram error')),
    }
    const handle = buildTelegramPromptHandle(api, 99, 42)

    await expect(handle.remove()).resolves.toBeUndefined()
  })
})
