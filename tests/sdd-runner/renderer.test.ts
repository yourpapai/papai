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
  autoDecisions: [],
  children: {},
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
          cachedReadTokens: 18_175_552,
          cachedWriteTokens: 5_005_056,
          costUsd: 0.0142,
          wallMs: 45000,
        },
      },
      'normal',
    )
    expect(line).toBe('reviewer-r1 done \u00B7 in 12.0k \u00B7 cached 18.18M out 3.4k \u00B7 $0.0142')
  })

  it('done line omits the cached segment when cached counters are zero', () => {
    const line = formatEvent(
      {
        altitude: 'L1',
        type: 'done',
        agent: 'reviewer-r1',
        usage: {
          inputTokens: 12000,
          outputTokens: 3400,
          reasoningTokens: 200,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.0142,
          wallMs: 45000,
        },
      },
      'normal',
    )
    expect(line).toBe('reviewer-r1 done \u00B7 in 12.0k out 3.4k \u00B7 $0.0142')
  })

  it('done line appends · <model> when the done event carries a model id', () => {
    const line = formatEvent(
      {
        altitude: 'L1',
        type: 'done',
        agent: 'reviewer-r1',
        model: 'test-model',
        usage: {
          inputTokens: 12000,
          outputTokens: 3400,
          reasoningTokens: 200,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.0142,
          wallMs: 45000,
        },
      },
      'normal',
    )
    expect(line).toBe('reviewer-r1 done \u00B7 test-model \u00B7 in 12.0k out 3.4k \u00B7 $0.0142')
  })

  it('done line without a model id renders exactly as before (no placeholder)', () => {
    const noModel = formatEvent(
      {
        altitude: 'L1',
        type: 'done',
        agent: 'drafter-1',
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.001,
          wallMs: 1000,
        },
      },
      'normal',
    )
    expect(noModel).toBe('drafter-1 done \u00B7 in 100 out 10 \u00B7 $0.0010')
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

  it('a TTY stream gets the byte-frozen line renderer (DynamicRenderer deleted)', () => {
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
    expect(output.join('')).toContain('resolver-r1 spawned')
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

describe('formatTokenCount tiers (13.x)', () => {
  it('pins the three tiers and their boundaries', async () => {
    const { formatTokenCount } = await import('../../sdd-runner/src/renderer.js')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(999_999)).toBe('1000.0k')
    expect(formatTokenCount(1_000_000)).toBe('1.00M')
    expect(formatTokenCount(2_500_000)).toBe('2.50M')
  })
})

describe('formatElapsed tiers', () => {
  it('formats seconds, zero-floors negatives, and minutes beyond a minute', async () => {
    const { formatElapsed } = await import('../../sdd-runner/src/renderer.js')
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(59_999)).toBe('59s')
    expect(formatElapsed(60_000)).toBe('1m00s')
    expect(formatElapsed(125_000)).toBe('2m05s')
    expect(formatElapsed(-5_000)).toBe('0s')
  })
})

describe('renderPipelineMap suffixes', () => {
  it('active stage carries round part and optional elapsed; done stage carries time and cost', async () => {
    const { renderPipelineMap: rpm } = await import('../../sdd-runner/src/renderer.js')
    const lines = rpm(state, { activeElapsedMs: 90_000 })
    expect(lines[2]).toBe('▶ review active (round 2/3) elapsed 1m30s')
    const stageTimes = new Map([['intake', { wallMs: 250_000, costUsd: 0.5 }]])
    const withTimes = rpm(state, { stageTimes })
    expect(withTimes[0]).toBe('✓ intake done · 4m10s · $0.5000')
  })

  it('an active stage without round or elapsed renders bare, and done stages without times stay bare', async () => {
    const { renderPipelineMap: rpm } = await import('../../sdd-runner/src/renderer.js')
    const noRound: ReplayState = { ...state, round: null }
    expect(rpm(noRound)[2]).toBe('▶ review active')
    expect(rpm(state)[0]).toBe('✓ intake done')
  })
})

describe('formatEvent verbosity gating', () => {
  it('quiet hides everything; normal shows L1/L2 but not L0; debug shows L0', async () => {
    const { formatEvent: fmt } = await import('../../sdd-runner/src/renderer.js')
    const l2 = { altitude: 'L2', type: 'stage_enter', stage: 'draft' } as const
    const l1 = { altitude: 'L1', type: 'spawned', agent: 'a', role: 'reviewer', model: 'm' } as const
    const l0 = { altitude: 'L0', type: 'tool_use', agent: 'a', tool: 't' } as const
    expect(fmt(l2, 'quiet')).toBeNull()
    expect(fmt(l2, 'brief')).toBe('[draft] entered')
    expect(fmt(l1, 'normal')).toBe('a spawned (reviewer, m)')
    expect(fmt(l1, 'brief')).toBeNull()
    expect(fmt(l0, 'debug')).toBe('a: t')
    expect(fmt(l0, 'normal')).toBeNull()
  })

  it('renders each event line shape exactly', async () => {
    const { formatEvent: fmt } = await import('../../sdd-runner/src/renderer.js')
    expect(fmt({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, 'normal')).toBe('round 1/3 opened')
    expect(fmt({ altitude: 'L2', type: 'round_close', round: 1, cap: 3 }, 'normal')).toBe('round 1/3 closed')
    expect(fmt({ altitude: 'L2', type: 'stage_exit', stage: 'draft' }, 'normal')).toBe('[draft] done')
    expect(fmt({ altitude: 'L2', type: 'depth', profile: 'M', rationale: 'why', source: 'override' }, 'normal')).toBe(
      'depth classified: M (override)',
    )
    expect(fmt({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 2 }, 'normal')).toBe(
      'gate presented (final, v2)',
    )
    expect(
      fmt({ altitude: 'L2', type: 'finding', id: 'F1', action: 'filed', class: 'MATERIAL', round: 1 }, 'normal'),
    ).toBe('finding F1 filed (MATERIAL) round 1')
    expect(fmt({ altitude: 'L2', type: 'finding', id: 'F1', action: 'filed', round: 1 }, 'normal')).toBe(
      'finding F1 filed (?) round 1',
    )
    expect(fmt({ altitude: 'L2', type: 'assumption', id: 'A1', action: 'confirmed' }, 'normal')).toBe(
      'assumption A1 confirmed',
    )
    expect(
      fmt({ altitude: 'L2', type: 'artifact', action: 'materialized', path: 'openspec/changes/x/review.md' }, 'normal'),
    ).toBe('materialized openspec/changes/x/review.md')
    expect(fmt({ altitude: 'L2', type: 'human_edits', action: 'detected', files: ['a.md', 'b.md'] }, 'normal')).toBe(
      'hand edits detected: a.md, b.md',
    )
    expect(
      fmt(
        {
          altitude: 'L0',
          type: 'step_finish',
          agent: 'rev',
          tokens: { input: 1, output: 42, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0,
        },
        'debug',
      ),
    ).toBe('rev step done (42 out)')
    expect(fmt({ altitude: 'L1', type: 'retrying', agent: 'rev', reason: 'stall', attempt: 2 }, 'debug')).toBe(
      'rev retrying (stall, attempt 2)',
    )
    expect(fmt({ altitude: 'L1', type: 'killed', agent: 'rev', cause: 'timeout' }, 'debug')).toBe(
      'rev killed (timeout)',
    )
  })

  it('formatTrajectoryBlock pins heading and lines', async () => {
    const { formatTrajectoryBlock: ftb, formatBurndownLine: fbl } = await import('../../sdd-runner/src/renderer.js')
    const record = {
      round: 2,
      counts: { blocker: 1, material: 2, nitpick: 3 },
      resolved: 4,
      dismissed: 5,
      verdict: 'open',
    } as const
    expect(fbl(record)).toBe('round 2: 1b 2m 3n · 4 resolved · 5 dismissed · open')
    expect(ftb([record])).toBe(
      ['### Cap-hit trajectory', 'round 2: 1b 2m 3n · 4 resolved · 5 dismissed · open'].join('\n'),
    )
  })
})
