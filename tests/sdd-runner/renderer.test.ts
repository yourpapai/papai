// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ResolvedCost } from '../../sdd-runner/src/pricing.js'
import {
  createRenderer,
  formatBurndownLine,
  formatEvent,
  formatTrajectoryBlock,
  renderPipelineMap,
} from '../../sdd-runner/src/renderer.js'
import type { ReplayState } from '../../sdd-runner/src/replay.js'

const state: ReplayState = {
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
  perRound: [],
  lastVerdict: {
    round: 1,
    verdict: 'open',
    counts: { blocker: 1, material: 0, nitpick: 0 },
    resolved: 0,
    dismissed: 0,
  },
  gate: null,
}

describe('renderPipelineMap', () => {
  it('renders one line per stage with status markers and the active round', () => {
    const lines = renderPipelineMap(state)
    expect(lines).toHaveLength(6)
    expect(lines[0]).toContain('intake')
    expect(lines[0]).toContain('done')
    expect(lines[2]).toContain('review')
    expect(lines[2]).toContain('active')
    expect(lines[2]).toContain('2/3')
    expect(lines[3]).toContain('pending')
  })

  it('marks atomicity as skipped at S', () => {
    const sState: ReplayState = {
      ...state,
      stages: {
        intake: 'done',
        draft: 'done',
        review: 'done',
        decompose: 'done',
        atomicity: 'pending',
        gate: 'active',
      },
      depth: 'S',
      round: { current: 1, cap: 1 },
    }
    const lines = renderPipelineMap(sState)
    expect(lines[4]).toContain('skipped')
  })
})

describe('formatBurndownLine', () => {
  it('produces the spec-mandated field set with trailing verdict and lowercase class letters', () => {
    const line = formatBurndownLine({
      round: 2,
      counts: { blocker: 0, material: 0, nitpick: 1 },
      resolved: 3,
      dismissed: 2,
      verdict: 'converged',
    })
    expect(line).toBe('round 2: 0b 0m 1n \u00b7 3 resolved \u00b7 2 dismissed \u00b7 converged')
  })

  it('includes all five fields and a trailing verdict for an open round', () => {
    const line = formatBurndownLine({
      round: 1,
      counts: { blocker: 1, material: 2, nitpick: 0 },
      resolved: 0,
      dismissed: 1,
      verdict: 'open',
    })
    expect(line).toBe('round 1: 1b 2m 0n \u00b7 0 resolved \u00b7 1 dismissed \u00b7 open')
  })
})

describe('formatTrajectoryBlock', () => {
  it('renders the heading followed by one burndown line per record', () => {
    const block = formatTrajectoryBlock([
      {
        round: 1,
        counts: { blocker: 2, material: 1, nitpick: 0 },
        resolved: 1,
        dismissed: 0,
        verdict: 'open',
      },
      {
        round: 2,
        counts: { blocker: 0, material: 0, nitpick: 1 },
        resolved: 3,
        dismissed: 2,
        verdict: 'converged',
      },
    ])
    const lines = block.split('\n')
    expect(lines[0]).toBe('### Cap-hit trajectory')
    expect(lines[1]).toBe('round 1: 2b 1m 0n \u00b7 1 resolved \u00b7 0 dismissed \u00b7 open')
    expect(lines[2]).toBe('round 2: 0b 0m 1n \u00b7 3 resolved \u00b7 2 dismissed \u00b7 converged')
  })

  it('returns an empty string (no heading) for empty input', () => {
    expect(formatTrajectoryBlock([])).toBe('')
  })
})

describe('formatEvent', () => {
  it('returns null for convergence (burndown renders at round_close instead)', () => {
    const line = formatEvent(
      {
        altitude: 'L2',
        type: 'convergence',
        round: 2,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 1 },
      },
      'normal',
    )
    expect(line).toBeNull()
  })

  it('returns null for L0 events at normal verbosity', () => {
    const line = formatEvent(
      {
        altitude: 'L0',
        type: 'tool_use',
        agent: 'reviewer-1',
        tool: 'code_search',
      },
      'normal',
    )
    expect(line).toBeNull()
  })

  it('returns a line for L0 events at debug verbosity', () => {
    const line = formatEvent(
      {
        altitude: 'L0',
        type: 'tool_use',
        agent: 'reviewer-1',
        tool: 'code_search',
      },
      'debug',
    )
    expect(line).toContain('code_search')
  })

  it('renders done events with a usage suffix (abbreviated tokens + cost) at normal verbosity', () => {
    const line = formatEvent(
      {
        altitude: 'L1',
        type: 'done',
        agent: 'reviewer-r1',
        usage: {
          inputTokens: 12000,
          outputTokens: 3400,
          reasoningTokens: 200,
          costUsd: 0.0142,
          wallMs: 45000,
        },
      },
      'normal',
    )
    expect(line).toBe('reviewer-r1 done \u00B7 in 12.0k out 3.4k \u00B7 $0.0142')
  })
})

describe('createRenderer (integration smoke)', () => {
  it('renders to a capturing stream without throwing', () => {
    const output: string[] = []
    const stream = {
      write(chunk: string): boolean {
        output.push(chunk)
        return true
      },
      isTTY: false,
    }
    const renderer = createRenderer(stream, 'normal')
    renderer.renderState(state)
    renderer.renderEvent({
      altitude: 'L2',
      type: 'convergence',
      round: 2,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 1 },
    })
    expect(output.join('')).toContain('review')
  })

  it('with { dynamic: false } renders byte-identical line output on a TTY stream (no ANSI escapes)', () => {
    const output: string[] = []
    const stream = {
      write(chunk: string): boolean {
        output.push(chunk)
        return true
      },
      isTTY: true,
      columns: 80,
    }
    const renderer = createRenderer(stream, 'normal', { dynamic: false })
    renderer.renderEvent({
      altitude: 'L1',
      type: 'done',
      agent: 'reviewer-r1',
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0, costUsd: 0, wallMs: 100 },
    })
    const joined = output.join('')
    expect(joined).not.toContain('\u001b[2K')
    expect(joined).not.toContain('\r')
    expect(joined).toContain('reviewer-r1 done')
  })

  it('renderEvent stays callable when detached from its instance (event-bus subscription pattern)', () => {
    const output: string[] = []
    const stream = {
      write(chunk: string): boolean {
        output.push(chunk)
        return true
      },
      isTTY: false,
    }
    const renderer = createRenderer(stream, 'normal')
    const detached = renderer.renderEvent
    expect(() => {
      detached({ altitude: 'L2', type: 'stage_enter', stage: 'intake' })
      detached({ altitude: 'L2', type: 'stage_exit', stage: 'intake' })
    }).not.toThrow()
    expect(output.join('')).toContain('intake')
  })
})

describe('createRenderer resolveCost threading', () => {
  const MODEL = 'zai-coding-plan/glm-5.2'
  const resolvePriced = (modelId: string): ResolvedCost | null =>
    modelId === MODEL ? { input: 1, output: 2, source: 'primary' } : null

  function ttyStream(): {
    output: string[]
    stream: { write(chunk: string): boolean; isTTY: boolean; columns: number }
  } {
    const output: string[] = []
    return {
      output,
      stream: {
        write(chunk: string): boolean {
          output.push(chunk)
          return true
        },
        isTTY: true,
        columns: 120,
      },
    }
  }

  it('forwards opts.resolveCost to DynamicRenderer (estimated footer visible on a TTY stream)', () => {
    const { output, stream } = ttyStream()
    const renderer = createRenderer(stream, 'normal', { resolveCost: resolvePriced })
    renderer.renderEvent({ altitude: 'L1', type: 'spawned', agent: 'resolver-r1', role: 'reviewer', model: MODEL })
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 1000, output: 500, reasoning: 100 },
      costUsd: 0,
    })
    expect(output.join('')).toContain('~$0.0021')
  })

  it('ignores opts.resolveCost for LineRenderer (byte-frozen output, no estimated cost)', () => {
    const { output, stream } = ttyStream()
    const renderer = createRenderer(stream, 'normal', { dynamic: false, resolveCost: resolvePriced })
    renderer.renderEvent({ altitude: 'L1', type: 'spawned', agent: 'resolver-r1', role: 'reviewer', model: MODEL })
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 1000, output: 500, reasoning: 100 },
      costUsd: 0,
    })
    renderer.renderEvent({
      altitude: 'L1',
      type: 'done',
      agent: 'resolver-r1',
      usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 100, costUsd: 0, wallMs: 1000 },
    })
    const joined = output.join('')
    expect(joined).not.toContain('~$')
    expect(joined).toContain('resolver-r1 done \u00B7 in 1.0k out 500 \u00B7 $0.0000')
  })
})
