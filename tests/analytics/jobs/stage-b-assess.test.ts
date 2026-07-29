// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assessRecordedWindow, parseStageBLog } from '../../../src/analytics/jobs/stage-b-assess.js'
import type { StageBDayReport } from '../../../src/analytics/jobs/stage-b-report.js'

const day = (utcDay: string, over: Partial<StageBDayReport> = {}): StageBDayReport => ({
  day: utcDay,
  completeUtcDay: true,
  eligible: true,
  reason: 'ok',
  reconciliation: 'reconciled',
  unexplainedDelta: 0,
  restartGap: false,
  rejects: { total: 0, byReason: {} },
  overflow: 0,
  expiry: { ok: true, earliestDeadlineMs: null, expiredRows: 0 },
  snapshot: { snapshotId: null, publishedAtMs: null, fresh: false },
  delivery: { sending: 0, ambiguous: 0 },
  ...over,
})

const READY = { ready: true, missing: [] } as const
const NOT_READY = { ready: false, missing: ['policy_version'] } as const

const consecutiveDays = (startUtcDay: string, count: number): StageBDayReport[] => {
  const startMs = Date.parse(`${startUtcDay}T00:00:00.000Z`)
  return Array.from({ length: count }, (_, index) =>
    day(new Date(startMs + index * 86_400_000).toISOString().slice(0, 10)),
  )
}

describe('parseStageBLog', () => {
  test('last record per day wins and days are sorted', () => {
    const jsonl = [
      JSON.stringify(day('2026-08-02')),
      JSON.stringify(day('2026-08-01')),
      JSON.stringify(day('2026-08-02', { eligible: false, reason: 'restart_gap', restartGap: true })),
    ].join('\n')
    const records = parseStageBLog(jsonl)
    expect(records.map((record) => record.day)).toEqual(['2026-08-01', '2026-08-02'])
    expect(records[1]?.eligible).toBe(false)
  })

  test('blank lines are ignored', () => {
    expect(parseStageBLog(`\n${JSON.stringify(day('2026-08-01'))}\n\n`)).toHaveLength(1)
  })
})

describe('assessRecordedWindow', () => {
  test('fourteen consecutive eligible days pass the window and open stage C', () => {
    const verdict = assessRecordedWindow(consecutiveDays('2026-08-01', 14), READY)
    expect(verdict.consecutiveCompleteWeeks).toBe(2)
    expect(verdict.stageBExit).toBe(true)
    expect(verdict.stageCEntry).toEqual({ allowed: true })
  })

  test('one restart-gap day breaks consecutiveness', () => {
    const records = consecutiveDays('2026-08-01', 14)
    records[6] = day('2026-08-07', { eligible: false, reason: 'restart_gap', restartGap: true })
    const verdict = assessRecordedWindow(records, READY)
    expect(verdict.consecutiveCompleteWeeks).toBe(1)
    expect(verdict.stageBExit).toBe(false)
    expect(verdict.stageCEntry).toEqual({ allowed: false, refusals: ['stage_b_window_incomplete'] })
  })

  test('governance not ready refuses stage C even with a complete window', () => {
    const verdict = assessRecordedWindow(consecutiveDays('2026-08-01', 14), NOT_READY)
    expect(verdict.stageCEntry).toEqual({ allowed: false, refusals: ['governance_incomplete'] })
  })
})
