// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { aggregate } from '../../../../afk-runner/src/accounting.js'
import type { RunAccountingInput } from '../../../../afk-runner/src/accounting.js'
import { buildCorpusReport } from '../../../../afk-runner/src/analyze-corpus.js'
import type { AnalyzeFs } from '../../../../afk-runner/src/analyze-io.js'
import { loadCorpus, nodeAnalyzeFs } from '../../../../afk-runner/src/analyze-io.js'
import { SddEventSchema } from '../../../../afk-runner/src/event-schemas.js'
import { readEvents } from '../../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../../afk-runner/src/kernel/fold.js'
import { memoFieldsOf } from '../../../../afk-runner/src/memo-project.js'
import { readLiteRecord } from '../../../../afk-runner/src/run-lite.js'
import { PersistedRunStateSchema } from '../../../../afk-runner/src/run-state.js'

const LIVE_ROOT = import.meta.dir

function liveLanes(): string[] {
  return readdirSync(LIVE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

type LiveEvent = ReturnType<typeof readEvents>[number]

const logPath = path.join(LIVE_ROOT, 'mutation-floor-hardening-live', 'events.ndjson')
const memoPath = path.join(LIVE_ROOT, 'mutation-floor-hardening-live', 'state.json')

/**
 * Read the lane dirs as a corpus the analyzer can discover: the lanes sit
 * directly under `live/`, while `loadCorpus` expects a `<workdir>/runs/<id>`
 * layout — the adapter re-maps the path prefix (a pure read view; the frozen
 * lane layout is never reshaped for the tool) and lets `readdir` list
 * directories only, so README.md and this test file are not pseudo-runs.
 */
function laneCorpusFs(): AnalyzeFs {
  const real = nodeAnalyzeFs()
  const runsRoot = `${LIVE_ROOT}/runs`
  const map = (p: string): string => (p.startsWith(runsRoot) ? path.join(LIVE_ROOT, path.relative(runsRoot, p)) : p)
  return {
    readFile: (p) => real.readFile(map(p)),
    stat: (p) => real.stat(map(p)),
    readdir: async (p) => {
      const mapped = map(p)
      const entries = await real.readdir(mapped)
      const dirs: string[] = []
      for (const entry of entries) {
        if ((await real.stat(path.join(mapped, entry))).isDirectory()) dirs.push(entry)
      }
      return dirs
    },
  }
}

function roundOpens(events: readonly LiveEvent[], round: number): SddEvent[] {
  return events.filter((event) => event.type === 'round_open' && event.round === round)
}

function gateAnswered(events: readonly LiveEvent[], outcome: string): SddEvent | undefined {
  return events.find((event) => event.type === 'gate' && event.action === 'answered' && event.outcome === outcome)
}

function stageFailed(events: readonly LiveEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'stage_failed')
}

/** Normalize a schema-optional persisted field to the derived memo's fallback shape. */
function memoField<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback
}

describe('live corpus lane marking', () => {
  it('holds exactly the recorded live lanes', () => {
    expect(liveLanes()).toEqual([
      'event-driven-suggestion-payloads-live',
      'killed-turn-usage-undercount-live',
      'mutation-floor-hardening-live',
    ])
  })
})

/**
 * The C8 harvest oracle (v2-live-proof tasks 5.1/5.2): every live lane — C7's
 * and both C8 runs — folds to the memo it persisted and validates line-by-line
 * against the event schemas, agent noise included. Red until the C8 lanes are
 * harvested (task 5.2 copies events.ndjson + state.json per productive run).
 */
describe('every live lane folds to its own memo and validates line-by-line', () => {
  for (const lane of [
    'event-driven-suggestion-payloads-live',
    'killed-turn-usage-undercount-live',
    'mutation-floor-hardening-live',
  ]) {
    it(`${lane}: schema-valid lines and fold ≡ memo`, () => {
      const laneLog = path.join(LIVE_ROOT, lane, 'events.ndjson')
      const raw = readFileSync(laneLog, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
      expect(raw.length).toBeGreaterThan(0)
      for (const line of raw) {
        expect(() => SddEventSchema.parse(JSON.parse(line))).not.toThrow()
      }
      const events = readEvents(laneLog)
      const { snapshot } = foldEvents(pipelineMachine, events)
      const derived = memoFieldsOf(events, snapshot.context, 'final', 'completed')
      const persisted = PersistedRunStateSchema.parse(
        JSON.parse(readFileSync(path.join(LIVE_ROOT, lane, 'state.json'), 'utf8')),
      )
      expect(derived.stage).toBe(persisted.stage)
      expect(derived.depth).toBe(persisted.depth)
      expect(derived.round).toBe(persisted.round)
      expect(derived.roundCap).toBe(memoField(persisted.roundCap, derived.roundCap))
      expect(derived.gate).toBe(persisted.gate)
      expect(derived.status).toBe(persisted.status)
      expect(derived.autoExtendsUsed).toBe(memoField(persisted.autoExtendsUsed, 0))
      expect(derived.gateDeadlineAt).toBe(memoField(persisted.gateDeadlineAt, null))
      expect(derived.gateDeadlineReArmed).toBe(memoField(persisted.gateDeadlineReArmed, false))
      expect(derived.plan).toBe(memoField(persisted.plan, null))
      expect(derived.children).toBe(memoField(persisted.children, null))
      expect(derived.createdAt).toBe(persisted.createdAt)
      expect(derived.updatedAt).toBe(persisted.updatedAt)
    })
  }
})

/**
 * Era reading (v2-live-proof task 5.1, design D8 — corrected by measurement):
 * the era-contamination flag keys on consistency signatures
 * (answered-without-presented, completed-after-unsuperseded-abort), not on
 * event-grammar dates. C7's lane is afk-authored with a clean
 * presented/answered pairing, so it reads era-current alongside C8's — a
 * pre-wave grammar alone (no open sets, no fingerprints) contaminates nothing.
 * The development-era exclusion the flag implements is demonstrated over the
 * legacy corpus in the analyzer's own suite; here the assertion is that every
 * live lane is signature-clean and aggregates include them all.
 */
describe('the analyzer reads the grown lanes era-correctly', () => {
  it('every lane is era-current and included in the aggregates', async () => {
    const bundles = await loadCorpus(laneCorpusFs(), [LIVE_ROOT])
    const report = buildCorpusReport(bundles, [], { now: new Date('2026-09-01T00:00:00.000Z') })
    const byId = new Map(report.runs.map((run) => [run.runId, run]))
    for (const lane of liveLanes()) {
      expect(byId.get(lane)?.eraContaminated).toBe(false)
    }
    expect(report.aggregates.eraContaminated).toEqual([])
    expect(report.aggregates.runsAggregated).toBe(liveLanes().length)
  })
})

const VALID_ROW_STATUS = /^(completed|aborted|failed|stopped|running|gate:(early|final|plan|escalation) v\d+)$/u

/** Roster row + folded log per lane — what `summarizeWorkDir` would feed aggregate() over these runs. */
function laneAccountingInputs(): readonly RunAccountingInput[] {
  return liveLanes().map((lane) => {
    const record = readLiteRecord(readFileSync(path.join(LIVE_ROOT, lane, 'state.json'), 'utf8'))
    if (record === null) throw new Error(`unreadable lane memo: ${lane}`)
    return { runId: lane, ...record, events: readEvents(path.join(LIVE_ROOT, lane, 'events.ndjson')) }
  })
}

/**
 * The footer stays honest as C8's second live cycle adds lanes (U9 report
 * half): run count, tokens-first spend, the wholly-unpriced corpus shape,
 * dwell, and valid row statuses — asserted over every lane, whatever the
 * corpus grows to.
 */
describe('aggregate over all live lanes', () => {
  it('keeps run count, spend, unpriced count, dwell, and row statuses honest', () => {
    const lanes = liveLanes()
    const { rows, totals } = aggregate(laneAccountingInputs())
    expect(totals.runs).toBe(lanes.length)
    expect(rows).toHaveLength(lanes.length)
    expect(totals.tokens).toBeGreaterThan(0)
    expect(totals.unpricedCount).toBe(lanes.length)
    expect(totals.dwellMs).toBeGreaterThanOrEqual(0)
    for (const row of rows) expect(row.status).toMatch(VALID_ROW_STATUS)
  })
})

describe('mutation-floor-hardening-live — the first log the graph authored live', () => {
  it('every line validates against the event schemas, agent noise included', () => {
    const raw = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
    expect(raw.length).toBe(776)
    for (const line of raw) {
      expect(() => SddEventSchema.parse(JSON.parse(line))).not.toThrow()
    }
  })

  it('folding the harvested log reproduces the memo the run persisted', () => {
    const events = readEvents(logPath)
    const { snapshot } = foldEvents(pipelineMachine, events)
    const derived = memoFieldsOf(events, snapshot.context, 'final', 'completed')
    const persisted = PersistedRunStateSchema.parse(JSON.parse(readFileSync(memoPath, 'utf8')))
    expect(derived.stage).toBe(persisted.stage)
    expect(derived.depth).toBe(persisted.depth)
    expect(derived.round).toBe(persisted.round)
    expect(derived.roundCap).toBe(memoField(persisted.roundCap, derived.roundCap))
    expect(derived.gate).toBe(persisted.gate)
    expect(derived.status).toBe(persisted.status)
    expect(derived.autoExtendsUsed).toBe(memoField(persisted.autoExtendsUsed, 0))
    expect(derived.gateDeadlineAt).toBe(memoField(persisted.gateDeadlineAt, null))
    expect(derived.gateDeadlineReArmed).toBe(memoField(persisted.gateDeadlineReArmed, false))
    expect(derived.plan).toBe(memoField(persisted.plan, null))
    expect(derived.children).toBe(memoField(persisted.children, null))
    expect(derived.createdAt).toBe(persisted.createdAt)
    expect(derived.updatedAt).toBe(persisted.updatedAt)
  })

  it('carries the live-incident shapes: kill-drill same-round re-entry and the extend-at-final cycle', () => {
    const events = readEvents(logPath)
    expect(roundOpens(events, 1)).toHaveLength(2)
    expect(roundOpens(events, 4)[0]).toMatchObject({ cap: 4 })
    expect(gateAnswered(events, 'extend')).toMatchObject({ mode: 'final', version: 1 })
    expect(gateAnswered(events, 'approve')).toMatchObject({ mode: 'final', version: 2 })
    expect(stageFailed(events)).toHaveLength(0)
  })
})
