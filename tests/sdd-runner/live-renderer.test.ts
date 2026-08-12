// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { EventInput } from '../../sdd-runner/src/events.js'
import { DynamicRenderer } from '../../sdd-runner/src/live-renderer.js'

interface MemoryStreamOptions {
  readonly isTTY: boolean
  readonly columns: number
}

class MemoryStream {
  readonly chunks: string[] = []
  readonly isTTY: boolean
  readonly columns: number

  constructor(opts: MemoryStreamOptions) {
    this.isTTY = opts.isTTY
    this.columns = opts.columns
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return true
  }
}

const REVIEW_STAGE_ENTER: EventInput = { altitude: 'L2', type: 'stage_enter', stage: 'review' }
const ROUND_OPEN_1_3: EventInput = { altitude: 'L2', type: 'round_open', round: 1, cap: 3 }
const RESOLVER_TOOL_USE: EventInput = {
  altitude: 'L0',
  type: 'tool_use',
  agent: 'resolver-r1',
  tool: 'readFile',
  arg: 'foo.ts',
}
const RESOLVER_DONE: EventInput = {
  altitude: 'L1',
  type: 'done',
  agent: 'resolver-r1',
  usage: { inputTokens: 5000, outputTokens: 1200, reasoningTokens: 10, costUsd: 0.01, wallMs: 1000 },
}

describe('DynamicRenderer', () => {
  it('redraws a pipeline map + slot + status block on each event against a TTY stream', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 80 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent(REVIEW_STAGE_ENTER)
    renderer.renderEvent(ROUND_OPEN_1_3)
    renderer.renderEvent(RESOLVER_TOOL_USE)
    renderer.renderEvent(RESOLVER_DONE)

    const out = stream.chunks.join('')
    expect(out).toContain('\u25B6 review active (round 1/3)')
    expect(out).toContain('resolver-r1 \u25B6 readFile foo.ts')
    expect(out).toContain('5.0k')
    expect(out).toContain('1.2k')
    expect(out).toMatch(/\d+s/u)
    expect(out).toContain('\r')
    expect(out).toContain('\u001b[2K')
  })

  it('writes no ANSI escapes on a non-TTY stream', () => {
    const stream = new MemoryStream({ isTTY: false, columns: 80 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent(REVIEW_STAGE_ENTER)
    renderer.renderEvent(RESOLVER_TOOL_USE)
    const out = stream.chunks.join('')
    expect(out).not.toContain('\u001b[2K')
    expect(out).not.toContain('\r')
  })
})
