// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../../afk-runner/src/kernel/fold.js'
import { replayEvents } from '../../../../afk-runner/src/legacy-fold.js'

const SCENARIO_ROOT = import.meta.dir

function scenarioFiles(): string[] {
  return readdirSync(SCENARIO_ROOT)
    .filter((name) => name.endsWith('.ndjson'))
    .sort()
}

const logOf = (name: string): string => path.join(SCENARIO_ROOT, name)

type FixtureEvent = ReturnType<typeof readEvents>[number]

function stageEvents(
  events: readonly FixtureEvent[],
  action: 'stage_enter' | 'stage_exit',
  stage: string,
): FixtureEvent[] {
  return events.filter((event) => event.type === action && event.stage === stage)
}

describe('scenario corpus inventory', () => {
  it('holds exactly the six recorded scenario fixtures', () => {
    expect(scenarioFiles()).toEqual([
      'children-plan-synthetic.ndjson',
      'resume-artifact-skip-gate.ndjson',
      's-depth-calm-stop-resume.ndjson',
      's-final-tail-synthetic.ndjson',
      'steer-extend-round.ndjson',
      'veto-revision-synthetic.ndjson',
    ])
  })

  it('every scenario parses and folds under legacy-fold', () => {
    for (const name of scenarioFiles()) {
      expect(() => readEvents(logOf(name))).not.toThrow()
      expect(() => replayEvents(logOf(name))).not.toThrow()
    }
  })

  it('s-depth-calm-stop-resume covers the S profile, a mid-review boundary, and a session-continuation resume', () => {
    const state = replayEvents(logOf('s-depth-calm-stop-resume.ndjson'))
    expect(state.depth).toBe('S')
    expect(state.stages.review).toBe('active')
    expect(state.round).toEqual({ current: 1, cap: 3 })
    const events = readEvents(logOf('s-depth-calm-stop-resume.ndjson'))
    expect(events.at(-1)).toMatchObject({ type: 'resume', path: 'session-continuation', stage: 'review' })
  })

  it('resume-artifact-skip-gate covers the artifact-skip resume path the real hoard lacks', () => {
    const state = replayEvents(logOf('resume-artifact-skip-gate.ndjson'))
    expect(state.gate).toEqual({ mode: 'early', version: 1, answered: false })
    const events = readEvents(logOf('resume-artifact-skip-gate.ndjson'))
    expect(events.at(-1)).toMatchObject({ type: 'resume', path: 'artifact-skip', stage: 'gate' })
  })

  it('steer-extend-round covers extend consumption: cap hit, extend auto-decision, then a raised-cap round', () => {
    const state = replayEvents(logOf('steer-extend-round.ndjson'))
    expect(state.autoDecisions).toHaveLength(1)
    expect(state.autoDecisions[0]).toMatchObject({ rule: 'R2', decision: 'extend', gateVersion: 1 })
    expect(state.round).toEqual({ current: 2, cap: 3 })
    expect(state.lastVerdict).toMatchObject({ round: 2, verdict: 'converged' })
  })

  it('children-plan-synthetic folds the synthetic plan/children layer the runtime never produces', () => {
    const state = replayEvents(logOf('children-plan-synthetic.ndjson'))
    expect(state.children).toEqual({ gamma: { status: 'running' } })
  })

  it('veto-revision-synthetic locks the veto fold: answered outcome=veto, draft re-entry mover, no round opened', () => {
    const state = replayEvents(logOf('veto-revision-synthetic.ndjson'))
    expect(state.gate).toEqual({ mode: 'early', version: 1, answered: true })
    expect(state.stages.draft).toBe('active')
    expect(state.round).toEqual({ current: 1, cap: 1 })
    const kernel = foldEvents(pipelineMachine, readEvents(logOf('veto-revision-synthetic.ndjson'))).snapshot
    expect(kernel.value).toBe('draft')
    expect(kernel.context.gateOutcome).toBe('veto')
  })

  it('s-final-tail-synthetic covers the depth-S tail: decompose→gate entry, no atomicity bracket, exit-after-presented close', () => {
    const events = readEvents(logOf('s-final-tail-synthetic.ndjson'))
    expect(events).toHaveLength(16)
    expect(stageEvents(events, 'stage_enter', 'atomicity')).toHaveLength(0)
    expect(stageEvents(events, 'stage_exit', 'atomicity')).toHaveLength(0)
    expect(stageEvents(events, 'stage_enter', 'gate')[0]?.seq).toBe(13)
    const state = replayEvents(logOf('s-final-tail-synthetic.ndjson'))
    expect(state.depth).toBe('S')
    expect(state.stages.decompose).toBe('done')
    expect(state.stages.atomicity).toBe('pending')
    expect(state.stages.gate).toBe('active')
    expect(state.gate).toEqual({ mode: 'final', version: 1, answered: false })
  })
})
