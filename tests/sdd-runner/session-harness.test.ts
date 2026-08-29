// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { CliHarness } from '../../sdd-runner/src/cli.js'
import { sessionFlowDepsOf } from '../../sdd-runner/src/session-harness.js'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function captureHarness(overrides: Partial<CliHarness> = {}): { harness: CliHarness; calls: string[] } {
  const calls: string[] = []
  const harness: CliHarness = {
    workDir: '/work',
    runStart: () => Promise.reject(new Error('unreachable')),
    runResume: (runId) => {
      calls.push(`resume:${runId}`)
      return Promise.resolve({ runId, halted: 'stopped' })
    },
    runGateResume: (runId) => {
      calls.push(`gate:${runId}`)
      return Promise.resolve({ runId, outcome: 'approved', version: 1 })
    },
    runContinue: () => Promise.reject(new Error('unreachable')),
    buildReport: (runId, pr) => {
      calls.push(`report:${runId}:${pr ? 'pr' : 'full'}`)
      return Promise.resolve(`report of ${runId}`)
    },
    requestCalmStop: (runId) => {
      calls.push(`stop:${runId}`)
      return Promise.resolve({ kind: 'marker-requested', runId })
    },
    runGateReopen: (runId, version) => {
      calls.push(`reopen:${runId}:${version}`)
      return Promise.resolve({ runId, gateVersion: version })
    },
    runAnalysis: () => Promise.reject(new Error('unreachable')),
    stdout: (line) => {
      calls.push(`out:${line}`)
    },
    ...overrides,
  }
  return { harness, calls }
}

describe('sessionFlowDepsOf (session-harness)', () => {
  it('adapts the harness members onto the session-flow surface', async () => {
    const { harness, calls } = captureHarness()
    const deps = sessionFlowDepsOf(harness)
    await deps.runGateResume('run-1')
    await deps.runResume('run-1')
    await deps.buildReport('run-1')
    await deps.requestCalmStop('run-1')
    expect(calls).toEqual(['gate:run-1', 'resume:run-1', 'report:run-1:full', 'stop:run-1'])
  })

  it('reopenGate resolves the latest settled version before reopening', async () => {
    const { harness, calls } = captureHarness({ latestSettledGateVersion: () => Promise.resolve(3) })
    await sessionFlowDepsOf(harness).reopenGate('run-1')
    expect(calls).toEqual(['reopen:run-1:3'])
  })

  it('reopenGate fails naming the run when no settled gate exists', async () => {
    const { harness } = captureHarness({ latestSettledGateVersion: () => Promise.resolve(null) })
    const failure = await sessionFlowDepsOf(harness)
      .reopenGate('run-1')
      .catch((error: unknown) => error)
    expect(failure instanceof Error).toBe(true)
    expect(messageOf(failure)).toMatch(/run-1 has no settled gate/u)
  })
})
