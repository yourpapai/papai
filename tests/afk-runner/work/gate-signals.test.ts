// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { AgentUsage, SddEvent } from '../../../afk-runner/src/events.js'
import { costSummaryOf, usageTotalsOf } from '../../../afk-runner/src/work/gate-signals.js'

const TS = '2026-01-01T00:00:00.000Z'

function usageOf(over: Partial<AgentUsage>): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    costUsd: 0,
    wallMs: 0,
    ...over,
  }
}

function doneEvent(seq: number, usage: AgentUsage): SddEvent {
  return { altitude: 'L1', type: 'done', agent: 'impl', usage, seq, ts: TS }
}

describe('usageTotalsOf (U9 cross-run accounting seam)', () => {
  it('sums every token flavor and cost across done events, ignoring noise', () => {
    const events: readonly SddEvent[] = [
      doneEvent(
        1,
        usageOf({
          inputTokens: 1_000_000,
          outputTokens: 200_000,
          reasoningTokens: 100_000,
          cachedReadTokens: 50_000,
          cachedWriteTokens: 50_000,
          costUsd: 0.25,
        }),
      ),
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 2, ts: TS },
      doneEvent(3, usageOf({ inputTokens: 500_000, costUsd: 0.5 })),
    ]
    expect(usageTotalsOf(events)).toEqual({ costUsd: 0.75, costKnown: true, tokens: 1_900_000 })
  })

  it('marks cost unknown when tokens were spent at zero cost (unmetered model)', () => {
    const events: readonly SddEvent[] = [doneEvent(1, usageOf({ inputTokens: 5, costUsd: 0 }))]
    expect(usageTotalsOf(events)).toEqual({ costUsd: 0, costKnown: false, tokens: 5 })
  })

  it('keeps the priced+unpriced mix fail-closed: cost sums, knowledge is false', () => {
    const events: readonly SddEvent[] = [
      doneEvent(1, usageOf({ inputTokens: 100, costUsd: 0.5 })),
      doneEvent(2, usageOf({ inputTokens: 100, costUsd: 0 })),
    ]
    expect(usageTotalsOf(events)).toEqual({ costUsd: 0.5, costKnown: false, tokens: 200 })
  })

  it('returns zeroed known totals over an empty log', () => {
    expect(usageTotalsOf([])).toEqual({ costUsd: 0, costKnown: true, tokens: 0 })
  })

  it('costSummaryOf delegates — its consumer shape is the same fold without tokens', () => {
    const events: readonly SddEvent[] = [
      doneEvent(1, usageOf({ inputTokens: 10, costUsd: 0.25 })),
      doneEvent(2, usageOf({ inputTokens: 10, costUsd: 0 })),
    ]
    expect(costSummaryOf(events)).toEqual({ costUsd: 0.25, costKnown: false })
    expect(costSummaryOf(events)).toEqual({
      costUsd: usageTotalsOf(events).costUsd,
      costKnown: usageTotalsOf(events).costKnown,
    })
  })
})
