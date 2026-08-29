// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { decodeClaudeLine, parseNdjsonStream } from '../../opencode-agent/src/claude-contract.js'
import type { ClaudeStreamLine } from '../../opencode-agent/src/claude-contract.js'
import { foldRateLimits } from '../../opencode-agent/src/rate-limit-windows.js'

/**
 * The fold answers one question: what standing will the *next* run meet. That is
 * why it is latest-wins rather than first — a run's last turn is the one whose
 * figures are still true when it ends.
 */

const event = (
  windows: Array<{ window: string; utilization?: number; resetsAt?: number }>,
  status = 'allowed',
): ClaudeStreamLine => ({
  kind: 'rate-limit-event',
  windows,
  status,
})

describe('foldRateLimits', () => {
  test('a stream with no rate-limit line folds to nothing', () => {
    expect(foldRateLimits([{ kind: 'assistant', tools: [] }])).toEqual([])
  })

  test('one window from one turn folds to that window', () => {
    expect(foldRateLimits([event([{ window: 'five_hour', utilization: 0.235, resetsAt: 100 }])])).toEqual([
      { window: 'five_hour', utilization: 0.235, resetsAt: 100, status: 'allowed' },
    ])
  })

  test('the last turn wins for a window several turns reported', () => {
    const folded = foldRateLimits([
      event([{ window: 'five_hour', utilization: 0.1, resetsAt: 100 }]),
      event([{ window: 'five_hour', utilization: 0.4, resetsAt: 100 }]),
    ])

    expect(folded).toEqual([{ window: 'five_hour', utilization: 0.4, resetsAt: 100, status: 'allowed' }])
  })

  test('each window keeps its own figures rather than the newest line’s', () => {
    const folded = foldRateLimits([
      event([
        { window: 'five_hour', utilization: 0.235, resetsAt: 100 },
        { window: 'seven_day', utilization: 0.412, resetsAt: 900 },
      ]),
    ])

    expect(folded).toEqual([
      { window: 'five_hour', utilization: 0.235, resetsAt: 100, status: 'allowed' },
      { window: 'seven_day', utilization: 0.412, resetsAt: 900, status: 'allowed' },
    ])
  })

  test('a window that stops being reported keeps the last standing seen for it', () => {
    // A later turn naming only the five-hour window does not erase the weekly
    // one: the account still has that limit, and the last figure for it is the
    // best answer available.
    const folded = foldRateLimits([
      event([
        { window: 'five_hour', utilization: 0.1 },
        { window: 'seven_day', utilization: 0.412 },
      ]),
      event([{ window: 'five_hour', utilization: 0.5 }]),
    ])

    expect(folded).toEqual([
      { window: 'five_hour', utilization: 0.5, status: 'allowed' },
      { window: 'seven_day', utilization: 0.412, status: 'allowed' },
    ])
  })

  test('a window reported without a utilization folds without one', () => {
    const folded = foldRateLimits([event([{ window: 'five_hour', resetsAt: 100 }])])

    expect(folded).toEqual([{ window: 'five_hour', resetsAt: 100, status: 'allowed' }])
  })

  test('an unknown window name passes through', () => {
    expect(foldRateLimits([event([{ window: 'lunar_cycle', utilization: 0.5 }])])[0]?.window).toBe('lunar_cycle')
  })

  test('the account-level status and overage ride onto every window of that line', () => {
    const folded = foldRateLimits([
      {
        kind: 'rate-limit-event',
        windows: [{ window: 'five_hour', utilization: 0.9 }],
        status: 'allowed_warning',
        overageStatus: 'allowed',
        overageResetsAt: 900,
        isUsingOverage: true,
      },
    ])

    expect(folded).toEqual([
      {
        window: 'five_hour',
        utilization: 0.9,
        status: 'allowed_warning',
        overageStatus: 'allowed',
        overageResetsAt: 900,
        isUsingOverage: true,
      },
    ])
  })

  test('windows keep the order they were first seen in, so a report reads stably', () => {
    const folded = foldRateLimits([
      event([{ window: 'seven_day', utilization: 0.4 }]),
      event([{ window: 'five_hour', utilization: 0.2 }]),
    ])

    expect(folded.map((entry) => entry.window)).toEqual(['seven_day', 'five_hour'])
  })

  test('folds the recorded 2.1.251 turn into both of its windows', () => {
    const recorded = Bun.file(
      new URL('./fixtures/claude-cli/stub-rate-limit-turn.ndjson', import.meta.url).pathname,
    ).text()

    return recorded.then((text) => {
      const lines = parseNdjsonStream(text)
        .map((raw) => decodeClaudeLine(raw))
        .filter((line): line is ClaudeStreamLine => line !== null)

      expect(foldRateLimits(lines)).toMatchObject([
        { window: 'five_hour', utilization: 0.235 },
        { window: 'seven_day', utilization: 0.412 },
      ])
    })
  })
})
