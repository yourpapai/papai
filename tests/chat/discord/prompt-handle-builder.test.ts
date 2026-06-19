// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildPromptHandle } from '../../../src/chat/discord/prompt-handle-builder.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('buildPromptHandle', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('redact calls edit with empty components and the given text', async () => {
    const editCalls: Array<Partial<{ content: string; components: unknown[] }>> = []
    const sent = {
      id: 'msg-1',
      edit: (arg: Partial<{ content: string; components: unknown[] }>): Promise<void> => {
        editCalls.push(arg)
        return Promise.resolve()
      },
      delete: (): Promise<void> => Promise.resolve(),
    }

    const handle = buildPromptHandle(sent)
    await handle.redact('timed out')

    expect(editCalls).toHaveLength(1)
    expect(editCalls[0]).toEqual({ content: 'timed out', components: [] })
  })

  test('remove calls delete on the message', async () => {
    let deleteCalled = false
    const sent = {
      id: 'msg-2',
      edit: (): Promise<void> => Promise.resolve(),
      delete: (): Promise<void> => {
        deleteCalled = true
        return Promise.resolve()
      },
    }

    const handle = buildPromptHandle(sent)
    await handle.remove()

    expect(deleteCalled).toBe(true)
  })

  test('remove is a no-op when delete is absent', async () => {
    const sent = {
      id: 'msg-3',
      edit: (): Promise<void> => Promise.resolve(),
    }

    const handle = buildPromptHandle(sent)
    // Should not throw
    await expect(handle.remove()).resolves.toBeUndefined()
  })
})
