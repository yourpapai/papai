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

type FakeTimers = {
  now: () => number
  schedule: (fn: () => void, ms: number) => () => void
  /** Advance the virtual clock, firing any timers whose deadline has passed. */
  advance: (ms: number) => void
}

function makeFakeTimers(): FakeTimers {
  let current = 0
  let pending: Array<{ at: number; fn: () => void; cancelled: boolean }> = []
  return {
    now: () => current,
    schedule: (fn, ms) => {
      const entry = { at: current + ms, fn, cancelled: false }
      pending.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    advance: (ms) => {
      current += ms
      const due = pending.filter((e) => !e.cancelled && e.at <= current)
      pending = pending.filter((e) => !e.cancelled && e.at > current)
      for (const e of due) e.fn()
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

  test('parallel tool starts render then clear the (+n) suffix', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'search_memory', input: { query: 'a' } })
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'b' } })
    reporter.onToolFinish()
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🔍 Searching memory: "a"…', '📝 Creating task: "b"… (+1)', '📝 Creating task: "b"…'])
  })

  test('holds the last tool label until minLabelMs elapses, then reverts to Thinking', async () => {
    const rec = makeReply()
    const timers = makeFakeTimers()
    const reporter = createLiveStatusReporter(rec.reply, { now: timers.now, schedule: timers.schedule })
    await reporter.start()
    reporter.onToolStart({ toolName: 'get_current_time', input: {} })
    // A fast tool returns almost immediately.
    reporter.onToolFinish()
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🕒 Checking the time…'])
    timers.advance(999)
    await flushMicrotasks()
    // Still held — no flicker to Thinking before the minimum hold elapses.
    expect(rec.updates).toEqual(['🕒 Checking the time…'])
    timers.advance(1)
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🕒 Checking the time…', '💭 Thinking…'])
  })

  test('a new tool start during the hold cancels the pending revert and shows the new label immediately', async () => {
    const rec = makeReply()
    const timers = makeFakeTimers()
    const reporter = createLiveStatusReporter(rec.reply, { now: timers.now, schedule: timers.schedule })
    await reporter.start()
    reporter.onToolStart({ toolName: 'get_current_time', input: {} })
    reporter.onToolFinish()
    await flushMicrotasks()
    timers.advance(200)
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'b' } })
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🕒 Checking the time…', '📝 Creating task: "b"…'])
    // The superseded revert must not fire.
    timers.advance(1000)
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🕒 Checking the time…', '📝 Creating task: "b"…'])
  })

  test('reverts to Thinking after the hold once all parallel tools finish', async () => {
    const rec = makeReply()
    const timers = makeFakeTimers()
    const reporter = createLiveStatusReporter(rec.reply, { now: timers.now, schedule: timers.schedule })
    await reporter.start()
    reporter.onToolStart({ toolName: 'search_memory', input: { query: 'a' } })
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'b' } })
    reporter.onToolFinish()
    reporter.onToolFinish()
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🔍 Searching memory: "a"…', '📝 Creating task: "b"… (+1)', '📝 Creating task: "b"…'])
    timers.advance(1000)
    await flushMicrotasks()
    expect(rec.updates).toEqual([
      '🔍 Searching memory: "a"…',
      '📝 Creating task: "b"… (+1)',
      '📝 Creating task: "b"…',
      '💭 Thinking…',
    ])
  })

  test('dismiss cancels a pending Thinking revert', async () => {
    const rec = makeReply()
    const timers = makeFakeTimers()
    const reporter = createLiveStatusReporter(rec.reply, { now: timers.now, schedule: timers.schedule })
    await reporter.start()
    reporter.onToolStart({ toolName: 'get_current_time', input: {} })
    reporter.onToolFinish()
    await flushMicrotasks()
    await reporter.dismiss()
    timers.advance(1000)
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🕒 Checking the time…'])
    expect(rec.dismissed).toBe(1)
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

  test('is a no-op when disabled via options even if the platform supports createStatus', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply, { enabled: false })
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'Buy milk' } })
    reporter.onToolFinish()
    await reporter.dismiss()
    expect(rec.created).toEqual([])
    expect(rec.updates).toEqual([])
    expect(rec.dismissed).toBe(0)
  })

  test('honors enabled: true the same as the default', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply, { enabled: true })
    await reporter.start()
    expect(rec.created).toEqual(['💭 Thinking…'])
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
