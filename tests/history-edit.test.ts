// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { appendHistory, applyEditToHistory, loadHistory } from '../src/history.js'
import type { MessageSegment } from '../src/message-edit/segments.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

type PapaiMeta = { segments: MessageSegment[] }

function readPapai(msg: ModelMessage): PapaiMeta {
  const opts = msg.providerOptions as { papai?: PapaiMeta } | undefined
  if (opts?.papai === undefined) throw new Error('expected providerOptions.papai to be defined')
  return opts.papai
}

describe('applyEditToHistory', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('replaces the edited segment text by messageId and rebuilds content', () => {
    const userMsg = {
      role: 'user',
      content: 'hello',
      providerOptions: {
        papai: {
          messageIds: ['m1'],
          segments: [{ messageId: 'm1', text: 'hello', username: null }],
          isThread: false,
          isDm: true,
        },
      },
    } as ModelMessage
    appendHistory('ctx', [userMsg])

    const changed = applyEditToHistory('ctx', 'm1', 'hello (edited)')
    expect(changed).toBe(true)

    const history = loadHistory('ctx')
    const edited = history.find((m) => m.role === 'user')!
    expect(edited.content).toBe('hello (edited)')
    expect(readPapai(edited).segments[0]?.text).toBe('hello (edited)')
  })

  test('rebuilds multi-segment group-thread turn preserving other segments + @prefix', () => {
    const userMsg = {
      role: 'user',
      content: '[@alice]: hi\n[@alice]: there',
      providerOptions: {
        papai: {
          messageIds: ['m1', 'm2'],
          segments: [
            { messageId: 'm1', text: 'hi', username: 'alice' },
            { messageId: 'm2', text: 'there', username: 'alice' },
          ],
          isThread: true,
          isDm: false,
        },
      },
    } as ModelMessage
    appendHistory('ctx-multi', [userMsg])

    const changed = applyEditToHistory('ctx-multi', 'm1', 'hi (edited)')
    expect(changed).toBe(true)

    const history = loadHistory('ctx-multi')
    const edited = history.find((m) => m.role === 'user')!
    expect(edited.content).toBe('[@alice]: hi (edited)\n[@alice]: there')
  })

  test('no-op (returns false) when messageId is absent from all turns', () => {
    const userMsg = {
      role: 'user',
      content: 'hello',
      providerOptions: {
        papai: {
          messageIds: ['m1'],
          segments: [{ messageId: 'm1', text: 'hello', username: null }],
          isThread: false,
          isDm: true,
        },
      },
    } as ModelMessage
    appendHistory('ctx-miss', [userMsg])

    const changed = applyEditToHistory('ctx-miss', 'missing', 'x')
    expect(changed).toBe(false)

    const history = loadHistory('ctx-miss')
    expect(history[0]!.content).toBe('hello')
  })

  test('no-op on legacy user turn without providerOptions.papai', () => {
    appendHistory('ctx-legacy', [{ role: 'user', content: 'plain' } as ModelMessage])

    expect(applyEditToHistory('ctx-legacy', 'm1', 'edited')).toBe(false)

    const history = loadHistory('ctx-legacy')
    expect(history[0]!.content).toBe('plain')
  })

  test('only mutates the first matching turn (later turns untouched)', () => {
    const turnA = {
      role: 'user',
      content: 'a-text',
      providerOptions: {
        papai: {
          messageIds: ['shared'],
          segments: [{ messageId: 'shared', text: 'a-text', username: null }],
          isThread: false,
          isDm: true,
        },
      },
    } as ModelMessage
    const assistant = { role: 'assistant', content: 'ok' } as ModelMessage
    const turnB = {
      role: 'user',
      content: 'b-text',
      providerOptions: {
        papai: {
          messageIds: ['shared'],
          segments: [{ messageId: 'shared', text: 'b-text', username: null }],
          isThread: false,
          isDm: true,
        },
      },
    } as ModelMessage
    appendHistory('ctx-first', [turnA, assistant, turnB])

    applyEditToHistory('ctx-first', 'shared', 'rewritten')

    const history = loadHistory('ctx-first')
    const users = history.filter((m) => m.role === 'user')
    expect(users[0]!.content).toBe('rewritten')
    expect(users[1]!.content).toBe('b-text')
  })
})
