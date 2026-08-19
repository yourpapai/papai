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

describe('gains block (11.1)', () => {
  const gateStamps = (seq: number): { presented: string; answered: string } => ({
    presented: `2026-01-01T00:0${seq}:00.000Z`,
    answered: `2026-01-01T00:0${seq}:05.000Z`,
  })

  it('counts paired approve/extend events as interventions avoided per rule, with dwell-based saved estimate', async () => {
    const base = events()
    const stamps = gateStamps(8)
    const ev: readonly SddEvent[] = [
      ...base,
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 2, seq: 8, ts: stamps.presented },
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R1',
        decision: 'approve',
        evidenceDigest: 'd',
        gateVersion: 2,
        seq: 9,
        ts: 'x',
      },
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 2, seq: 10, ts: stamps.answered },
    ]
    const body = await buildReport(baseInput(ev))
    expect(body).toContain('### Gains')
    expect(body).toMatch(/interventions avoided: 1/u)
    expect(body).toMatch(/R1 × 1/u)
    expect(body).toMatch(/human gates: \d+/u)
    expect(body).toMatch(/~wall-time saved/u)
  })

  it('never counts unpaired auto_decision events', async () => {
    const ev: readonly SddEvent[] = [
      ...events(),
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R1',
        decision: 'approve',
        evidenceDigest: 'd',
        gateVersion: 2,
        seq: 8,
        ts: 'x',
      },
    ]
    const body = await buildReport(baseInput(ev))
    expect(body).not.toMatch(/interventions avoided: [1-9]/u)
  })

  it('reports accept-items separately as items auto-accepted, not interventions avoided', async () => {
    const ev: readonly SddEvent[] = [
      ...events(),
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R3',
        decision: 'accept-items',
        evidenceDigest: 'd',
        gateVersion: 1,
        seq: 8,
        ts: 'x',
      },
    ]
    const body = await buildReport(baseInput(ev))
    expect(body).toMatch(/R3 .*items auto-accepted: 1/u)
    expect(body).not.toMatch(/interventions avoided: [1-9]/u)
  })
})

function baseInput(evs: readonly SddEvent[]): ReportInput {
  return {
    readEvents: () => evs,
    readChangeDir: () => Promise.resolve(changeDir()),
    execGit: gitLog('abc Section 1\n'),
    runId: 'run-1',
    changeName: 'add-thing',
    branch: 'add-thing',
    pr: false,
  }
}

describe('buildReport verdict and lens edges (mutation kills)', () => {
  it('verdict words: converged plural, open after N, review not reached', async () => {
    const baseEvents = (): SddEvent[] => [
      { altitude: 'L2', type: 'depth', profile: 'M', rationale: 'r', source: 'estimator', seq: 1, ts: 'x' },
      { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'x', seq: 2, ts: 'x' },
    ]
    const mk = (evts: SddEvent[]): ReportInput => ({
      readEvents: () => evts,
      readChangeDir: () => Promise.resolve(changeDir()),
      execGit: gitLog(''),
      runId: 'run-1',
      changeName: 'add-thing',
      branch: 'add-thing',
      pr: false,
    })
    const twoRounds: SddEvent[] = [
      ...baseEvents(),
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 3, ts: 'x' },
      { altitude: 'L2', type: 'round_open', round: 2, cap: 3, seq: 4, ts: 'x' },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 2,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        seq: 5,
        ts: 'x',
      },
    ]
    const body2 = await buildReport(mk(twoRounds))
    expect(body2).toContain('converged in 2 rounds')
    expect(body2).toContain('gate versions presented: 0')
    expect(body2).toContain('skeptic lens: not run — M profile')

    const noSkepticNoDepth: SddEvent[] = [
      { altitude: 'L1', type: 'spawned', agent: 'a', role: 'reviewer', model: 'm', seq: 1, ts: 'x' },
    ]
    const bodyDepthless = await buildReport(mk(noSkepticNoDepth))
    expect(bodyDepthless).toContain('not classified')
    expect(bodyDepthless).toContain('review not reached')
    expect(bodyDepthless).toContain('skeptic lens: not run\n')

    const openVerdict: SddEvent[] = [
      ...baseEvents(),
      { altitude: 'L2', type: 'round_open', round: 1, cap: 3, seq: 3, ts: 'x' },
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 0, material: 0, nitpick: 0 },
        seq: 4,
        ts: 'x',
      },
    ]
    expect(await buildReport(mk(openVerdict))).toContain('open after 1 round')

    const skepticRun: SddEvent[] = [
      ...baseEvents(),
      { altitude: 'L1', type: 'spawned', agent: 'skeptic-1', role: 'skeptic', model: 'm', seq: 3, ts: 'x' },
    ]
    expect(await buildReport(mk(skepticRun))).toContain('skeptic lens: run')
  })

  it('commits line filters blank lines and splits on newlines', async () => {
    const input: ReportInput = {
      readEvents: () => [],
      readChangeDir: () => Promise.resolve(changeDir()),
      execGit: gitLog('a1 Subject\n\n  \nb2 Subject\n'),
      runId: 'run-1',
      changeName: 'add-thing',
      branch: 'add-thing',
      pr: false,
    }
    const body = await buildReport(input)
    expect(body).toContain('a1 Subject')
    expect(body).toContain('b2 Subject')
    expect(body).not.toMatch(/^ $/mu)
  })
})
