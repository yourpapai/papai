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
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { initialStep, step } from '../../../afk-runner/src/kernel/machine.js'
import { createReplayFolder, replayEvents } from '../../../afk-runner/src/legacy-fold.js'
import type { ReplayState } from '../../../afk-runner/src/legacy-fold.js'

const REAL_ROOT = path.join(import.meta.dir, '..', 'fixtures', 'real')
const SCENARIOS_ROOT = path.join(import.meta.dir, '..', 'fixtures', 'scenarios')

interface Fixture {
  readonly name: string
  readonly logPath: string
  readonly finalValue: string | Record<string, string>
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

/** Since C4 the gate state is compound: runs parked at a presented gate end in its `awaiting` child. */
const AWAITING: Record<string, string> = { gate: 'awaiting' }

const FINAL_VALUES: Readonly<Record<string, string | Record<string, string>>> = {
  '2026-08-19T11-58-01-530Z-6d279752': 'intake',
  '2026-08-19T12-04-49-341Z-7d97443e': AWAITING,
  '2026-08-21T15-15-43-701Z-80409492': 'intake',
  '2026-08-21T15-16-08-514Z-039e8174': AWAITING,
  '2026-08-21T19-25-52-617Z-cdc4c06a': AWAITING,
  '2026-08-21T19-44-19-770Z-2f6e644a': 'completed',
  'build-claude-code-cli-as-a-selectable-model-backend-in-opencode': 'completed',
  'opencode-agent-fix-command': 'completed',
  'sdd-runner-decomposition-2nd': 'intake',
  'tests-consolidation': 'completed',
  'abort-at-final-synthetic.ndjson': 'aborted',
  'children-plan-synthetic.ndjson': 'start',
  'escalation-abort-synthetic.ndjson': 'aborted',
  'escalation-approve-cycle-synthetic.ndjson': 'completed',
  'escalation-extend-cycle-synthetic.ndjson': 'completed',
  'extend-at-final-cycle-synthetic.ndjson': 'completed',
  'precondition-escalation-synthetic.ndjson': 'completed',
  'resume-artifact-skip-gate.ndjson': AWAITING,
  's-depth-calm-stop-resume.ndjson': 'review',
  's-final-tail-synthetic.ndjson': AWAITING,
  'steer-extend-round.ndjson': 'review',
  'tail-crash-resume-healed-synthetic.ndjson': AWAITING,
  'tail-crash-resume-synthetic.ndjson': AWAITING,
  'under-budget-retry-synthetic.ndjson': 'completed',
  'veto-at-final-cycle-synthetic.ndjson': 'completed',
  'veto-revision-synthetic.ndjson': 'draft',
}

const REPLAY_FIELDS = [
  'stages',
  'depth',
  'round',
  'perRound',
  'lastVerdict',
  'gate',
  'autoDecisions',
  'children',
] as const satisfies readonly (keyof ReplayState)[]

/** Project machine context onto the legacy ReplayState fields; the scratch tally is deliberately excluded (residue is not a parity field). */
function projectedFields(context: KernelContext): Record<(typeof REPLAY_FIELDS)[number], unknown> {
  return {
    stages: context.stages,
    depth: context.depth,
    round: context.round,
    perRound: context.perRound,
    lastVerdict: context.lastVerdict,
    gate: context.gate,
    autoDecisions: context.autoDecisions,
    children: context.children,
  }
}

/** Key-order-insensitive deep serialization: object key order never distinguishes states, array order always does. */
function stable(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function divergentField(kernel: KernelContext, legacy: ReplayState): string | null {
  const projected = projectedFields(kernel)
  for (const field of REPLAY_FIELDS) {
    if (stable(projected[field]) !== stable(legacy[field])) return field
  }
  return null
}

function firstDivergentIndex(events: readonly SddEvent[]): { index: number; seq: number; field: string } | null {
  const legacy = createReplayFolder()
  let kernel = initialStep(pipelineMachine)[0]
  for (const [index, event] of events.entries()) {
    legacy.fold(event)
    const kernelEvent = toKernelEvent(event)
    if (kernelEvent !== null) kernel = step(pipelineMachine, kernel, kernelEvent)[0]
    const field = divergentField(kernel.context, legacy.state)
    if (field !== null) return { index, seq: event.seq, field }
  }
  return null
}

describe('golden-replay parity: graph v0 vs legacy fold', () => {
  for (const fixture of collectFixtures()) {
    it(`${fixture.name}: kernel full derived state equals legacy fold`, () => {
      const events = readEvents(fixture.logPath)
      const kernel = foldEvents(pipelineMachine, events)
      const legacy = replayEvents(fixture.logPath)
      expect({
        finalValue: kernel.snapshot.value,
        stateEqual: divergentField(kernel.snapshot.context, legacy) === null,
        firstDivergence: firstDivergentIndex(events),
      }).toEqual({ finalValue: fixture.finalValue, stateEqual: true, firstDivergence: null })
    })
  }

  it('holds all twenty-six fixtures from the C1+C4+C5+C6 corpus', () => {
    expect(collectFixtures()).toHaveLength(26)
  })
})
