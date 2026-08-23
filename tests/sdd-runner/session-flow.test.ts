// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { executeSessionTarget, routeOfRow } from '../../sdd-runner/src/session-flow.js'
import type { SessionFlowDeps, SessionTargetAction } from '../../sdd-runner/src/session-flow.js'
import type { SessionRow } from '../../sdd-runner/src/session-list.js'
import type { StopRunResult } from '../../sdd-runner/src/stop-controller.js'
function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    runId: 'fix-flaky-auth-test',
    changeName: 'fix-flaky-auth-test',
    status: 'running',
    stage: 'review',
    depth: 'M',
    round: 2,
    roundCap: 3,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    costKnown: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    pendingDecision: null,
    ...overrides,
  }
}

function makeDeps(stopResult: StopRunResult = { kind: 'marker-requested', runId: 'fix-flaky-auth-test' }): {
  deps: SessionFlowDeps
  calls: string[]
} {
  const calls: string[] = []
  const deps: SessionFlowDeps = {
    runGateResume: (runId) => {
      calls.push(`gate:${runId}`)
      return Promise.resolve({})
    },
    runResume: (runId) => {
      calls.push(`resume:${runId}`)
      return Promise.resolve({})
    },
    buildReport: (runId) => {
      calls.push(`report:${runId}`)
      return Promise.resolve(`# report ${runId}`)
    },
    requestCalmStop: (runId) => {
      calls.push(`stop:${runId}`)
      return Promise.resolve(stopResult)
    },
    reopenGate: (runId) => {
      calls.push(`reopen:${runId}`)
      return Promise.resolve()
    },
    stdout: (line) => {
      calls.push(`stdout:${line}`)
    },
  }
  return { deps, calls }
}

describe('routeOfRow', () => {
  it('maps row state to its routing verb', () => {
    expect(routeOfRow(row())).toBe('resume')
    expect(routeOfRow(row({ pendingDecision: { kind: 'gate', mode: 'final', version: 1 } }))).toBe('gate')
    expect(routeOfRow(row({ status: 'completed' }))).toBe('report')
    expect(routeOfRow(row({ status: 'aborted' }))).toBe('report')
    expect(routeOfRow(row({ status: 'stopped' }))).toBe('resume')
  })
})

describe('executeSessionTarget', () => {
  const action = (kind: SessionTargetAction['kind'], runId = 'fix-flaky-auth-test'): SessionTargetAction =>
    ({ kind, runId }) as SessionTargetAction

  it('gate opens the gate session', async () => {
    const { deps, calls } = makeDeps()
    await executeSessionTarget(action('gate'), deps)
    expect(calls).toEqual(['gate:fix-flaky-auth-test'])
  })

  it('resume re-enters the interrupted stage', async () => {
    const { deps, calls } = makeDeps()
    await executeSessionTarget(action('resume'), deps)
    expect(calls).toEqual(['resume:fix-flaky-auth-test'])
  })

  it('report builds and prints the run report', async () => {
    const { deps, calls } = makeDeps()
    await executeSessionTarget(action('report'), deps)
    expect(calls).toEqual(['report:fix-flaky-auth-test', 'stdout:# report fix-flaky-auth-test'])
  })

  it('stop prints the mapped outcome line for a live calm stop', async () => {
    const { deps, calls } = makeDeps()
    await executeSessionTarget(action('stop'), deps)
    expect(calls[0]).toBe('stop:fix-flaky-auth-test')
    expect(calls[1]).toBe('stdout:calm stop requested for fix-flaky-auth-test — honored at the next boundary')
  })

  it('stop prints the settle line when the run had no live process', async () => {
    const { deps, calls } = makeDeps({ kind: 'settled', runId: 'fix-flaky-auth-test', to: 'stopped' })
    await executeSessionTarget(action('stop'), deps)
    expect(calls[1]).toBe(
      'stdout:run fix-flaky-auth-test has no live process — settled as stopped · resumable via sdd fix-flaky-auth-test',
    )
  })

  it('reopen settles the gate fresh then opens the gate session', async () => {
    const { deps, calls } = makeDeps()
    await executeSessionTarget(action('reopen'), deps)
    expect(calls).toEqual(['reopen:fix-flaky-auth-test', 'gate:fix-flaky-auth-test'])
  })
})
