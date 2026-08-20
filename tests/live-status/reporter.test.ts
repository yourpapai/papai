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

  test('placeholder edits the status in place instead of deleting it', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'Buy milk' } })
    await flushMicrotasks()
    await reporter.placeholder('💬 Preparing response…')
    // Last update is the placeholder; the message is NOT dismissed yet — it survives until the reply posts.
    expect(rec.updates.at(-1)).toBe('💬 Preparing response…')
    expect(rec.dismissed).toBe(0)
  })

  test('placeholder freezes the status: a pending Thinking revert never overwrites it', async () => {
    const rec = makeReply()
    const timers = makeFakeTimers()
    const reporter = createLiveStatusReporter(rec.reply, { now: timers.now, schedule: timers.schedule })
    await reporter.start()
    reporter.onToolStart({ toolName: 'get_current_time', input: {} })
    reporter.onToolFinish()
    await flushMicrotasks()
    // A Thinking revert is scheduled but not yet fired; the placeholder must cancel it.
    await reporter.placeholder('💬 Preparing response…')
    timers.advance(1000)
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🕒 Checking the time…', '💬 Preparing response…'])
  })

  test('placeholder freezes the status: a late tool start does not overwrite it', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    await reporter.placeholder('💬 Preparing response…')
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'stray' } })
    await flushMicrotasks()
    expect(rec.updates).toEqual(['💬 Preparing response…'])
  })

  test('dismiss after placeholder deletes the (placeholder) status', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    await reporter.placeholder('💬 Preparing response…')
    await reporter.dismiss()
    expect(rec.updates.at(-1)).toBe('💬 Preparing response…')
    expect(rec.dismissed).toBe(1)
  })

  test('placeholder is a no-op when the platform has no createStatus', async () => {
    const rec = makeReply({ createStatus: undefined })
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    await reporter.placeholder('💬 Preparing response…')
    await reporter.dismiss()
    expect(rec.updates).toEqual([])
    expect(rec.dismissed).toBe(0)
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

type OpportunityEvent = { eligible: boolean; reason: string }
type LifecycleEvent = { stage: string; outcome: string; latencyFromTurnStartMs: number; ordinal: number }

function makeAnalyticsRecorder(): {
  analytics: { onOpportunity: (event: OpportunityEvent) => void; onLifecycle: (event: LifecycleEvent) => void }
  opportunities: OpportunityEvent[]
  lifecycle: LifecycleEvent[]
} {
  const opportunities: OpportunityEvent[] = []
  const lifecycle: LifecycleEvent[] = []
  return {
    analytics: {
      onOpportunity: (event) => {
        opportunities.push(event)
      },
      onLifecycle: (event) => {
        lifecycle.push(event)
      },
    },
    opportunities,
    lifecycle,
  }
}

describe('analytics lifecycle', () => {
  test('disabled reporter emits one disabled opportunity and no lifecycle facts', async () => {
    const rec = makeReply()
    const { analytics, opportunities, lifecycle } = makeAnalyticsRecorder()
    const reporter = createLiveStatusReporter(rec.reply, { enabled: false, analytics })
    await reporter.start()
    await reporter.dismiss()
    expect(opportunities).toEqual([{ eligible: false, reason: 'disabled' }])
    expect(lifecycle).toEqual([])
  })

  test('a platform without createStatus emits one platform_unsupported opportunity', async () => {
    const rec = makeReply({ createStatus: undefined })
    const { analytics, opportunities, lifecycle } = makeAnalyticsRecorder()
    const reporter = createLiveStatusReporter(rec.reply, { analytics })
    await reporter.start()
    await reporter.dismiss()
    expect(opportunities).toEqual([{ eligible: false, reason: 'platform_unsupported' }])
    expect(lifecycle).toEqual([])
  })

  test('a createStatus resolving undefined records a failed create and no_status_surface', async () => {
    const rec = makeReply({ createStatus: () => Promise.resolve(undefined) })
    const { analytics, opportunities, lifecycle } = makeAnalyticsRecorder()
    const timers = makeFakeTimers()
    timers.advance(1000)
    const reporter = createLiveStatusReporter(rec.reply, {
      analytics,
      now: timers.now,
      schedule: timers.schedule,
      turnStartedAtMs: 500,
    })
    await reporter.start()
    expect(lifecycle).toEqual([{ stage: 'create', outcome: 'failed', latencyFromTurnStartMs: 500, ordinal: 0 }])
    expect(opportunities).toEqual([{ eligible: false, reason: 'no_status_surface' }])
  })

  test('a rejecting createStatus records a failed create and no_status_surface', async () => {
    const rec = makeReply({ createStatus: () => Promise.reject(new Error('boom')) })
    const { analytics, opportunities, lifecycle } = makeAnalyticsRecorder()
    const reporter = createLiveStatusReporter(rec.reply, { analytics })
    await reporter.start()
    expect(lifecycle).toHaveLength(1)
    expect(lifecycle[0]).toMatchObject({ stage: 'create', outcome: 'failed', ordinal: 0 })
    expect(opportunities).toEqual([{ eligible: false, reason: 'no_status_surface' }])
  })

  test('a status visible at least one second resolves as eligible with create and dismiss facts', async () => {
    const rec = makeReply()
    const { analytics, opportunities, lifecycle } = makeAnalyticsRecorder()
    const timers = makeFakeTimers()
    timers.advance(2000)
    const reporter = createLiveStatusReporter(rec.reply, {
      analytics,
      now: timers.now,
      schedule: timers.schedule,
      turnStartedAtMs: 1000,
    })
    await reporter.start()
    expect(opportunities).toEqual([])
    expect(lifecycle).toEqual([{ stage: 'create', outcome: 'success', latencyFromTurnStartMs: 1000, ordinal: 0 }])

    timers.advance(1500)
    await reporter.dismiss()
    expect(opportunities).toEqual([{ eligible: true, reason: 'eligible' }])
    expect(lifecycle).toEqual([
      { stage: 'create', outcome: 'success', latencyFromTurnStartMs: 1000, ordinal: 0 },
      { stage: 'dismiss', outcome: 'success', latencyFromTurnStartMs: 2500, ordinal: 0 },
    ])
  })

  test('a status dismissed within one second of creation resolves as turn_too_short', async () => {
    const rec = makeReply()
    const { analytics, opportunities } = makeAnalyticsRecorder()
    const timers = makeFakeTimers()
    timers.advance(2000)
    const reporter = createLiveStatusReporter(rec.reply, {
      analytics,
      now: timers.now,
      schedule: timers.schedule,
      turnStartedAtMs: 1000,
    })
    await reporter.start()
    timers.advance(500)
    await reporter.dismiss()
    expect(opportunities).toEqual([{ eligible: false, reason: 'turn_too_short' }])
  })

  test('updates are recorded in order with per-stage ordinals and turn-start latency', async () => {
    const rec = makeReply()
    const { analytics, lifecycle } = makeAnalyticsRecorder()
    const timers = makeFakeTimers()
    timers.advance(2000)
    const reporter = createLiveStatusReporter(rec.reply, {
      analytics,
      now: timers.now,
      schedule: timers.schedule,
      turnStartedAtMs: 1000,
      minLabelMs: 0,
    })
    await reporter.start()
    timers.advance(100)
    reporter.onToolStart({ toolName: 'create_task', input: {} })
    await flushMicrotasks()
    timers.advance(100)
    reporter.onToolFinish()
    await flushMicrotasks()
    timers.advance(100)
    reporter.onToolStart({ toolName: 'delete_task', input: {} })
    await flushMicrotasks()

    const updates = lifecycle.filter((event) => event.stage === 'update')
    expect(updates.map((event) => event.ordinal)).toEqual([0, 1, 2])
    expect(updates.map((event) => event.latencyFromTurnStartMs)).toEqual([1100, 1200, 1300])
    expect(updates.every((event) => event.outcome === 'success')).toBe(true)
  })

  test('a rejecting update records a failed update stage without breaking the reporter', async () => {
    const rec = makeReply()
    const { analytics, lifecycle } = makeAnalyticsRecorder()
    const failingHandle: StatusHandle = {
      update: () => Promise.reject(new Error('edit failed')),
      dismiss: () => Promise.resolve(),
    }
    const failing = makeReply({ createStatus: () => Promise.resolve(failingHandle) })
    void rec
    const reporter = createLiveStatusReporter(failing.reply, { analytics, minLabelMs: 0 })
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: {} })
    await flushMicrotasks()

    const updates = lifecycle.filter((event) => event.stage === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ outcome: 'failed', ordinal: 0 })
  })

  test('a rejecting dismiss records a failed dismiss stage and still resolves the opportunity', async () => {
    const failingHandle: StatusHandle = {
      update: () => Promise.resolve(),
      dismiss: () => Promise.reject(new Error('delete failed')),
    }
    const rec = makeReply({ createStatus: () => Promise.resolve(failingHandle) })
    const { analytics, opportunities, lifecycle } = makeAnalyticsRecorder()
    const timers = makeFakeTimers()
    timers.advance(5000)
    const reporter = createLiveStatusReporter(rec.reply, {
      analytics,
      now: timers.now,
      schedule: timers.schedule,
      turnStartedAtMs: 1000,
    })
    await reporter.start()
    timers.advance(2000)
    await reporter.dismiss()

    const dismissals = lifecycle.filter((event) => event.stage === 'dismiss')
    expect(dismissals).toEqual([{ stage: 'dismiss', outcome: 'failed', latencyFromTurnStartMs: 6000, ordinal: 0 }])
    expect(opportunities).toEqual([{ eligible: true, reason: 'eligible' }])
  })

  test('a throwing observer never breaks the reporter', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply, {
      analytics: {
        onOpportunity: () => {
          throw new Error('observer boom')
        },
        onLifecycle: () => {
          throw new Error('observer boom')
        },
      },
    })
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: {} })
    await reporter.dismiss()
    expect(rec.dismissed).toBe(1)
  })
})

describe('createLiveStatusReporter locale', () => {
  test('locale ru creates the status with the ru thinking text', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply, { locale: 'ru' })
    await reporter.start()
    expect(rec.created).toEqual(['💭 Думаю…'])
  })

  test('locale ru formats tool labels from the ru catalog', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply, { locale: 'ru' })
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'Купить молоко' } })
    await flushMicrotasks()
    expect(rec.updates).toEqual(['📝 Создаю задачу: "Купить молоко"…'])
  })

  test('locale ru reverts to the ru idle text after the minimum hold', async () => {
    const rec = makeReply()
    const timers = makeFakeTimers()
    const reporter = createLiveStatusReporter(rec.reply, {
      locale: 'ru',
      minLabelMs: 1000,
      now: timers.now,
      schedule: timers.schedule,
    })
    await reporter.start()
    reporter.onToolStart({ toolName: 'get_current_time', input: {} })
    reporter.onToolFinish()
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🕒 Проверяю время…'])
    timers.advance(1000)
    await flushMicrotasks()
    expect(rec.updates).toEqual(['🕒 Проверяю время…', '💭 Думаю…'])
  })

  test('locale ru renders the localized fallback for unregistered tools', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply, { locale: 'ru' })
    await reporter.start()
    reporter.onToolStart({ toolName: 'add_watcher', input: {} })
    await flushMicrotasks()
    expect(rec.updates).toEqual(['⚙️ Выполняю add watcher…'])
  })

  test('explicit locale en is byte-identical to passing no locale', async () => {
    const withEn = makeReply()
    const without = makeReply()
    const enReporter = createLiveStatusReporter(withEn.reply, { locale: 'en' })
    const defaultReporter = createLiveStatusReporter(without.reply)
    await enReporter.start()
    await defaultReporter.start()
    enReporter.onToolStart({ toolName: 'create_task', input: { title: 'Buy milk' } })
    defaultReporter.onToolStart({ toolName: 'create_task', input: { title: 'Buy milk' } })
    await flushMicrotasks()
    expect(withEn.created).toEqual(without.created)
    expect(withEn.updates).toEqual(without.updates)
    expect(withEn.created).toEqual(['💭 Thinking…'])
    expect(withEn.updates).toEqual(['📝 Creating task: "Buy milk"…'])
  })
})
