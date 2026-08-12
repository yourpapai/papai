// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { AgentUsage, SddEvent } from '../../sdd-runner/src/events.js'
import { aggregateUsage } from '../../sdd-runner/src/usage-aggregate.js'

function doneEvent(usage: AgentUsage, seq: number): SddEvent {
  return { altitude: 'L1', type: 'done', agent: 'reviewer-r1', usage, seq, ts: '2026-01-01T00:00:00.000Z' }
}

function makeUsage(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0, ...overrides }
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
      costUsd: 0.75,
      wallMs: 3000,
    })
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
      costUsd: 0,
      wallMs: 0,
    })
  })

  it('returns zeros for empty input', () => {
    expect(aggregateUsage([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      wallMs: 0,
    })
  })
})
