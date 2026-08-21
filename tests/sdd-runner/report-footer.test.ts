// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { SddEvent } from '../../sdd-runner/src/events.js'
import { buildReport } from '../../sdd-runner/src/report.js'
import type { ReportInput } from '../../sdd-runner/src/report.js'

function inputOf(events: readonly SddEvent[], pr = false): ReportInput {
  return {
    readEvents: () => events,
    readChangeDir: () => Promise.resolve({ tasksDone: 1, tasksTotal: 2, artifacts: ['proposal.md', 'tasks.md'] }),
    execGit: () => Promise.resolve({ stdout: 'abc123 do the thing\n', stderr: '' }),
    runId: 'run-footer',
    changeName: 'add-thing',
    branch: 'main',
    pr,
  }
}

const EVENTS: readonly SddEvent[] = [
  {
    altitude: 'L2',
    type: 'depth',
    profile: 'M',
    rationale: 'touches router',
    source: 'estimator',
    seq: 1,
    ts: '2026-01-01T00:00:00.000Z',
  },
  { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 2, ts: '2026-01-01T00:00:00.000Z' },
  {
    altitude: 'L2',
    type: 'convergence',
    round: 1,
    verdict: 'converged',
    counts: { blocker: 0, material: 0, nitpick: 0 },
    seq: 3,
    ts: '2026-01-01T00:00:00.000Z',
  },
  { altitude: 'L2', type: 'round_close', round: 1, cap: 3, seq: 4, ts: '2026-01-01T00:00:00.000Z' },
  {
    altitude: 'L2',
    type: 'gate',
    action: 'presented',
    mode: 'final',
    version: 1,
    seq: 5,
    ts: '2026-01-01T00:00:00.000Z',
  },
]

describe('completed-run report footer (6.3)', () => {
  it('names the per-attempt transcripts dir and the session ledger', async () => {
    const report = await buildReport(inputOf(EVENTS))
    expect(report).toContain('transcripts/')
    expect(report).toContain('sessions.jsonl')
    expect(report).toMatch(/runs\/run-footer\/transcripts\//u)
    expect(report).toMatch(/runs\/run-footer\/sessions\.jsonl/u)
  })

  it('the footer also appears in the PR-flavored variant', async () => {
    const report = await buildReport(inputOf(EVENTS, true))
    expect(report).toContain('transcripts/')
    expect(report).toContain('sessions.jsonl')
  })
})
