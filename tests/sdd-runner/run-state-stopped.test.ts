// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ReplayState } from '../../sdd-runner/src/replay.js'
import { resolveResumeDecision } from '../../sdd-runner/src/resume-decision.js'
import { deriveResumePoint } from '../../sdd-runner/src/resume-point.js'
import { PersistedRunStateSchema } from '../../sdd-runner/src/run-state.js'

const emptyReplay: ReplayState = {
  stages: {
    intake: 'pending',
    draft: 'pending',
    review: 'pending',
    decompose: 'pending',
    atomicity: 'pending',
    gate: 'pending',
  },
  depth: null,
  round: null,
  perRound: [],
  lastVerdict: null,
  gate: null,
  autoDecisions: [],
  children: {},
}

function rawState(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    runId: 'run-1',
    repoRoot: '/repo',
    workDir: '/repo/.sdd-runner',
    changeName: 'add-thing',
    stage: 'review',
    depth: 'S',
    round: 2,
    gate: null,
    status: 'stopped',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function stateOf(overrides: Record<string, unknown>): ReturnType<typeof PersistedRunStateSchema.parse> {
  return PersistedRunStateSchema.parse(rawState(overrides))
}

describe('run status stopped (additive, lenient parsing)', () => {
  it('the state schema accepts status stopped alongside the previous statuses', () => {
    for (const status of ['running', 'completed', 'aborted', 'failed', 'stopped']) {
      expect(PersistedRunStateSchema.safeParse(rawState({ status })).success).toBe(true)
    }
    expect(PersistedRunStateSchema.safeParse(rawState({ status: 'paused' })).success).toBe(false)
  })

  it('parsing stays lenient: pre-change state files (missing new fields) still load', () => {
    const legacy = {
      runId: 'legacy-run',
      repoRoot: '/repo',
      workDir: '/repo/.sdd-runner',
      changeName: 'old-thing',
      stage: 'review',
      depth: 'S',
      round: 1,
      gate: null,
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const parsed = PersistedRunStateSchema.safeParse(legacy)
    expect(parsed.success).toBe(true)
  })

  it('a stopped run routes through the interrupted path: resume decides its stage like a running run', () => {
    const stopped = stateOf({ stage: 'review', round: 2, status: 'stopped' })
    const running = stateOf({ stage: 'review', round: 2, status: 'running' })
    const stoppedDecision = resolveResumeDecision(
      stopped,
      {
        proposal: 'done',
        specs: 'done',
        design: 'blocked',
        assumptions: 'blocked',
        review: 'blocked',
        tasks: 'blocked',
      },
      { ...emptyReplay, round: { current: 2, cap: 2 } },
      [],
    )
    const runningDecision = resolveResumeDecision(
      running,
      {
        proposal: 'done',
        specs: 'done',
        design: 'blocked',
        assumptions: 'blocked',
        review: 'blocked',
        tasks: 'blocked',
      },
      { ...emptyReplay, round: { current: 2, cap: 2 } },
      [],
    )
    expect(stoppedDecision).toEqual(runningDecision)
    expect(stoppedDecision.stage).toBe('review')
    expect(stoppedDecision.path).toBe('stage-rebuild')
  })

  it('deriveResumePoint treats a stopped review run exactly like a running one', () => {
    const artifacts = {
      proposal: 'done',
      specs: 'done',
      design: 'blocked',
      assumptions: 'blocked',
      review: 'blocked',
      tasks: 'blocked',
    }
    const replay = { ...emptyReplay, round: { current: 2, cap: 2 } }
    expect(deriveResumePoint(stateOf({ status: 'stopped' }), artifacts, replay)).toEqual(
      deriveResumePoint(stateOf({ status: 'running' }), artifacts, replay),
    )
  })
})
