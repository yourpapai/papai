// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { EventInput } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { buildBus } from '../../sdd-runner/src/gate-digest.js'
import type { OpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRenderer } from '../../sdd-runner/src/renderer.js'
import type { ReplayState } from '../../sdd-runner/src/replay.js'

function event(seq: number): EventInput {
  return stampEvent({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, seq, '2026-01-01T00:00:00.000Z')
}

function stubDriver(): OpenSpecDriver {
  return {
    newChange: () => Promise.resolve({ changeName: 'add-thing' }),
    status: () =>
      Promise.resolve({
        schemaName: 'auto-sdd',
        artifacts: {},
        isPlanningComplete: true,
      }),
    instructions: () =>
      Promise.resolve({
        instruction: '',
        template: undefined,
        rules: [],
        resolvedOutputPath: '',
        existingOutputPaths: [],
        dependencies: [],
      }),
    validateStrict: () => Promise.resolve({ ok: true, output: '' }),
  }
}

function depsWith(render?: (e: EventInput) => void, liveEvents?: (e: EventInput) => void): OrchestratorDeps {
  return {
    config: { repoRoot: '/repo', workDir: '/work', model: 'm', budget: 1 },
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: stubDriver(),
    ...(render === undefined ? {} : { render }),
    ...(liveEvents === undefined ? {} : { liveEvents }),
  }
}

describe('buildBus render exclusivity', () => {
  it('prefers the live view sink over the line renderer when both are present', () => {
    const rendered: EventInput[] = []
    const live: EventInput[] = []
    const emit = buildBus(
      depsWith(
        (e) => void rendered.push(e),
        (e) => void live.push(e),
      ),
      '/tmp/x.ndjson',
    )
    const e = event(1)
    emit(e)
    expect(live).toEqual([e])
    expect(rendered).toEqual([])
  })

  it('still feeds the line renderer when no live view sink exists', () => {
    const rendered: EventInput[] = []
    const emit = buildBus(
      depsWith((e) => void rendered.push(e)),
      '/tmp/x.ndjson',
    )
    const e = event(1)
    emit(e)
    expect(rendered).toEqual([e])
  })
})

describe('non-TTY byte freeze (8.3)', () => {
  const FROZEN_STATE: ReplayState = {
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
    lastVerdict: null,
    gate: null,
    autoDecisions: [],
    children: {},
  }

  const EVENTS: readonly EventInput[] = [
    stampEvent({ altitude: 'L2', type: 'round_open', round: 2, cap: 3 }, 1, '2026-01-01T00:00:00.000Z'),
    stampEvent(
      { altitude: 'L1', type: 'spawned', agent: 'reviewer-r2', role: 'reviewer', model: 'glm' },
      2,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent(
      { altitude: 'L0', type: 'tool_use', agent: 'reviewer-r2', tool: 'search', arg: 'scope' },
      3,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent(
      { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'MATERIAL' },
      4,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent(
      { altitude: 'L1', type: 'retrying', agent: 'reviewer-r2', reason: 'stall', attempt: 2 },
      5,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent(
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 2, nitpick: 0 },
      },
      6,
      '2026-01-01T00:00:00.000Z',
    ),
    stampEvent(
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 },
      7,
      '2026-01-01T00:00:00.000Z',
    ),
  ]

  function nonTtyBytes(dynamic: boolean): string {
    const output: string[] = []
    const renderer = createRenderer(
      {
        write(chunk: string): boolean {
          output.push(chunk)
          return true
        },
        isTTY: false,
      },
      'normal',
      { dynamic },
    )
    renderer.renderState(FROZEN_STATE)
    for (const frozenEvent of EVENTS) renderer.renderEvent(frozenEvent)
    return output.join('')
  }

  it('no presentation-layer (or any) ANSI escape reaches a non-TTY stream', () => {
    expect(nonTtyBytes(false)).not.toContain('\u001b')
    expect(nonTtyBytes(true)).not.toContain('\u001b')
  })

  it('the byte stream matches the frozen contract exactly', () => {
    expect(nonTtyBytes(false)).toBe(
      [
        '✓ intake done',
        '✓ draft done',
        '▶ review active (round 2/3)',
        '· decompose pending',
        '· atomicity pending',
        '· gate pending',
        'round 2/3 opened',
        'reviewer-r2 spawned (reviewer, glm)',
        'finding F1 filed (MATERIAL) round 1',
        'reviewer-r2 retrying (stall, attempt 2)',
        'gate presented (early, v1)',
        '',
      ].join('\n'),
    )
  })
})
