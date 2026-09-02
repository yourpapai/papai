// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { readEvents, STAGE_ORDER } from '../../../../afk-runner/src/events.js'
import type { StageId } from '../../../../afk-runner/src/events.js'
import { replayEvents } from '../../../../afk-runner/src/legacy-fold.js'

const REAL_ROOT = import.meta.dir

interface ExpectedGate {
  readonly mode: 'early' | 'final' | 'plan'
  readonly version: number
  readonly answered: boolean
}

interface ExpectedRun {
  readonly events: number
  readonly depth: 'S' | 'M' | 'L' | null
  readonly activeStages: StageId[]
  readonly gate: ExpectedGate | null
}

const INVENTORY: Readonly<Record<string, ExpectedRun>> = {
  '2026-08-19T11-58-01-530Z-6d279752': { events: 22, depth: null, activeStages: ['intake'], gate: null },
  '2026-08-19T12-04-49-341Z-7d97443e': {
    events: 2805,
    depth: 'L',
    activeStages: [],
    gate: { mode: 'final', version: 8, answered: false },
  },
  '2026-08-21T15-15-43-701Z-80409492': { events: 1, depth: null, activeStages: ['intake'], gate: null },
  '2026-08-21T15-16-08-514Z-039e8174': {
    events: 576,
    depth: 'M',
    activeStages: [],
    gate: { mode: 'final', version: 1, answered: false },
  },
  '2026-08-21T19-25-52-617Z-cdc4c06a': {
    events: 769,
    depth: 'M',
    activeStages: [],
    gate: { mode: 'early', version: 1, answered: true },
  },
  '2026-08-21T19-44-19-770Z-2f6e644a': {
    events: 886,
    depth: 'M',
    activeStages: [],
    gate: { mode: 'final', version: 6, answered: true },
  },
  'build-claude-code-cli-as-a-selectable-model-backend-in-opencode': {
    events: 1923,
    depth: 'L',
    activeStages: [],
    gate: { mode: 'final', version: 4, answered: true },
  },
  'opencode-agent-fix-command': {
    events: 1269,
    depth: 'M',
    activeStages: [],
    gate: { mode: 'final', version: 4, answered: true },
  },
  'sdd-runner-decomposition-2nd': { events: 35, depth: null, activeStages: ['intake'], gate: null },
  'tests-consolidation': {
    events: 1182,
    depth: 'M',
    activeStages: [],
    gate: { mode: 'final', version: 6, answered: true },
  },
}

function fixtureRunDirs(): string[] {
  return readdirSync(REAL_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function allStagesDone(runId: string): boolean {
  const stages = replayEvents(path.join(REAL_ROOT, runId, 'events.ndjson')).stages
  return Object.values(stages).every((status) => status === 'done')
}

function idsWhere(predicate: (expected: ExpectedRun, runId: string) => boolean): string[] {
  return Object.entries(INVENTORY)
    .filter(([runId, expected]) => predicate(expected, runId))
    .map(([runId]) => runId)
}

const COMPLETED_RUNS = idsWhere((expected, runId) => expected.gate?.answered === true && allStagesDone(runId))
const GATE_PENDING_RUNS = idsWhere((expected, runId) => expected.gate?.answered === false && allStagesDone(runId))
const MID_REVIEW_ABORT_RUNS = idsWhere((_expected, runId) => runId === '2026-08-21T19-25-52-617Z-cdc4c06a')
const STUB_RUNS = idsWhere((expected) => expected.activeStages.includes('intake'))

describe('real-run corpus inventory', () => {
  it('holds exactly the ten recorded unique runs', () => {
    expect(fixtureRunDirs()).toEqual(Object.keys(INVENTORY).sort())
  })

  for (const [runId, expected] of Object.entries(INVENTORY).sort(([a], [b]) => a.localeCompare(b))) {
    it(`${runId}: parses and folds under legacy-fold to the recorded shape`, () => {
      const logPath = path.join(REAL_ROOT, runId, 'events.ndjson')
      expect(readEvents(logPath)).toHaveLength(expected.events)
      const state = replayEvents(logPath)
      expect(state.depth).toBe(expected.depth)
      expect(STAGE_ORDER.filter((id) => state.stages[id] === 'active')).toEqual(expected.activeStages)
      expect(state.gate).toEqual(expected.gate)
    })
  }

  it('classifies into the recorded shape counts: 4 completed, 2 gate-pending live, 1 mid-review abort, 3 stubs', () => {
    expect(COMPLETED_RUNS).toHaveLength(4)
    expect(GATE_PENDING_RUNS).toHaveLength(2)
    expect(MID_REVIEW_ABORT_RUNS).toHaveLength(1)
    expect(STUB_RUNS).toHaveLength(3)
    const depths = COMPLETED_RUNS.map((runId) => INVENTORY[runId]?.depth)
    expect(depths.filter((d) => d === 'M')).toHaveLength(3)
    expect(depths.filter((d) => d === 'L')).toHaveLength(1)
  })
})
