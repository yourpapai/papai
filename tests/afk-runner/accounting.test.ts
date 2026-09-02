// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  aggregate,
  formatDuration,
  formatTokens,
  renderRunsReport,
  summarizeWorkDir,
} from '../../afk-runner/src/accounting.js'
import type { RunAccountingInput } from '../../afk-runner/src/accounting.js'
import type { AgentUsage, SddEvent } from '../../afk-runner/src/events.js'

const tmpDirs: string[] = []

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-accounting-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const T0 = '2026-01-01T00:00:00.000Z'

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString()
}

function usageOf(over: Partial<AgentUsage>): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    costUsd: 0,
    wallMs: 0,
    ...over,
  }
}

let seq = 0

function doneAt(offsetMs: number, usage: AgentUsage): SddEvent {
  seq += 1
  return {
    altitude: 'L1',
    type: 'done',
    agent: 'impl',
    usage,
    seq,
    ts: at(offsetMs),
  }
}

function stageEnterAt(offsetMs: number): SddEvent {
  seq += 1
  return {
    altitude: 'L2',
    type: 'stage_enter',
    stage: 'intake',
    seq,
    ts: at(offsetMs),
  }
}

function gateAt(offsetMs: number, action: 'presented' | 'answered', version: number): SddEvent {
  seq += 1
  return {
    altitude: 'L2',
    type: 'gate',
    action,
    mode: version === 2 ? 'escalation' : 'early',
    version,
    seq,
    ts: at(offsetMs),
  }
}

interface RosterOverrides {
  readonly runId?: string
  readonly status?: string
  readonly gate?: { mode: string; version: number } | null
  readonly changeName?: string
  readonly updatedAt?: string
  readonly events?: readonly SddEvent[] | null
}

function roster(over: RosterOverrides = {}): RunAccountingInput {
  return {
    runId: over.runId ?? 'add-thing',
    status: over.status ?? 'completed',
    gate: over.gate ?? null,
    changeName: over.changeName ?? 'add-thing',
    updatedAt: over.updatedAt ?? at(3_600_000),
    events: over.events ?? [],
    ...over,
  }
}

/** The mixed corpus: priced gate-pending, unpriced completed, degraded aborted. */
function mixedCorpus(): readonly RunAccountingInput[] {
  return [
    roster({
      runId: 'calm-run',
      status: 'running',
      gate: { mode: 'escalation', version: 2 },
      changeName: 'calm-run',
      updatedAt: at(9_000_000),
      events: [
        stageEnterAt(0),
        gateAt(10_000, 'presented', 2),
        gateAt(250_000, 'answered', 2),
        doneAt(250_000, usageOf({ inputTokens: 100, costUsd: 0.25 })),
      ],
    }),
    roster({
      runId: 'big-run',
      status: 'completed',
      changeName: 'big-run',
      updatedAt: at(6_000_000),
      events: [
        doneAt(0, usageOf({ inputTokens: 12_000_000, outputTokens: 1_200_000 })),
        doneAt(6_060_000, usageOf({ inputTokens: 1_000 })),
      ],
    }),
    roster({
      runId: 'torn-run',
      status: 'aborted',
      changeName: 'torn-run',
      updatedAt: at(1_000),
      events: null,
    }),
  ]
}

describe('aggregate (pure core)', () => {
  it('renders rows newest-first with identity, status marker, tokens, and log-derived wall', () => {
    const { rows } = aggregate(mixedCorpus())
    expect(rows.map((row) => row.runId)).toEqual(['calm-run', 'big-run', 'torn-run'])
    expect(rows[0]).toMatchObject({
      identity: 'calm-run',
      status: 'gate:escalation v2',
      tokens: 100,
      wallMs: 250_000,
    })
    expect(rows[1]).toMatchObject({
      identity: 'big-run',
      status: 'completed',
      tokens: 13_201_000,
      wallMs: 6_060_000,
    })
    expect(rows[2]).toMatchObject({
      identity: 'torn-run',
      status: 'aborted',
      tokens: null,
      wallMs: null,
    })
  })

  it('totals: status counts, gate-pending, Σtokens, Σwall, Σdwell, cost with degraded rows unpriced', () => {
    const { totals } = aggregate(mixedCorpus())
    expect(totals.runs).toBe(3)
    expect(totals.byStatus).toEqual({ running: 1, completed: 1, aborted: 1 })
    expect(totals.gatePending).toBe(1)
    expect(totals.tokens).toBe(13_201_100)
    expect(totals.wallMs).toBe(6_310_000)
    expect(totals.dwellMs).toBe(240_000)
    expect(totals.costUsd).toBe(0.25)
    expect(totals.unpricedCount).toBe(2)
  })

  it('renders the change name as identity when the run id is a legacy datetime form', () => {
    const { rows } = aggregate([
      roster({
        runId: '2026-08-21T19-44-19-770Z-2f6e644a',
        changeName: 'legacy-change',
        updatedAt: at(1),
      }),
    ])
    expect(rows[0]?.identity).toBe('legacy-change')
    expect(rows[0]?.runId).toBe('2026-08-21T19-44-19-770Z-2f6e644a')
  })

  it('returns zeroed totals and no rows over an empty roster', () => {
    expect(aggregate([])).toEqual({
      rows: [],
      totals: {
        runs: 0,
        byStatus: {},
        gatePending: 0,
        tokens: 0,
        wallMs: 0,
        dwellMs: 0,
        costUsd: 0,
        unpricedCount: 0,
      },
    })
  })

  it('renders an exact cost only when every run is priced', () => {
    const priced = aggregate([
      roster({
        runId: 'p1',
        changeName: 'p1',
        events: [doneAt(0, usageOf({ inputTokens: 10, costUsd: 0.75 }))],
      }),
    ])
    const report = renderRunsReport(priced)
    expect(report).toContain('cost: $0.75')
    expect(report).not.toContain('unpriced')
  })

  it('renders cost as a lower bound with the unpriced-run count over a fully unpriced corpus', () => {
    const corpus = [
      roster({
        runId: 'u1',
        changeName: 'u1',
        events: [doneAt(0, usageOf({ inputTokens: 10 }))],
      }),
      roster({
        runId: 'u2',
        changeName: 'u2',
        events: [doneAt(0, usageOf({ inputTokens: 20 }))],
      }),
    ]
    const report = renderRunsReport(aggregate(corpus))
    expect(report).toContain('cost: ≥ $0.00 (2 unpriced)')
  })
})

describe('formatting helpers', () => {
  it('tokens compact: raw under a thousand, one-decimal K/M/B above', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(2_500)).toBe('2.5K')
    expect(formatTokens(13_200_000)).toBe('13.2M')
    expect(formatTokens(2_000_000_000)).toBe('2B')
  })

  it('unknown tokens render as an em dash', () => {
    expect(formatTokens(null)).toBe('—')
  })

  it('duration buckets: seconds, minutes (unbounded under a day), one-decimal days', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(6_060_000)).toBe('101m')
    expect(formatDuration(9_000_000)).toBe('150m')
    expect(formatDuration(3 * 24 * 3_600_000)).toBe('3d')
    expect(formatDuration(36 * 3_600_000)).toBe('1.5d')
  })

  it('unknown duration renders as an em dash', () => {
    expect(formatDuration(null)).toBe('—')
  })
})

interface StateOverrides {
  readonly status?: string
  readonly gate?: { mode: string; version: number } | null
  readonly changeName?: string
  readonly updatedAt?: string
}

/** Write a run under the work dir: a routing-lite memo plus an optional event log. */
function writeRun(workDir: string, runId: string, state: StateOverrides, events?: readonly SddEvent[] | string): void {
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  const memo = {
    runId,
    status: state.status ?? 'completed',
    gate: state.gate ?? null,
    changeName: state.changeName ?? runId,
    updatedAt: state.updatedAt ?? at(0),
  }
  fs.writeFileSync(path.join(runDir, 'state.json'), `${JSON.stringify(memo, null, 2)}\n`)
  if (events !== undefined) {
    const body = typeof events === 'string' ? events : `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), body)
  }
}

describe('summarizeWorkDir (fs shell)', () => {
  it('aggregates mixed-status runs from memos and logs, newest-first', async () => {
    const workDir = makeWorkDir()
    writeRun(
      workDir,
      'gate-run',
      { status: 'running', gate: { mode: 'escalation', version: 2 }, updatedAt: at(9_000_000) },
      [
        stageEnterAt(0),
        gateAt(10_000, 'presented', 2),
        gateAt(250_000, 'answered', 2),
        doneAt(250_000, usageOf({ inputTokens: 100, costUsd: 0.25 })),
      ],
    )
    writeRun(workDir, 'done-run', { status: 'completed', updatedAt: at(6_000_000) }, [
      doneAt(0, usageOf({ inputTokens: 12_000_000, outputTokens: 1_200_000 })),
      doneAt(6_060_000, usageOf({ inputTokens: 1_000 })),
    ])
    writeRun(workDir, 'dead-run', { status: 'aborted', updatedAt: at(1_000) }, [stageEnterAt(0)])

    const summary = await summarizeWorkDir(workDir)
    expect(summary.rows.map((row) => row.runId)).toEqual(['gate-run', 'done-run', 'dead-run'])
    expect(summary.totals).toMatchObject({
      runs: 3,
      gatePending: 1,
      tokens: 13_201_100,
      wallMs: 6_310_000,
      dwellMs: 240_000,
      costUsd: 0.25,
      unpricedCount: 1,
    })
    const report = renderRunsReport(summary)
    expect(report).toContain('gate-run  gate:escalation v2')
    expect(report).toContain('cost: ≥ $0.25 (1 unpriced)')
  })

  it('skips a run whose memo is unreadable', async () => {
    const workDir = makeWorkDir()
    writeRun(workDir, 'healthy', { updatedAt: at(1) }, [stageEnterAt(0)])
    fs.mkdirSync(path.join(workDir, 'runs', 'corrupt'), { recursive: true })
    fs.writeFileSync(path.join(workDir, 'runs', 'corrupt', 'state.json'), '{not json\n')
    const summary = await summarizeWorkDir(workDir)
    expect(summary.rows.map((row) => row.runId)).toEqual(['healthy'])
  })

  it('keeps a memo-without-log row degraded: tokens —, wall —, counted unpriced', async () => {
    const workDir = makeWorkDir()
    writeRun(workDir, 'logless', { status: 'stopped', updatedAt: at(5) })
    const summary = await summarizeWorkDir(workDir)
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0]).toMatchObject({ runId: 'logless', tokens: null, wallMs: null })
    expect(summary.totals.unpricedCount).toBe(1)
    expect(renderRunsReport(summary)).toMatch(/logless\s+stopped\s+—\s+—/u)
  })

  it('derives numbers from the readable prefix of a torn final log line', async () => {
    const workDir = makeWorkDir()
    const prefix = [
      doneAt(0, usageOf({ inputTokens: 7_000 })),
      doneAt(120_000, usageOf({ inputTokens: 500, costUsd: 0.5 })),
    ]
    const torn = `${prefix.map((event) => JSON.stringify(event)).join('\n')}\n{"seq":3,"ts":`
    writeRun(workDir, 'torn-run', { updatedAt: at(10) }, torn)
    const summary = await summarizeWorkDir(workDir)
    expect(summary.rows[0]).toMatchObject({ tokens: 7_500, wallMs: 120_000 })
    expect(summary.totals.costUsd).toBe(0.5)
  })

  it('prints an empty summary when the runs dir is absent or empty, without error', async () => {
    const absent = await summarizeWorkDir(makeWorkDir())
    expect(absent.rows).toEqual([])
    expect(absent.totals).toMatchObject({ runs: 0, tokens: 0, unpricedCount: 0 })
    const workDir = makeWorkDir()
    fs.mkdirSync(path.join(workDir, 'runs'), { recursive: true })
    expect((await summarizeWorkDir(workDir)).rows).toEqual([])
  })
})
