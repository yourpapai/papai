// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert'

import type { PolicyDecision } from '../../sdd-runner/src/auto-policy.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import type { GateAssumption } from '../../sdd-runner/src/gate-model.js'
import type { PolicyGateInput } from '../../sdd-runner/src/gate-prelude.js'
import { autoExtendRound, autoSettleFinalGate, renderAutoApproveAnswers } from '../../sdd-runner/src/gate-settle.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

function makeState(gateMode: 'early' | 'final' | 'plan'): RunState {
  return {
    runId: 'run-1',
    repoRoot: '/repo',
    workDir: '/repo/.sdd-runner',
    changeName: 'add-thing',
    stage: 'gate',
    depth: 'S',
    round: 1,
    gate: { mode: gateMode, version: 2 },
    status: 'running',
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt: '2026-08-10T10:00:00.000Z',
    autoExtendsUsed: 0,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
    runDir: '/repo/.sdd-runner/runs/run-1',
    statePath: '/repo/.sdd-runner/runs/run-1/state.json',
  }
}

function makeDeps(): OrchestratorDeps {
  const config: RunnerConfig = { repoRoot: '/repo', workDir: '/repo/.sdd-runner', model: 'm', budget: 5 }
  return {
    config,
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriver({
      exec: () => Promise.resolve({ stdout: '{}', stderr: '', exitCode: 0 }),
      cwd: '/repo',
    }),
  }
}

function makeCtx(emitted: unknown[]): StageContext {
  return {
    cwd: '/repo',
    changeDir: '/repo/openspec/changes/add-thing',
    sidecarDir: '/repo/.sdd-runner/runs/run-1/sidecars',
    emit: (event) => {
      emitted.push(event)
    },
  }
}

const DECISION: PolicyDecision = { rule: 'R1', action: 'approve', evidenceDigest: 'd' }

function makeInput(): PolicyGateInput {
  return {
    mode: 'final',
    version: 2,
    events: [],
    costUsd: 0.1,
    costKnown: true,
    assumptions: [],
    trajectory: [],
  }
}

describe('renderAutoApproveAnswers', () => {
  const decision: PolicyDecision = {
    rule: 'R1',
    action: 'approve',
    evidenceDigest: 'd',
  }

  it('renders an approved answer section with policy attribution on every line', () => {
    const assumptions: GateAssumption[] = [
      { id: 'A1', text: 'first', blast_radius: 'b', evidence: { files: ['a.md'] } },
      { id: 'A2', text: 'second', blast_radius: 'b', evidence: { files: ['b.md'] } },
    ]
    const md = renderAutoApproveAnswers(decision, assumptions)
    expect(md).toContain('## Gate response')
    expect(md).toContain('decided-by: policy R1')
    expect(md).toContain('- [x] A1 first · decided-by: policy R1')
    expect(md).toContain('- [x] A2 second · decided-by: policy R1')
  })
})

describe('auto-settle guards refuse plan mode (D5)', () => {
  it('autoSettleFinalGate refuses a plan-mode gate loudly before writing anything', async () => {
    const emitted: unknown[] = []
    const state = makeState('plan')
    const failure = await autoSettleFinalGate(makeDeps(), state, makeCtx(emitted), DECISION, makeInput()).catch(
      (error: unknown) => error,
    )
    assert(failure instanceof Error)
    expect(failure.message).toMatch(/plan mode/u)
    expect(emitted).toEqual([])
  })

  it('autoExtendRound refuses a plan-mode gate loudly without consuming the extend allowance', async () => {
    const emitted: unknown[] = []
    const state = makeState('plan')
    const failure = await autoExtendRound(makeDeps(), state, makeCtx(emitted), DECISION, 2).catch(
      (error: unknown) => error,
    )
    assert(failure instanceof Error)
    expect(failure.message).toMatch(/plan mode/u)
    expect(state.autoExtendsUsed).toBe(0)
    expect(emitted).toEqual([])
  })
})
