// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { SddEvent } from '../../sdd-runner/src/events.js'
import { buildReport } from '../../sdd-runner/src/report.js'
import type { ChangeDirSummary, ReportInput } from '../../sdd-runner/src/report.js'

function events(): readonly SddEvent[] {
  return [
    {
      altitude: 'L2',
      type: 'depth',
      profile: 'M',
      rationale: 'cross-module chat router change',
      source: 'estimator',
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
    },
    { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'x', seq: 2, ts: 'x' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 3, ts: 'x' },
    {
      altitude: 'L2',
      type: 'convergence',
      round: 1,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 1 },
      seq: 4,
      ts: 'x',
    },
    { altitude: 'L2', type: 'round_close', round: 1, cap: 3, seq: 5, ts: 'x' },
    { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1, seq: 6, ts: 'x' },
    { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, seq: 7, ts: 'x' },
  ]
}

function changeDir(): ChangeDirSummary {
  return { tasksDone: 3, tasksTotal: 3, artifacts: ['proposal.md', 'specs/x/spec.md', 'design.md', 'tasks.md'] }
}

function gitLog(stdout: string) {
  return (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout, stderr: '' })
}

describe('buildReport', () => {
  it('states depth + rationale, rounds, scrutiny gaps, and per-section commits', async () => {
    const input: ReportInput = {
      readEvents: events,
      readChangeDir: () => Promise.resolve(changeDir()),
      execGit: gitLog('abc1234 Section 1\n def5678 Section 2\n 9ab0cde Section 3\n'),
      runId: 'run-1',
      changeName: 'add-thing',
      branch: 'add-thing',
      pr: false,
    }
    const body = await buildReport(input)
    expect(body).toContain('### Depth')
    expect(body).toContain('M — cross-module chat router change')
    expect(body).toContain('converged in 1 round')
    expect(body).toContain('skeptic lens: not run')
    expect(body).toContain('abc1234')
    expect(body).toContain('3/3 tasks')
  })

  it('adds PR framing and honest archive status when pr=true', async () => {
    const input: ReportInput = {
      readEvents: events,
      readChangeDir: () => Promise.resolve(changeDir()),
      execGit: gitLog('abc1234 Section 1\n'),
      runId: 'run-1',
      changeName: 'add-thing',
      branch: 'add-thing',
      pr: true,
    }
    const body = await buildReport(input)
    expect(body).toContain('## Summary')
    expect(body).toMatch(/archive.*post-merge/iu)
  })

  it('notes the skeptic lens when skeptic spawns are present', async () => {
    const ev: readonly SddEvent[] = [
      ...events(),
      { altitude: 'L1', type: 'spawned', agent: 'skeptic-r1', role: 'skeptic', model: 'x', seq: 8, ts: 'x' },
    ]
    const input: ReportInput = {
      readEvents: () => ev,
      readChangeDir: () => Promise.resolve(changeDir()),
      execGit: gitLog('abc Section 1\n'),
      runId: 'run-1',
      changeName: 'add-thing',
      branch: 'add-thing',
      pr: false,
    }
    const body = await buildReport(input)
    expect(body).toContain('skeptic lens: run')
  })
})
