// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { AgentUsage, DoneEvent, SddEvent } from '../../sdd-runner/src/events.js'
import type { ResolvedCost } from '../../sdd-runner/src/pricing.js'
import { aggregateUsage } from '../../sdd-runner/src/usage-aggregate.js'
import { repriceEvent } from '../../sdd-runner/src/usage-aggregate.js'
import { repriceEvents } from '../../sdd-runner/src/usage-aggregate.js'
import { treeSpend } from '../../sdd-runner/src/usage-aggregate.js'

function makeUsage(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    costUsd: 0,
    wallMs: 0,
    ...overrides,
  }
}

function doneEvent(usage: AgentUsage, seq: number, model?: string): DoneEvent {
  const base: DoneEvent = {
    altitude: 'L1',
    type: 'done',
    agent: 'reviewer-r1',
    usage,
    seq,
    ts: '2026-01-01T00:00:00.000Z',
  }
  if (model !== undefined) return { ...base, model }
  return base
}

function doneAt(events: readonly SddEvent[], idx: number): DoneEvent {
  const event = events[idx]
  if (event === undefined || event.type !== 'done') throw new Error(`expected done event at ${idx}`)
  return event
}

function resolverFrom(table: Record<string, ResolvedCost>): (modelId: string) => ResolvedCost | null {
  return (modelId) => table[modelId] ?? null
}

function spawnedEvent(agent: string, model: string, seq: number): SddEvent {
  return { altitude: 'L1', type: 'spawned', agent, role: 'reviewer', model, seq, ts: '2026-01-01T00:00:00.000Z' }
}

describe('aggregateUsage', () => {
  it('sums usage across done events', () => {
    const events: readonly SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 100, outputTokens: 50, reasoningTokens: 10, costUsd: 0.25, wallMs: 1000 }), 1),
      doneEvent(makeUsage({ inputTokens: 200, outputTokens: 30, reasoningTokens: 5, costUsd: 0.5, wallMs: 2000 }), 2),
    ]
    expect(aggregateUsage(events)).toEqual({
      inputTokens: 300,
      outputTokens: 80,
      reasoningTokens: 15,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0.75,
      wallMs: 3000,
      costKnown: true,
    })
  })

  it('sums cached token counters across done events', () => {
    const events: readonly SddEvent[] = [
      doneEvent(
        makeUsage({ inputTokens: 100, cachedReadTokens: 18_175_552, cachedWriteTokens: 5_005_056, wallMs: 1 }),
        1,
      ),
      doneEvent(makeUsage({ inputTokens: 50, cachedReadTokens: 1_000_000, cachedWriteTokens: 0, wallMs: 2 }), 2),
    ]
    const usage = aggregateUsage(events)
    expect(usage.inputTokens).toBe(150)
    expect(usage.cachedReadTokens).toBe(19_175_552)
    expect(usage.cachedWriteTokens).toBe(5_005_056)
  })

  it('ignores non-done events', () => {
    const events: readonly SddEvent[] = [
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 1, ts: 'x' },
      doneEvent(makeUsage({ inputTokens: 100 }), 2),
    ]
    expect(aggregateUsage(events)).toEqual({
      inputTokens: 100,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
      wallMs: 0,
      costKnown: false,
    })
  })

  it('returns zeros for empty input', () => {
    expect(aggregateUsage([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
      wallMs: 0,
      costKnown: true,
    })
  })
})

describe('repriceEvent', () => {
  it('recomputes costUsd from token counts when the event was zero-cost', () => {
    const event = doneEvent(
      makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, reasoningTokens: 0, costUsd: 0 }),
      1,
    )
    const repriced = repriceEvent(event, { input: 5, output: 15 })
    expect(repriced.usage.costUsd).toBe(20)
  })

  it('returns the event unchanged when it was already metered', () => {
    const event = doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: 0.42 }), 1)
    expect(repriceEvent(event, { input: 5, output: 15 })).toBe(event)
  })

  it('returns the event unchanged when there are no tokens (no division by zero)', () => {
    const event = doneEvent(makeUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 }), 1)
    expect(repriceEvent(event, { input: 5, output: 15 })).toBe(event)
  })

  it('folds reasoning tokens into the input-side cost', () => {
    const event = doneEvent(makeUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 1_000_000, costUsd: 0 }), 1)
    const repriced = repriceEvent(event, { input: 5, output: 15 })
    expect(repriced.usage.costUsd).toBe(5)
  })

  it('prices cached reads and writes at their own rates when published', () => {
    const event = doneEvent(
      makeUsage({
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedReadTokens: 2_000_000,
        cachedWriteTokens: 1_000_000,
        costUsd: 0,
      }),
      1,
    )
    const repriced = repriceEvent(event, { input: 5, output: 15, cache_read: 0.5, cache_write: 6.25 })
    expect(repriced.usage.costUsd).toBeCloseTo(5 + 1 + 6.25, 10)
  })

  it('cached tokens contribute zero cost when no cache rates are published', () => {
    const event = doneEvent(
      makeUsage({
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedReadTokens: 9_000_000,
        cachedWriteTokens: 9_000_000,
        costUsd: 0,
      }),
      1,
    )
    const repriced = repriceEvent(event, { input: 5, output: 15 })
    expect(repriced.usage.costUsd).toBe(5)
  })

  it('reprices cache-only usage when input/output/reasoning are all zero', () => {
    const event = doneEvent(
      makeUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedReadTokens: 2_000_000, costUsd: 0 }),
      1,
    )
    const repriced = repriceEvent(event, { input: 5, output: 15, cache_read: 0.5 })
    expect(repriced.usage.costUsd).toBe(1)
  })

  it('reprices cache-write-only usage at the cache_write rate', () => {
    const event = doneEvent(
      makeUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedWriteTokens: 2_000_000, costUsd: 0 }),
      1,
    )
    const repriced = repriceEvent(event, { input: 5, output: 15, cache_write: 6.25 })
    expect(repriced.usage.costUsd).toBe(12.5)
  })
})

describe('repriceEvents', () => {
  it('backfills a missing model from the spawned map and reprices', () => {
    const resolve = resolverFrom({ 'sub/m': { input: 5, output: 15, source: 'fallback' } })
    const events: SddEvent[] = [
      spawnedEvent('reviewer-r1', 'sub/m', 1),
      doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0 }), 2),
    ]
    const { events: repriced, costKnown } = repriceEvents(events, resolve)
    expect(costKnown).toBe(false)
    const done = doneAt(repriced, 1)
    expect(done.usage.costUsd).toBe(5)
    expect(done.model).toBe('sub/m')
  })

  it('uses the done event own model when present', () => {
    const resolve = resolverFrom({ 'paid/m': { input: 2, output: 4, source: 'primary' } })
    const events: SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: 0 }), 1, 'paid/m'),
    ]
    const { events: repriced, costKnown } = repriceEvents(events, resolve)
    expect(costKnown).toBe(true)
    expect(doneAt(repriced, 0).usage.costUsd).toBe(6)
  })

  it('marks costKnown false when resolve falls through to LAST RESORT', () => {
    const resolve = (): ResolvedCost | null => null
    const events: SddEvent[] = [
      spawnedEvent('reviewer-r1', 'weird/none', 1),
      doneEvent(makeUsage({ inputTokens: 500_000, outputTokens: 0, costUsd: 0 }), 2),
    ]
    const { events: repriced, costKnown } = repriceEvents(events, resolve)
    expect(costKnown).toBe(false)
    expect(doneAt(repriced, 1).usage.costUsd).toBe(0)
  })

  it('returns zero-token done events unchanged without invoking resolve', () => {
    let calls = 0
    const resolve = (): ResolvedCost | null => {
      calls++
      return null
    }
    const event = doneEvent(makeUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 }), 1, 'paid/m')
    const { events: repriced, costKnown } = repriceEvents([event], resolve)
    expect(repriced[0]).toBe(event)
    expect(costKnown).toBe(true)
    expect(calls).toBe(0)
  })

  it('reprices partial-token done events, exercising each operand of the zero-token guard', () => {
    const resolve = resolverFrom({ 'paid/m': { input: 5, output: 15, source: 'primary' } })
    const events: SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 0, outputTokens: 1_000_000, reasoningTokens: 0, costUsd: 0 }), 1, 'paid/m'),
      doneEvent(makeUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 1_000_000, costUsd: 0 }), 2, 'paid/m'),
    ]
    const { events: repriced, costKnown } = repriceEvents(events, resolve)
    expect(doneAt(repriced, 0).usage.costUsd).toBe(15)
    expect(doneAt(repriced, 1).usage.costUsd).toBe(5)
    expect(costKnown).toBe(true)
  })

  it('reprices cache-only done events, exercising the cached-token operands of the zero-token guard', () => {
    const resolve = resolverFrom({
      'paid/m': { input: 5, output: 15, cache_read: 0.5, cache_write: 6.25, source: 'primary' },
    })
    const events: SddEvent[] = [
      doneEvent(
        makeUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedReadTokens: 2_000_000, costUsd: 0 }),
        1,
        'paid/m',
      ),
      doneEvent(
        makeUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedWriteTokens: 1_000_000, costUsd: 0 }),
        2,
        'paid/m',
      ),
    ]
    const { events: repriced, costKnown } = repriceEvents(events, resolve)
    expect(doneAt(repriced, 0).usage.costUsd).toBe(1)
    expect(doneAt(repriced, 1).usage.costUsd).toBe(6.25)
    expect(costKnown).toBe(true)
  })

  it('marks costKnown false and skips resolve when no model is resolvable', () => {
    let calls = 0
    const resolve = (): ResolvedCost | null => {
      calls++
      return null
    }
    const event = doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0 }), 1)
    const { events: repriced, costKnown } = repriceEvents([event], resolve)
    expect(repriced[0]).toBe(event)
    expect(costKnown).toBe(false)
    expect(calls).toBe(0)
  })

  it('uses a null resolver by default, marking unknown-model cost as unknown', () => {
    const events: SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0 }), 1, 'unknown/m'),
    ]
    const { events: repriced, costKnown } = repriceEvents(events)
    expect(costKnown).toBe(false)
    expect(doneAt(repriced, 0).usage.costUsd).toBe(0)
  })
})

describe('aggregateUsage reprice integration', () => {
  it('reprices zero-cost subscription events and reports an estimated (costKnown=false) total', () => {
    const resolve = resolverFrom({ 'zai-coding-plan/glm-5.2': { input: 5, output: 15, source: 'fallback' } })
    const events: SddEvent[] = [
      spawnedEvent('reviewer-r1', 'zai-coding-plan/glm-5.2', 1),
      doneEvent(
        makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000, reasoningTokens: 0, costUsd: 0, wallMs: 1000 }),
        2,
      ),
    ]
    const usage = aggregateUsage(events, resolve)
    expect(usage.costUsd).toBe(20)
    expect(usage.costKnown).toBe(false)
  })

  it('reports costKnown=true when every repriced event resolved via the primary entry', () => {
    const resolve = resolverFrom({ 'paid/m': { input: 5, output: 15, source: 'primary' } })
    const events: SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0, wallMs: 1000 }), 1, 'paid/m'),
    ]
    const usage = aggregateUsage(events, resolve)
    expect(usage.costUsd).toBe(5)
    expect(usage.costKnown).toBe(true)
  })

  it('reports costKnown=false with zero cost when resolve returns null', () => {
    const resolve = (): ResolvedCost | null => null
    const events: SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0, wallMs: 1000 }), 1, 'weird/none'),
    ]
    const usage = aggregateUsage(events, resolve)
    expect(usage.costUsd).toBe(0)
    expect(usage.costKnown).toBe(false)
  })

  it('defaults to a null resolver when none is passed, reporting costKnown false', () => {
    const events: SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0, wallMs: 1000 }), 1, 'unknown/m'),
    ]
    const usage = aggregateUsage(events)
    expect(usage.costUsd).toBe(0)
    expect(usage.costKnown).toBe(false)
  })
})

describe('treeSpend (D10 aggregate ledger)', () => {
  it('sums parent done-events plus child_done usage and reads unknown when any usage is absent', () => {
    const events: SddEvent[] = [
      doneEvent(makeUsage({ costUsd: 0.4 }), 1),
      {
        altitude: 'L2',
        type: 'child_done',
        child: 'auth-db',
        outcome: 'done',
        usage: makeUsage({ costUsd: 0.25 }),
        seq: 2,
        ts: '2026-01-01T00:00:00.000Z',
      },
    ]
    expect(treeSpend(events)).toEqual({ spentUsd: 0.65, costKnown: true })

    const withUnpriced: SddEvent[] = [
      ...events,
      {
        altitude: 'L2',
        type: 'child_done',
        child: 'auth-api',
        outcome: 'done',
        seq: 3,
        ts: '2026-01-01T00:00:00.000Z',
      },
    ]
    expect(treeSpend(withUnpriced)).toEqual({ spentUsd: 0.65, costKnown: false })
  })

  it('reprices the parent own zero-cost done events through resolve (D10 aggregateUsage shape)', () => {
    const resolve = resolverFrom({ 'paid/m': { input: 5, output: 15, source: 'primary' } })
    const events: SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0 }), 1, 'paid/m'),
      {
        altitude: 'L2',
        type: 'child_done',
        child: 'auth-db',
        outcome: 'done',
        usage: makeUsage({ costUsd: 0.25 }),
        seq: 2,
        ts: '2026-01-01T00:00:00.000Z',
      },
    ]
    expect(treeSpend(events, resolve)).toEqual({ spentUsd: 5.25, costKnown: true })
  })

  it('reads unknown when the parent own done events cannot be priced (fail closed)', () => {
    const events: SddEvent[] = [
      doneEvent(makeUsage({ inputTokens: 1_000_000, outputTokens: 0, costUsd: 0 }), 1, 'weird/none'),
    ]
    expect(treeSpend(events)).toEqual({ spentUsd: 0, costKnown: false })
  })
})
