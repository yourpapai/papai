// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { flattenPosition } from '../../afk-runner/src/drive/loop.js'
import type { ParkedReason } from '../../afk-runner/src/drive/loop.js'
import { readEvents } from '../../afk-runner/src/events.js'
import type { DepthProfile, SddEvent, StageId } from '../../afk-runner/src/events.js'
import { pipelineMachine } from '../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../afk-runner/src/kernel/fold.js'
import { memoFieldsOf } from '../../afk-runner/src/run.js'

const REAL_ROOT = path.join(import.meta.dir, 'fixtures', 'real')

/** Legacy stamps createdAt at run start (ms-skew) and updatedAt at its save clock — completed runs save ms past the last event, stragglers minutes later. */
const CREATED_AT_TOLERANCE_MS = 2_000
const UPDATED_AT_TOLERANCE_MS = 300_000

interface PersistedMemo {
  readonly stage: StageId
  readonly depth: DepthProfile | null
  readonly round: number
  readonly roundCap?: number
  readonly gate: { readonly mode: 'early' | 'final' | 'plan'; readonly version: number } | null
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly autoExtendsUsed?: number
  readonly gateDeadlineAt?: string | null
  readonly gateDeadlineReArmed?: boolean
  readonly plan?: { readonly childCount: number; readonly digest: string } | null
}

function fixturesWithState(): { readonly name: string; readonly logPath: string; readonly statePath: string }[] {
  return readdirSync(REAL_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      logPath: path.join(REAL_ROOT, entry.name, 'events.ndjson'),
      statePath: path.join(REAL_ROOT, entry.name, 'state.json'),
    }))
    .filter((fixture) => existsSync(fixture.statePath))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function withinTolerance(a: string, b: string, toleranceMs: number): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= toleranceMs
}

/** The park a fold implies: done snapshots are final; anything else still awaits an answer. */
function haltedOf(status: string): ParkedReason {
  return status === 'done' ? 'final' : 'gate-pending'
}

/** Match one derived memo against its persisted original on every fold-derivable field. */
function assertMemoParity(derived: ReturnType<typeof memoFieldsOf>, persisted: PersistedMemo, foldDone: boolean): void {
  expect(derived.stage).toBe(persisted.stage)
  expect(derived.depth).toBe(persisted.depth)
  expect(derived.round).toBe(persisted.round)
  expect(derived.autoExtendsUsed).toBe(persisted.autoExtendsUsed ?? 0)
  expect(derived.gateDeadlineReArmed).toBe(persisted.gateDeadlineReArmed ?? false)
  if (derived.gateDeadlineAt !== null) {
    expect(derived.gateDeadlineAt).toBe(persisted.gateDeadlineAt ?? 'never')
  }
  if (persisted.plan !== undefined) expect(derived.plan).toEqual(persisted.plan)
  expect(withinTolerance(derived.createdAt, persisted.createdAt, CREATED_AT_TOLERANCE_MS)).toBe(true)
  expect(withinTolerance(derived.updatedAt, persisted.updatedAt, UPDATED_AT_TOLERANCE_MS)).toBe(true)

  // Terminal rules apply when the FOLD is terminal: legacy nulls the gate
  // record at its imperative finalize (completed and aborted runs alike). A
  // persisted terminal status over a non-terminal fold is a legacy
  // imperative abort (cdc4c06a at review, the aborted intake run) — its
  // gate/status are C6's failure vocabulary, not fold facts.
  const legacyImperativeTerminal = persisted.status !== 'running' && !foldDone
  if (!legacyImperativeTerminal) {
    expect(derived.gate).toEqual(persisted.gate)
  }
  if (foldDone) {
    expect(derived.status as string).toBe(persisted.status)
  }
}

describe('memo parity with the surviving originals (C5 D7 — parity complete)', () => {
  it('every surviving original has its state.json in the fixture dir', () => {
    expect(fixturesWithState().map((fixture) => fixture.name)).toEqual([
      '2026-08-19T11-58-01-530Z-6d279752',
      '2026-08-19T12-04-49-341Z-7d97443e',
      '2026-08-21T15-15-43-701Z-80409492',
      '2026-08-21T15-16-08-514Z-039e8174',
      '2026-08-21T19-25-52-617Z-cdc4c06a',
      '2026-08-21T19-44-19-770Z-2f6e644a',
      'build-claude-code-cli-as-a-selectable-model-backend-in-opencode',
      'opencode-agent-fix-command',
      'sdd-runner-decomposition-2nd',
      'tests-consolidation',
    ])
  })

  for (const fixture of fixturesWithState()) {
    it(`${fixture.name}: the derived memo matches the persisted state.json on every fold-derivable field`, () => {
      const events: readonly SddEvent[] = readEvents(fixture.logPath)
      const snapshot = foldEvents(pipelineMachine, events).snapshot
      const halted = haltedOf(snapshot.status)
      const derived = memoFieldsOf(events, snapshot.context, halted, flattenPosition(snapshot.value))
      const persisted: PersistedMemo = JSON.parse(readFileSync(fixture.statePath, 'utf8'))
      assertMemoParity(derived, persisted, snapshot.status === 'done')
    })
  }
})
