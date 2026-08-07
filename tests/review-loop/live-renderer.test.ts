// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { LiveRenderer, type RendererStream, withLivePhase } from '../../review-loop/src/live-renderer.js'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
import { RunStats } from '../../review-loop/src/run-stats.js'

function makeStream(opts: { isTTY?: boolean; columns?: number } = {}): {
  stream: RendererStream
  output: string[]
} {
  const output: string[] = []
  return {
    output,
    stream: {
      write(s: string): boolean {
        output.push(s)
        return true
      },
      ...opts,
    },
  }
}

describe('LiveRenderer', () => {
  test('event writes a scrolling line', () => {
    const { output, stream } = makeStream()
    const r = new LiveRenderer(stream)
    r.event('hello')
    expect(output).toEqual(['hello\n'])
  })

  test('log aliases event', () => {
    const { output, stream } = makeStream()
    const r = new LiveRenderer(stream)
    r.log('hi')
    expect(output).toEqual(['hi\n'])
  })

  test('dynamic=false when not a TTY', () => {
    const { stream } = makeStream()
    expect(new LiveRenderer(stream).dynamic).toBe(false)
  })

  test('dynamic=true when TTY', () => {
    const { stream } = makeStream({ isTTY: true })
    expect(new LiveRenderer(stream).dynamic).toBe(true)
  })

  test('non-TTY live scrolls with newline', () => {
    const { output, stream } = makeStream()
    new LiveRenderer(stream).live(['x'])
    expect(output).toEqual(['x\n'])
  })

  test('TTY live writes clear-line + content with no newline', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 80 })
    new LiveRenderer(stream).live(['working'])
    expect(output).toEqual(['\r\u001b[2Kworking'])
  })

  test('event after a live line clears it first (TTY)', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 80 })
    const r = new LiveRenderer(stream)
    r.live(['working'])
    r.event('done')
    expect(output).toEqual(['\r\u001b[2Kworking', '\r\u001b[2K', 'done\n'])
  })

  test('clearLive is a no-op when nothing is live', () => {
    const { output, stream } = makeStream({ isTTY: true })
    new LiveRenderer(stream).clearLive()
    expect(output).toEqual([])
  })

  test('TTY live truncates to columns with ellipsis', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 10 })
    new LiveRenderer(stream).live(['abcdefghijklmnopqrstuvwxyz'])
    expect(output[0]).toBe('\r\u001b[2Kabcdefghi\u2026')
  })

  test('ProgressReporter.live accepts an array of lines (one per active worker)', () => {
    const captured: string[] = []
    const stream = {
      write: (s: string): boolean => {
        captured.push(s)
        return true
      },
      isTTY: false,
    }
    const r = new LiveRenderer(stream)
    r.live(['line 1', 'line 2'])
    expect(captured.join('')).toContain('line 1')
    expect(captured.join('')).toContain('line 2')
  })
})

describe('LiveRenderer.issue', () => {
  test('found events print an indented plus line', () => {
    const { stream, output } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({
      type: 'found',
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      severity: 'high',
      file: 'src/auth/login.ts',
      line: 42,
      title: 'Token refresh race on 401',
    })
    expect(output).toContain('  + #a1b2c3d4 [high]     src/auth/login.ts:42 — Token refresh race on 401\n')
  })

  test('decided events print a mark line with note', () => {
    const { stream, output } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({
      type: 'decided',
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      verdict: 'needs_human',
      title: 't',
      note: 'merge conflict',
    })
    expect(output).toContain('! #a1b2c3d4 → needs human (merge conflict)\n')
  })
})

describe('LiveRenderer.statusSuffix', () => {
  test('is empty before any events', () => {
    const { stream } = makeStream()
    expect(new LiveRenderer(stream).statusSuffix()).toBe('')
  })

  test('shows round after a round event', () => {
    const { stream } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({ type: 'round', round: 2, maxRounds: 5 })
    expect(renderer.statusSuffix()).toBe('round 2/5')
  })

  test('counts found and decided issues, omitting zero segments', () => {
    const { stream } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({ type: 'round', round: 1, maxRounds: 3 })
    renderer.issue({
      type: 'found',
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      severity: 'low',
      file: 'a.ts',
      line: 1,
      title: 'A',
    })
    renderer.issue({
      type: 'found',
      id: 'bbbbbbbb-0000-0000-0000-000000000000',
      severity: 'low',
      file: 'b.ts',
      line: 2,
      title: 'B',
    })
    renderer.issue({ type: 'decided', id: 'aaaaaaaa-0000-0000-0000-000000000000', verdict: 'fixed', title: 'A' })
    expect(renderer.statusSuffix()).toBe('round 1/3 · issues: 1 open · 1 fixed')
  })

  test('decided on an empty pending count does not go negative', () => {
    const { stream } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({ type: 'decided', id: 'aaaaaaaa-0000-0000-0000-000000000000', verdict: 'invalid', title: 'A' })
    expect(renderer.statusSuffix()).toBe('issues: 1 rejected')
  })
})

describe('LiveRenderer slots', () => {
  test('non-TTY slot is a no-op', () => {
    const { stream, output } = makeStream()
    const r = new LiveRenderer(stream)
    r.slot('fixer-w1', '  fixer-w1 ▶ edit a.ts')
    expect(output).toEqual([])
  })

  test('TTY slot renders the block with the slot line', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('fixer-w1', '  fixer-w1 ▶ edit a.ts')
    expect(output).toHaveLength(1)
    expect(output[0]).toContain('fixer-w1 ▶ edit a.ts')
  })

  test('redraw after a multi-line block moves the cursor up to the block top', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('a', 'line-a')
    r.slot('b', 'line-b')
    r.slot('c', 'line-c')
    const redraw = output[2]!
    // statusLine renders one block line above the slots, so the block is now 4 lines
    // ([status, line-a, line-b, line-c]) and the third redraw moves the cursor up 2.
    expect(redraw.startsWith('\r\u001b[2A')).toBe(true)
    expect(redraw).toContain('line-a')
    expect(redraw).toContain('line-c')
  })

  test('shrinking the block erases the leftover lines below', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('a', 'line-a')
    r.slot('b', 'line-b')
    r.slot('b', null)
    const shrink = output[output.length - 1]!
    // old block was 3 lines (status + a + b), new block is 2 (status + a):
    // after writing the 2 new lines, the third line must be erased and the
    // cursor returned to the new block bottom.
    expect(shrink.endsWith('\n\u001b[2K\u001b[1A')).toBe(true)
  })

  test('clearing the last slot erases the whole block', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('a', 'line-a')
    r.slot('a', null)
    const cleared = output[1]!
    expect(cleared.startsWith('\r')).toBe(true)
    expect(cleared).not.toContain('line-a')
  })

  test('event clears the block, prints, and redraws it', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.issue({ type: 'round', round: 1, maxRounds: 2 })
    r.slot('fixer-w1', 'line-fix')
    const before = output.length
    r.event('hello')
    expect(output[before]).toContain('\u001b[2K')
    expect(output[before + 1]).toBe('hello\n')
    expect(output[before + 2]).toContain('line-fix')
    expect(output[before + 2]).toContain('round 1/2')
  })

  test('a throwing stream downgrades the renderer and never rethrows', () => {
    const stream: RendererStream = {
      write(): boolean {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
      },
      isTTY: true,
    }
    const r = new LiveRenderer(stream)
    expect(r.dynamic).toBe(true)
    expect(() => r.event('x')).not.toThrow()
    expect(r.dynamic).toBe(false)
    expect(() => r.slot('a', 'line')).not.toThrow()
  })
})

describe('status line', () => {
  test('combines round, activity, issues, and tokens', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 200 })
    const r = new LiveRenderer(stream)
    r.issue({ type: 'round', round: 1, maxRounds: 2 })
    r.issue({
      type: 'found',
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      severity: 'low',
      file: 'a.ts',
      line: 1,
      title: 'A',
    })
    r.usage({ input: 228819, output: 9824, reasoning: 49844, cost: 0 })
    r.slot('fixer-w1', 'x')
    r.slot('fixer-w2-retry', 'y')
    const status = output[output.length - 1]!.split('\n')[0]!
    expect(status).toContain('status')
    expect(status).toContain('round 1/2')
    expect(status).toContain('fix×2')
    expect(status).toContain('issues: 1 open')
    expect(status).toContain('in 228.8k / out 9.8k')
  })

  test('maps slot keys to activity verbs', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 200 })
    const r = new LiveRenderer(stream)
    r.slot('reviewer', 'x')
    const status = output[output.length - 1]!.split('\n')[0]!
    expect(status).toContain('review')
    expect(status).not.toContain('reviewer')
  })

  test('accumulates usage across calls', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 200 })
    const r = new LiveRenderer(stream)
    r.usage({ input: 500, output: 0, reasoning: 0, cost: 0 })
    r.usage({ input: 600, output: 100, reasoning: 0, cost: 0 })
    r.slot('a', 'x')
    const status = output[output.length - 1]!.split('\n')[0]!
    expect(status).toContain('in 1.1k / out 100')
  })
})

describe('withLivePhase', () => {
  test('clears its slot when the phase ends', async () => {
    const slots: Array<readonly [string, string | null]> = []
    const reporter: ProgressReporter = {
      dynamic: true,
      event: () => {},
      live: () => {},
      clearLive: () => {},
      log: () => {},
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    }
    const { result } = await withLivePhase(reporter, 'build', () => Promise.resolve('done'))
    expect(result).toBe('done')
    expect(slots[slots.length - 1]).toEqual(['build', null])
  })
})

describe('LiveRenderer stats', () => {
  test('routes usage deltas into RunStats with label and model', () => {
    const { stream } = makeStream()
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } } })
    const r = new LiveRenderer(stream, stats)
    r.usage({ input: 100_000, output: 10_000, reasoning: 0, cost: 0, label: 'improve', model: 'm-x' })
    expect(stats.snapshot().perLabel['improve']?.input).toBe(100_000)
    expect(stats.snapshot().totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
  })

  test('diff() routes into RunStats', () => {
    const { stream } = makeStream()
    const stats = new RunStats()
    const r = new LiveRenderer(stream, stats)
    r.diff('iter-1', { added: 12, removed: 3 })
    expect(stats.snapshot().totals.added).toBe(12)
  })

  test('status line gains cost, tools and diff segments (TTY)', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 300 })
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } } })
    const r = new LiveRenderer(stream, stats)
    r.usage({ input: 100_000, output: 10_000, reasoning: 0, cost: 0, label: 'improve', model: 'm-x' })
    stats.addToolCalls('improve', 7)
    r.diff('iter-1', { added: 12, removed: 3 })
    r.slot('improve', '  improve   ▶ read a.ts · 1s · 1 tool')
    const last = output[output.length - 1]!
    expect(last).toContain('in 100.0k / out 10.0k')
    expect(last).toContain('~$0.45 est')
    expect(last).toContain('tools 7')
    expect(last).toContain('+12/-3')
  })

  test('cost segment hidden when no pricing matches', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 300 })
    const stats = new RunStats()
    const r = new LiveRenderer(stream, stats)
    r.usage({ input: 100_000, output: 10_000, reasoning: 0, cost: 0, label: 'improve' })
    r.slot('improve', 'x')
    expect(output[output.length - 1]!).not.toContain('est')
  })

  test('works without stats (legacy single-arg construction)', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 300 })
    const r = new LiveRenderer(stream)
    r.usage({ input: 5, output: 2, reasoning: 0, cost: 0 })
    r.slot('a', 'x')
    expect(output[output.length - 1]!).toContain('in 5 / out 2')
  })
})
