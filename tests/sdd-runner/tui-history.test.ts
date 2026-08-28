// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import { initialReplayState } from '../../sdd-runner/src/replay.js'
import { foldHistoryRows, historyRows } from '../../sdd-runner/src/tui-history.js'
import type { HistoryFold, HistoryRow } from '../../sdd-runner/src/tui-history.js'
import { foldSlots } from '../../sdd-runner/src/watch-view.js'
import type { SlotState } from '../../sdd-runner/src/watch-view.js'

/**
 * tui-history (fancy-ui 7.2/7.3): the pure splitter for the running
 * screen's append-only region — closed-round burndown rows, filed findings,
 * done-agent rows — folded chronologically from events (fold-only, no
 * persisted-format change). `ReplayState.autoDecisions` stays unrendered,
 * exactly as the running screen renders today.
 */

const TS = '2026-01-01T00:00:00.000Z'

function e(seq: number, init: EventInput): SddEvent {
  return stampEvent(init, seq, TS)
}

function foldAll(events: readonly SddEvent[]): HistoryFold & { readonly slots: readonly SlotState[] } {
  let history: readonly HistoryRow[] = []
  let slots: readonly SlotState[] = []
  for (const event of events) {
    slots = foldSlots(slots, event)
    history = foldHistoryRows(history, event, slots)
  }
  return { state: initialReplayState(), slots, findings: [], history }
}

function isPrefix(prefix: readonly HistoryRow[], full: readonly HistoryRow[]): boolean {
  return prefix.every(
    (row, index) => full[index] !== undefined && full[index]?.key === row.key && full[index]?.text === row.text,
  )
}

describe('foldHistoryRows / historyRows (7.2)', () => {
  it('derives exactly the finalized kinds: closed-round burndown, filed findings, done agents', () => {
    const fold = foldAll([
      e(1, { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' }),
      e(2, {
        altitude: 'L2',
        type: 'finding',
        action: 'filed',
        id: 'F1',
        round: 1,
        class: 'MATERIAL',
        detail: 'gap x',
      }),
      e(3, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 2, material: 3, nitpick: 1 },
      }),
      e(4, {
        altitude: 'L1',
        type: 'done',
        agent: 'reviewer-r1',
        model: 'glm',
        usage: {
          inputTokens: 5000,
          outputTokens: 1200,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.0123,
          wallMs: 10_000,
        },
      }),
    ])
    expect(historyRows(fold)).toEqual([
      { key: 'finding:F1', text: 'MATERIAL F1 r1 gap x', severity: 'material' },
      { key: 'round:1', text: 'round 1: 2b 3m 1n' },
      {
        key: 'done:reviewer-r1:1',
        text: 'reviewer-r1 done · glm · in 5.0k out 1.2k · $0.0123',
        parts: [{ text: 'reviewer-r1 done · glm · in 5.0k out 1.2k · ' }, { text: '$0.0123', tone: 'known-cost' }],
      },
    ])
  })

  it('is append-only and monotonic: every event grows a stable prefix', () => {
    const events = [
      e(1, { altitude: 'L1', type: 'spawned', agent: 'a1', role: 'reviewer', model: 'glm' }),
      e(2, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 0 },
      }),
      e(3, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F2', round: 1, class: 'NITPICK' }),
      e(4, {
        altitude: 'L1',
        type: 'done',
        agent: 'a1',
        model: 'glm',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.0001,
          wallMs: 1,
        },
      }),
    ]
    let previous: readonly HistoryRow[] = []
    for (const event of events) {
      const next = foldHistoryRows(previous, event, [])
      expect(isPrefix(previous, next)).toBe(true)
      previous = next
    }
    expect(previous.length).toBe(3)
  })

  it('is idempotent over an unchanged fold', () => {
    const fold = foldAll([
      e(1, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 1, nitpick: 0 },
      }),
    ])
    expect(historyRows(fold)).toEqual(historyRows(fold))
    expect(historyRows(fold).length).toBe(1)
  })

  it('auto-decisions stay unrendered', () => {
    const before = foldAll([
      e(1, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 0, nitpick: 0 },
      }),
    ])
    const after = foldHistoryRows(
      before.history,
      e(2, {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R5',
        decision: 'extend',
        evidenceDigest: 'sha256:0f',
        gateVersion: 3,
      }),
      [],
    )
    expect(after).toEqual(before.history)
  })

  it('a re-spawned label keys a distinct done row by its spawn ordinal', () => {
    const fold = foldAll([
      e(1, { altitude: 'L1', type: 'spawned', agent: 'fixer', role: 'fixer', model: 'glm' }),
      e(2, {
        altitude: 'L1',
        type: 'done',
        agent: 'fixer',
        model: 'glm',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.001,
          wallMs: 1,
        },
      }),
    ])
    const respawned = foldSlots(
      fold.slots,
      e(3, { altitude: 'L1', type: 'spawned', agent: 'fixer', role: 'fixer', model: 'glm' }),
    )
    const doneAgain = foldHistoryRows(
      fold.history,
      e(4, {
        altitude: 'L1',
        type: 'done',
        agent: 'fixer',
        model: 'glm',
        usage: {
          inputTokens: 20,
          outputTokens: 8,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.002,
          wallMs: 1,
        },
      }),
      respawned,
    )
    expect(doneAgain.map((row) => row.key)).toEqual(['done:fixer:1', 'done:fixer:2'])
  })
})
