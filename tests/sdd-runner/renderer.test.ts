// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ReplayState } from '../../sdd-runner/src/events.js'
import {
  createRenderer,
  formatEvent,
  renderBurndown,
  renderGateScreen,
  renderPipelineMap,
} from '../../sdd-runner/src/renderer.js'

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
  lastVerdict: { round: 1, verdict: 'open', counts: { blocker: 1, material: 0, nitpick: 0 } },
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

describe('renderBurndown', () => {
  it('formats a compact one-line burndown for a round close', () => {
    const line = renderBurndown(
      { round: 2, verdict: 'converged', counts: { blocker: 0, material: 0, nitpick: 1 } },
      3,
      2,
    )
    expect(line).toContain('round 2')
    expect(line).toContain('0b')
    expect(line).toContain('0m')
    expect(line).toContain('1n')
    expect(line).toContain('converged')
  })
})

describe('formatEvent', () => {
  it('formats an L2 convergence event as a semantic one-liner', () => {
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
    expect(line).toContain('converged')
    expect(line).toContain('round 2')
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
})

describe('renderGateScreen', () => {
  it('renders a gate digest with assumptions and the resume command', () => {
    const screen = renderGateScreen({
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'guests read-only', blast_radius: 'group replies' }],
    })
    expect(screen).toContain('gate resume run-1')
    expect(screen).toContain('A1')
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
})
