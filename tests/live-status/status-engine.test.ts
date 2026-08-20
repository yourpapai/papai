// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createStatusEngine, THINKING } from '../../src/live-status/status-engine.js'
import type { StatusEngineDeps } from '../../src/live-status/status-engine.js'

type EngineHarness = {
  emitted: string[]
  deps: StatusEngineDeps
  advance: (ms: number) => void
}

const makeHarness = (options?: { active?: boolean; minLabelMs?: number }): EngineHarness => {
  const emitted: string[] = []
  let current = 0
  let pending: Array<{ at: number; fn: () => void; cancelled: boolean }> = []
  const deps: StatusEngineDeps = {
    emit: (text) => {
      emitted.push(text)
    },
    isActive: () => options?.active !== false,
    minLabelMs: options?.minLabelMs ?? 1000,
    now: () => current,
    schedule: (fn, ms) => {
      const entry = { at: current + ms, fn, cancelled: false }
      pending.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
  }
  return {
    emitted,
    deps,
    advance: (ms) => {
      current += ms
      const due = pending.filter((entry) => !entry.cancelled && entry.at <= current)
      pending = pending.filter((entry) => !entry.cancelled && entry.at > current)
      for (const entry of due) entry.fn()
    },
  }
}

describe('createStatusEngine', () => {
  test('a tool start emits its label after reset baselines Thinking', () => {
    const harness = makeHarness()
    const engine = createStatusEngine(harness.deps)
    engine.reset()
    engine.onToolStart('🔨 create_task')
    expect(harness.emitted).toEqual(['🔨 create_task'])
  })

  test('duplicate text is never re-emitted', () => {
    const harness = makeHarness({ minLabelMs: 0 })
    const engine = createStatusEngine(harness.deps)
    engine.reset()
    engine.onToolStart('🔨 create_task')
    engine.onToolFinish()
    engine.onToolStart('🔨 create_task')
    expect(harness.emitted).toEqual(['🔨 create_task', THINKING, '🔨 create_task'])
  })

  test('the Thinking revert waits out the minimum label hold', () => {
    const harness = makeHarness({ minLabelMs: 1000 })
    const engine = createStatusEngine(harness.deps)
    engine.reset()
    engine.onToolStart('🔨 create_task')
    harness.advance(400)
    engine.onToolFinish()
    expect(harness.emitted).toEqual(['🔨 create_task'])
    harness.advance(700)
    expect(harness.emitted).toEqual(['🔨 create_task', THINKING])
  })

  test('stop cancels a pending Thinking revert', () => {
    const harness = makeHarness({ minLabelMs: 1000 })
    const engine = createStatusEngine(harness.deps)
    engine.reset()
    engine.onToolStart('🔨 create_task')
    harness.advance(400)
    engine.onToolFinish()
    engine.stop()
    harness.advance(2000)
    expect(harness.emitted).toEqual(['🔨 create_task'])
  })

  test('nothing is emitted while the status surface is inactive', () => {
    const harness = makeHarness({ active: false })
    const engine = createStatusEngine(harness.deps)
    engine.reset()
    engine.onToolStart('🔨 create_task')
    engine.onToolFinish()
    expect(harness.emitted).toEqual([])
  })
})

describe('createStatusEngine with an injected idleText', () => {
  const RU_IDLE = '💭 Думаю…'

  // The idleText dep arrives with the localization implementation; threading it through
  // this intersection keeps the suite compiling until then (extra properties are fine on
  // a non-literal passed to a narrower parameter type).
  const withIdle = (deps: StatusEngineDeps, idleText: string): StatusEngineDeps & { idleText: string } => ({
    ...deps,
    idleText,
  })

  test('reset baselines the injected idle text', () => {
    const harness = makeHarness()
    const engine = createStatusEngine(withIdle(harness.deps, RU_IDLE))
    engine.reset()
    engine.onToolStart('🔨 create_task')
    expect(harness.emitted).toEqual(['🔨 create_task'])
    engine.onToolFinish()
    harness.advance(2000)
    expect(harness.emitted).toEqual(['🔨 create_task', RU_IDLE])
  })

  test('a ru idle text reverts after the minimum hold and dedups correctly', () => {
    const harness = makeHarness({ minLabelMs: 1000 })
    const engine = createStatusEngine(withIdle(harness.deps, RU_IDLE))
    engine.reset()
    engine.onToolStart('🔍 Ищу задачи')
    harness.advance(400)
    engine.onToolFinish()
    expect(harness.emitted).toEqual(['🔍 Ищу задачи'])
    harness.advance(700)
    expect(harness.emitted).toEqual(['🔍 Ищу задачи', RU_IDLE])
    engine.onToolStart('🔍 Ищу задачи')
    engine.onToolFinish()
    harness.advance(2000)
    expect(harness.emitted).toEqual(['🔍 Ищу задачи', RU_IDLE, '🔍 Ищу задачи', RU_IDLE])
  })

  test('the idle text used before the first reset is the injected one', () => {
    const harness = makeHarness({ minLabelMs: 0 })
    const engine = createStatusEngine(withIdle(harness.deps, RU_IDLE))
    engine.onToolStart('🔨 create_task')
    engine.onToolFinish()
    expect(harness.emitted).toEqual(['🔨 create_task', RU_IDLE])
  })
})
