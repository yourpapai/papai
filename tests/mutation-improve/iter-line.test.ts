// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatIterLine, ITER_SLOT_KEY, withIterPhase } from '../../mutation-improve/src/iter-line.js'
import type { IterationResult } from '../../mutation-improve/src/pipeline.js'

describe('formatIterLine', () => {
  test('improved shows mark, file, scores, duration', () => {
    const outcome: IterationResult = {
      iter: 3,
      outcome: 'improved',
      file: 'src/providers/config-validation.ts',
      beforeScore: 0.622,
      afterScore: 0.979,
    }
    expect(formatIterLine(outcome, 60_000)).toBe(
      'iter 3 ✓ improved · src/providers/config-validation.ts · 62.2%→97.9% · 1m00s',
    )
  })

  test('capped uses the same shape with the capped label', () => {
    const outcome: IterationResult = {
      iter: 1,
      outcome: 'capped',
      file: 'src/reply-context.ts',
      beforeScore: 0.5,
      afterScore: 0.7606,
    }
    expect(formatIterLine(outcome, 1300_000)).toBe('iter 1 ✓ capped · src/reply-context.ts · 50.0%→76.1% · 21m40s')
  })

  test('skipped shows the before score against the threshold', () => {
    const outcome: IterationResult = { iter: 5, outcome: 'skipped', file: 'src/foo.ts', beforeScore: 0.912 }
    expect(formatIterLine(outcome, 123_000)).toBe('iter 5 – skipped · src/foo.ts · 91.2% ≥ threshold · 2m03s')
  })

  test('failed shows gate and truncated reason', () => {
    const outcome: IterationResult = {
      iter: 7,
      outcome: 'failed',
      file: 'src/tools/compaction/result-store.ts',
      gate: 'exception',
      reason: 'improve exited with code 1: boom',
    }
    expect(formatIterLine(outcome, 1800_000)).toBe(
      'iter 7 ✗ failed · src/tools/compaction/result-store.ts · exception: improve exited with code 1: boom · 30m00s',
    )
  })

  test('failed without a file omits the file segment', () => {
    const outcome: IterationResult = { iter: 2, outcome: 'failed', gate: 'exception', reason: 'worktree add failed' }
    expect(formatIterLine(outcome, 1000)).toBe('iter 2 ✗ failed · exception: worktree add failed · 1s')
  })

  test('a very long failure reason is truncated with an ellipsis', () => {
    const outcome: IterationResult = {
      iter: 8,
      outcome: 'failed',
      file: 'src/x.ts',
      gate: 'build',
      reason: 'x'.repeat(500),
    }
    const line = formatIterLine(outcome, 1000)
    expect(line).toContain('…')
    expect(line.length).toBeLessThan(260)
  })
})

describe('withIterPhase', () => {
  test('returns the wrapped result', async () => {
    const result = await withIterPhase({ dynamic: true, slot: () => {} }, 'build', () => Promise.resolve(42))
    expect(result).toBe(42)
  })

  test('ticks the iter slot immediately with the phase label', async () => {
    const slots: Array<readonly [string, string | null]> = []
    await withIterPhase(
      {
        dynamic: true,
        slot: (key, line) => {
          slots.push([key, line] as const)
        },
      },
      'build',
      () => Promise.resolve('done'),
    )
    expect(slots[0]![0]).toBe(ITER_SLOT_KEY)
    expect(slots[0]![1]).toContain('build')
    expect(slots.every(([, line]) => line !== null)).toBe(true)
  })

  test('non-dynamic log runs fn without touching the slot', async () => {
    const slots: string[] = []
    const result = await withIterPhase(
      {
        dynamic: false,
        slot: () => {
          slots.push('x')
        },
      },
      'build',
      () => Promise.resolve('ran'),
    )
    expect(result).toBe('ran')
    expect(slots).toEqual([])
  })

  test('a log without slot runs fn untouched', async () => {
    const result = await withIterPhase({}, 'mutate', () => Promise.resolve('ran'))
    expect(result).toBe('ran')
  })
})
