// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { toKernelEvent, foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import { initialStep, step } from '../../../afk-runner/src/kernel/machine.js'
import { createReplayFolder, replayEvents } from '../../../afk-runner/src/legacy-fold.js'

const REAL_ROOT = path.join(import.meta.dir, '..', 'fixtures', 'real')
const SCENARIOS_ROOT = path.join(import.meta.dir, '..', 'fixtures', 'scenarios')

interface Fixture {
  readonly name: string
  readonly logPath: string
  readonly finalValue: string
}

function collectFixtures(): readonly Fixture[] {
  const real = readdirSync(REAL_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: `real/${entry.name}`,
      logPath: path.join(REAL_ROOT, entry.name, 'events.ndjson'),
      finalValue: FINAL_VALUES[entry.name] ?? 'UNRECORDED',
    }))
  const scenarios = readdirSync(SCENARIOS_ROOT)
    .filter((file) => file.endsWith('.ndjson'))
    .map((file) => ({
      name: `scenarios/${file}`,
      logPath: path.join(SCENARIOS_ROOT, file),
      finalValue: FINAL_VALUES[file] ?? 'UNRECORDED',
    }))
  return [...real, ...scenarios].sort((a, b) => a.name.localeCompare(b.name))
}

const FINAL_VALUES: Readonly<Record<string, string>> = {
  '2026-08-19T11-58-01-530Z-6d279752': 'intake',
  '2026-08-19T12-04-49-341Z-7d97443e': 'gate',
  '2026-08-21T15-15-43-701Z-80409492': 'intake',
  '2026-08-21T15-16-08-514Z-039e8174': 'gate',
  '2026-08-21T19-25-52-617Z-cdc4c06a': 'review',
  '2026-08-21T19-44-19-770Z-2f6e644a': 'completed',
  'build-claude-code-cli-as-a-selectable-model-backend-in-opencode': 'completed',
  'opencode-agent-fix-command': 'completed',
  'sdd-runner-decomposition-2nd': 'intake',
  'tests-consolidation': 'completed',
  'children-plan-synthetic.ndjson': 'start',
  'resume-artifact-skip-gate.ndjson': 'review',
  's-depth-calm-stop-resume.ndjson': 'review',
  'steer-extend-round.ndjson': 'review',
}

function firstDivergentIndex(events: readonly SddEvent[]): { index: number; seq: number } | null {
  const legacy = createReplayFolder()
  let kernel = initialStep(pipelineMachine)[0]
  for (const [index, event] of events.entries()) {
    legacy.fold(event)
    const kernelEvent = toKernelEvent(event)
    if (kernelEvent !== null) kernel = step(pipelineMachine, kernel, kernelEvent)[0]
    if (JSON.stringify(kernel.context.stages) !== JSON.stringify(legacy.state.stages)) {
      return { index, seq: event.seq }
    }
  }
  return null
}

describe('golden-replay parity: graph v0 vs legacy fold', () => {
  for (const fixture of collectFixtures()) {
    it(`${fixture.name}: kernel stage map equals legacy fold`, () => {
      const events = readEvents(fixture.logPath)
      const kernel = foldEvents(pipelineMachine, events)
      const legacy = replayEvents(fixture.logPath)
      expect({
        finalValue: kernel.snapshot.value,
        stagesEqual: JSON.stringify(kernel.snapshot.context.stages) === JSON.stringify(legacy.stages),
        firstDivergence: firstDivergentIndex(events),
      }).toEqual({ finalValue: fixture.finalValue, stagesEqual: true, firstDivergence: null })
    })
  }

  it('holds all fourteen fixtures from the C1 corpus', () => {
    expect(collectFixtures()).toHaveLength(14)
  })
})
