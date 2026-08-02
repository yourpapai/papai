// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { LiveRenderer, type RendererStream } from '../../review-loop/src/live-renderer.js'

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
