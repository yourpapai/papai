// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ReplyFn, StatusHandle } from '../../src/chat/types.js'
import { createLiveStatusReporter } from '../../src/live-status/reporter.js'
import { flushMicrotasks } from '../utils/test-helpers.js'

type Recorder = {
  reply: ReplyFn
  created: string[]
  updates: string[]
  dismissed: number
}

function makeReply(overrides?: { createStatus?: ReplyFn['createStatus'] }): Recorder {
  const created: string[] = []
  const updates: string[] = []
  let dismissed = 0
  const handle: StatusHandle = {
    update: (text: string) => {
      updates.push(text)
      return Promise.resolve()
    },
    dismiss: () => {
      dismissed += 1
      return Promise.resolve()
    },
  }
  const defaultCreateStatus: ReplyFn['createStatus'] = (initialText: string) => {
    created.push(initialText)
    return Promise.resolve(handle)
  }
  const reply: ReplyFn = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: () => Promise.resolve(undefined),
    createStatus: overrides !== undefined && 'createStatus' in overrides ? overrides.createStatus : defaultCreateStatus,
  }
  return {
    reply,
    created,
    get updates() {
      return updates
    },
    get dismissed() {
      return dismissed
    },
  }
}

describe('createLiveStatusReporter', () => {
  test('start creates the status with the Thinking placeholder', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    expect(rec.created).toEqual(['💭 Thinking…'])
  })

  test('onToolStart updates to the tool label', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'Buy milk' } })
    await flushMicrotasks()
    expect(rec.updates).toEqual(['📝 Creating task: "Buy milk"…'])
  })

  test('parallel tool starts render a (+n) suffix; finishing returns to a single label then Thinking', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'search_memory', input: { query: 'a' } })
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'b' } })
    reporter.onToolFinish()
    reporter.onToolFinish()
    await flushMicrotasks()
    expect(rec.updates).toEqual([
      '🔍 Searching memory: "a"…',
      '📝 Creating task: "b"… (+1)',
      '📝 Creating task: "b"…',
      '💭 Thinking…',
    ])
  })

  test('does not emit redundant updates for unchanged text', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolFinish()
    await flushMicrotasks()
    expect(rec.updates).toEqual([])
  })

  test('dismiss deletes the status exactly once', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    await reporter.dismiss()
    await reporter.dismiss()
    expect(rec.dismissed).toBe(1)
  })

  test('is a no-op when the platform has no createStatus', async () => {
    const rec = makeReply({ createStatus: undefined })
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: {} })
    reporter.onToolFinish()
    await reporter.dismiss()
    expect(rec.updates).toEqual([])
    expect(rec.dismissed).toBe(0)
  })

  test('swallows a rejecting createStatus', async () => {
    const rec = makeReply({ createStatus: () => Promise.reject(new Error('boom')) })
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: {} })
    await reporter.dismiss()
    expect(rec.dismissed).toBe(0)
  })
})
