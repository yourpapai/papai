// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { renderPipelineMap } from '../../sdd-runner/src/renderer.js'
import type { ReplayState } from '../../sdd-runner/src/replay.js'
import { displayWidth, frameLines, joinOrStack, padDisplay, truncateDisplay } from '../../sdd-runner/src/tui-panels.js'

/**
 * tui-panels (fancy-ui 3.x): the single width authority for intra-line
 * columns — string-width measures, cli-truncate truncates by the same
 * measure — plus one shared frame style and the joinOrStack reflow
 * primitive whose threshold is pinned to renderPipelineMap's boundary so
 * drift on either side fails here.
 */

const IDLE: ReplayState = {
  stages: {
    intake: 'pending',
    draft: 'pending',
    review: 'pending',
    decompose: 'pending',
    atomicity: 'pending',
    gate: 'pending',
  },
  depth: 'M',
  round: null,
  perRound: [],
  lastVerdict: null,
  gate: null,
  autoDecisions: [],
  children: {},
}

const REPS: ReadonlyArray<readonly [string, string, number]> = [
  ['ascii', 'abc', 3],
  ['cjk', '日本語', 6],
  ['emoji', '🎉', 2],
  ['combining mark', 'é', 1],
  ['zwj family', '👨‍👩‍👧‍👦', 2],
  ['mixed', 'a日b🎉', 6],
]

describe('displayWidth (string-width authority)', () => {
  it('measures every representative by visible width', () => {
    for (const [, text, width] of REPS) {
      expect(displayWidth(text)).toBe(width)
    }
    expect(displayWidth('')).toBe(0)
  })
})

describe('padDisplay', () => {
  it('pads to the requested display width, not code-unit length', () => {
    expect(padDisplay('abc', 6)).toBe('abc   ')
    expect(padDisplay('日本語', 8)).toBe('日本語  ')
    expect(padDisplay('🎉', 4)).toBe('🎉  ')
    expect(padDisplay('áb', 6)).toBe('áb    ')
  })

  it('never pads beyond a string that already meets the width', () => {
    expect(padDisplay('日本語', 6)).toBe('日本語')
    expect(padDisplay('abc', 2)).toBe('abc')
  })
})

describe('truncateDisplay', () => {
  it('truncates by visible width so no result ever exceeds the limit', () => {
    for (const width of [1, 2, 3, 5, 8, 12]) {
      for (const [, text] of REPS) {
        const long = `${text}${text}${text}${text}`
        const cut = truncateDisplay(long, width)
        expect(displayWidth(cut)).toBeLessThanOrEqual(width)
      }
    }
  })

  it('keeps content that fits untouched', () => {
    expect(truncateDisplay('abc', 5)).toBe('abc')
    expect(truncateDisplay('日本語', 6)).toBe('日本語')
  })
})

describe('frameLines (one shared frame style)', () => {
  it('frames content in one style with every line exactly the frame width', () => {
    const lines = frameLines(['one', '日本語 row'], 30, 'Title')
    expect(lines.length).toBe(4)
    expect(lines[0]?.startsWith('╭─ Title ')).toBe(true)
    expect(lines[0]?.endsWith('╮')).toBe(true)
    expect(lines[1]?.startsWith('│ one')).toBe(true)
    expect(lines[1]?.endsWith('│')).toBe(true)
    expect(lines[2]?.startsWith('│ 日本語 row')).toBe(true)
    expect(lines[3]).toBe(`╰${'─'.repeat(28)}╯`)
    for (const line of lines) expect(displayWidth(line)).toBe(30)
  })

  it('truncates over-wide content instead of overflowing the frame', () => {
    const lines = frameLines(['日本語日本語日本語日本語'], 20)
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(20)
    expect(lines[1]?.startsWith('│')).toBe(true)
  })

  it('every panel from the same helper shares the frame style across widths', () => {
    const a = frameLines(['x'], 24, 'A')
    const b = frameLines(['y'], 40)
    for (const lines of [a, b]) {
      expect(lines[0]?.startsWith('╭─')).toBe(true)
      expect(lines[0]?.endsWith('╮')).toBe(true)
      expect(lines.at(-1)?.startsWith('╰')).toBe(true)
      expect(lines.at(-1)?.endsWith('╯')).toBe(true)
    }
  })
})

describe('joinOrStack (reflow primitive)', () => {
  it('joins at 60 and stacks at 59', () => {
    expect(joinOrStack(60)).toBe('join')
    expect(joinOrStack(59)).toBe('stack')
    expect(joinOrStack(120)).toBe('join')
    expect(joinOrStack(20)).toBe('stack')
  })

  it('the threshold is pinned to renderPipelineMap\u2019s boundary — drift on either side fails', () => {
    expect(renderPipelineMap(IDLE, { width: 60 })).toHaveLength(1)
    expect(renderPipelineMap(IDLE, { width: 59 }).length).toBeGreaterThan(1)
  })
})
