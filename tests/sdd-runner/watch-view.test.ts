// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { DigestRecord, ReplayState } from '../../sdd-runner/src/replay.js'
import { foldSlots, WatchView } from '../../sdd-runner/src/watch-view.js'
import type { SlotState } from '../../sdd-runner/src/watch-view.js'

function replay(overrides: Partial<ReplayState> = {}): ReplayState {
  return {
    stages: {
      intake: 'done',
      draft: 'done',
      review: 'active',
      decompose: 'pending',
      atomicity: 'pending',
      gate: 'pending',
    },
    depth: 'M',
    round: { current: 2, cap: 3 },
    perRound: [
      {
        round: 1,
        counts: { blocker: 1, material: 2, nitpick: 0 },
        resolved: 1,
        dismissed: 0,
        verdict: 'open',
      },
      {
        round: 2,
        counts: { blocker: 0, material: 1, nitpick: 0 },
        resolved: 2,
        dismissed: 0,
        verdict: 'open',
      },
    ] as readonly DigestRecord[],
    lastVerdict: null,
    gate: null,
    autoDecisions: [],
    children: {},
    ...overrides,
  }
}

function slots(): readonly SlotState[] {
  return [
    { agent: 'resolver-r2', model: 'glm', status: 'running', label: 'readFile src/a.ts', attempt: 1, spawn: 1 },
    {
      agent: 'reviewer-r2',
      model: 'glm',
      status: 'done',
      label: 'done',
      attempt: 1,
      spawn: 2,
      usage: { input: 5000, output: 1200, costUsd: 0.01 },
    },
    { agent: 'skeptic-r2', model: 'glm', status: 'retrying', label: 'search', attempt: 2, spawn: 3 },
  ]
}

describe('WatchView (15.2)', () => {
  it('renders four regions: pipeline map + stage times, findings, burndown + autoDecisions, slots', () => {
    const { lastFrame } = render(
      createElement(WatchView, {
        state: replay(),
        stageTimes: new Map([['intake', { wallMs: 42_000, costUsd: 0.05 }]]),
        slots: slots(),
        findings: [{ id: 'F1', class: 'MATERIAL', round: 1, detail: 'design lacks rollback' }],
        width: 100,
      }),
    )
    const frame = lastFrame()
    expect(frame).toContain('review')
    expect(frame).toContain('intake done · 42s · $0.0500')
    expect(frame).toContain('F1')
    expect(frame).toContain('round 2')
    expect(frame).toContain('resolver-r2')
    expect(frame).toContain('retry 2')
  })
})

describe('foldSlots spawn ordinal (7.1)', () => {
  it('assigns a monotonic in-memory ordinal per spawn; a re-spawned label gets a fresh one', () => {
    let folded: readonly SlotState[] = []
    folded = foldSlots(folded, {
      altitude: 'L1',
      type: 'spawned',
      agent: 'reviewer-r1',
      role: 'reviewer',
      model: 'glm',
    })
    expect(folded[0]?.spawn).toBe(1)
    folded = foldSlots(folded, {
      altitude: 'L1',
      type: 'spawned',
      agent: 'skeptic-r1',
      role: 'skeptic',
      model: 'glm',
    })
    expect(folded.map((slot) => slot.spawn)).toEqual([1, 2])
    folded = foldSlots(folded, { altitude: 'L1', type: 'retrying', agent: 'skeptic-r1', reason: 'stall', attempt: 2 })
    folded = foldSlots(folded, {
      altitude: 'L1',
      type: 'spawned',
      agent: 'reviewer-r1',
      role: 'reviewer',
      model: 'glm',
    })
    expect(folded.map((slot) => slot.agent)).toEqual(['skeptic-r1', 'reviewer-r1'])
    expect(folded.find((slot) => slot.agent === 'reviewer-r1')?.spawn).toBe(3)
    expect(folded.find((slot) => slot.agent === 'skeptic-r1')?.spawn).toBe(2)
  })
})
