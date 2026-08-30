// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { evaluateFinalGate, evaluatePlanGate } from '../../sdd-runner/src/auto-policy.js'
import type { PolicyDecision, PolicySignals } from '../../sdd-runner/src/auto-policy.js'
import type { AutonomyConfig } from '../../sdd-runner/src/config.js'
import { appendEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { runPolicyLadder } from '../../sdd-runner/src/gate-prelude.js'
import { renderPreviewBlock } from '../../sdd-runner/src/gate-prelude.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { DigestRecord } from '../../sdd-runner/src/replay.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

const CHANGE_DIR = 'openspec/changes/thing'

function planSignals(overrides: Partial<PolicySignals> = {}): PolicySignals {
  const reviewResult: ReviewLoopResult = {
    outcome: 'converged',
    rounds: 2,
    openBlockers: [],
    openMaterial: [],
    openNitpicks: [],
  }
  const trajectory: DigestRecord[] = [
    { round: 1, counts: { blocker: 0, material: 3, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
    { round: 2, counts: { blocker: 0, material: 1, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
  ]
  const config: AutonomyConfig = { level: 'assist', costCeilingUsd: 5, metered: true }
  return {
    reviewResult,
    trajectory,
    assumptions: [],
    spentUsd: 3.4,
    costKnown: true,
    autoExtendsUsed: 0,
    deadlineExpired: false,
    config,
    childCount: 3,
    ...overrides,
  }
}

describe('evaluatePlanGate (D5: R4 only)', () => {
  it('fires R4 when spent + childCount × DEFAULT_ROUND_COST_USD crosses the ceiling', () => {
    const decision = evaluatePlanGate(planSignals({ childCount: 4 }))
    expect(decision).toMatchObject({ rule: 'R4', action: 'gate' })
    expect(decision.evidenceDigest.length).toBeGreaterThan(0)
  })

  it('stays under the ceiling with one fewer child: the projection is per-child, not a flat constant', () => {
    const decision = evaluatePlanGate(planSignals({ childCount: 3 }))
    expect(decision).toMatchObject({ rule: 'none', action: 'gate' })
  })

  it('uses the child-count projection, never the rounds-based one, at plan mode', () => {
    // rounds-based would project spent + spent/rounds = 3.4 + 1.7 = 5.1 ≥ 5 (R4);
    // the child projection 3.4 + 3 × 0.5 = 4.9 < 5 must win.
    const decision = evaluatePlanGate(planSignals({ childCount: 3 }))
    expect(decision.rule).toBe('none')
  })

  it('fails closed on unknown cost', () => {
    expect(evaluatePlanGate(planSignals({ costKnown: false, childCount: 1 }))).toMatchObject({
      rule: 'R4',
      action: 'gate',
    })
  })

  it('the spend baseline is added before the ceiling compare: same signals, baseline flips none→R4 (D10)', () => {
    expect(evaluatePlanGate(planSignals({ childCount: 3 }))).toMatchObject({ rule: 'none' })
    expect(evaluatePlanGate(planSignals({ childCount: 3, spendBaselineUsd: 3 }))).toMatchObject({
      rule: 'R4',
      action: 'gate',
    })
  })

  it('an undefined baseline reads 0 — top-level runs keep today\u2019s arithmetic', () => {
    const withoutBaseline = evaluateFinalGate(planSignals({ spentUsd: 0.5 }))
    expect(withoutBaseline.action).toBe('approve')
    const withBaseline = evaluateFinalGate(planSignals({ spentUsd: 0.5, spendBaselineUsd: 4.6 }))
    expect(withBaseline).toMatchObject({ rule: 'R4', action: 'gate' })
  })

  it('no rule can approve, extend, or accept-items at plan mode — R1/R2/R3-satisfying signals still gate', () => {
    const lowBlastAll = [
      { id: 'A1', text: 't', blastRadius: 'b', blast: 'low' as const, files: [`${CHANGE_DIR}/proposal.md`] },
    ]
    const r1WouldApprove = evaluateFinalGate(planSignals({ assumptions: lowBlastAll, spentUsd: 0.5, childCount: 1 }))
    expect(r1WouldApprove.action).toBe('approve')
    const planDecision = evaluatePlanGate(planSignals({ assumptions: lowBlastAll, spentUsd: 0.5, childCount: 1 }))
    expect(planDecision.action).toBe('gate')
    expect(planDecision.rule).toBe('none')

    const capHitSignals = planSignals({
      reviewResult: {
        outcome: 'cap-hit',
        rounds: 3,
        openBlockers: [],
        openMaterial: [{ id: 'F1', class: 'MATERIAL', resolution: 'assumed', outcome: 'kept' }],
        openNitpicks: [],
      },
    })
    const planCapHit = evaluatePlanGate(capHitSignals)
    expect(planCapHit.action).toBe('gate')
    expect(planCapHit.rule).toBe('none')
  })
})

describe('runPolicyLadder unmetered seam (sdd-policy-metered-budget 2.3)', () => {
  const decreasing: DigestRecord[] = [
    { round: 1, counts: { blocker: 0, material: 3, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
    { round: 2, counts: { blocker: 0, material: 1, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
  ]
  const flat: DigestRecord[] = [
    { round: 1, counts: { blocker: 0, material: 2, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
    { round: 2, counts: { blocker: 0, material: 2, nitpick: 0 }, resolved: 0, dismissed: 0, verdict: 'open' },
  ]
  const capHit: ReviewLoopResult = {
    outcome: 'cap-hit',
    rounds: 2,
    openBlockers: [],
    openMaterial: [{ id: 'F1', class: 'MATERIAL', resolution: 'assumed', outcome: 'kept' }],
    openNitpicks: [],
  }

  async function seedLadderFixture(): Promise<{
    deps: OrchestratorDeps
    state: RunState
    run: (autonomy: AutonomyConfig, trajectory: readonly DigestRecord[]) => PolicyDecision
  }> {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-prelude-'))
    const workDir = path.join(repoRoot, '.sdd-runner')
    const state = await createRunState({ workDir, repoRoot, changeName: 'thing' })
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(
      path.join(state.runDir, 'sidecars', 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'assumed', outcome: 'kept' }],
        assumptions: [],
      }),
    )
    const logPath = path.join(state.runDir, 'events.ndjson')
    appendEvent(logPath, {
      altitude: 'L2',
      type: 'convergence',
      round: 2,
      verdict: 'open',
      counts: { blocker: 0, material: 1, nitpick: 0 },
    })
    const deps: OrchestratorDeps = {
      config: { repoRoot, workDir, model: 'test-model', budget: null },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
        cwd: repoRoot,
      }),
      resolveCost: () => null,
      stdout: () => undefined,
    }
    const ctx = {
      cwd: repoRoot,
      changeDir: path.join(repoRoot, 'openspec', 'changes', 'thing'),
      sidecarDir: path.join(state.runDir, 'sidecars'),
      emit: (): void => undefined,
    }
    const run = (autonomy: AutonomyConfig, trajectory: readonly DigestRecord[]): PolicyDecision =>
      runPolicyLadder({ ...deps, autonomy }, state, ctx, capHit, {
        mode: 'early',
        version: 1,
        events: [],
        costUsd: 0,
        costKnown: false,
        assumptions: [],
        trajectory,
      }).decision
    return { deps, state, run }
  }

  it('unmetered cap-hit with unknown cost lets R2 extend — no R4 cost veto', async () => {
    const { run } = await seedLadderFixture()
    const decision = run({ level: 'assist', costCeilingUsd: null, metered: false }, decreasing)
    expect(decision).toMatchObject({ rule: 'R2', action: 'extend' })
  })

  it('unmetered undecidable cap-hit previews without R4 cost evidence (rule none)', async () => {
    const { run } = await seedLadderFixture()
    const decision = run({ level: 'assist', costCeilingUsd: null, metered: false }, flat)
    expect(decision).toMatchObject({ rule: 'none', action: 'gate' })
    expect(renderPreviewBlock(decision)).toContain('> rule: none')
    expect(renderPreviewBlock(decision)).not.toContain('R4')
  })

  it('metered numeric path is unchanged: unknown cost still gates through R4 with the identical preview', async () => {
    const { run } = await seedLadderFixture()
    const decision = run({ level: 'assist', costCeilingUsd: 5, metered: true }, decreasing)
    expect(decision).toMatchObject({ rule: 'R4', action: 'gate' })
    const again = run({ level: 'assist', costCeilingUsd: 5, metered: true }, decreasing)
    expect(renderPreviewBlock(decision)).toBe(renderPreviewBlock(again))
  })
})

describe('renderPreviewBlock', () => {
  it('renders every content line as a > -prefixed blockquote under the preview header', () => {
    const decision: PolicyDecision = {
      rule: 'R1',
      action: 'approve',
      evidenceDigest: 'abc123',
    }
    const block = renderPreviewBlock(decision)
    const lines = block.split('\n').filter((line) => line.trim().length > 0)
    expect(lines[0]).toBe('### Auto-decision preview')
    for (const line of lines.slice(1)) {
      expect(line.startsWith('> ')).toBe(true)
    }
    expect(block).toContain('> rule: R1')
    expect(block).toContain('> decision: approve')
  })

  it('contains no checkbox, ABORT, or leading-arrow line the parser could act on', () => {
    const decision: PolicyDecision = {
      rule: 'none',
      action: 'gate',
      evidenceDigest: 'd',
    }
    const block = renderPreviewBlock(decision)
    expect(/^- \[/mu.test(block)).toBe(false)
    expect(/^\s*ABORT\s*$/mu.test(block)).toBe(false)
    expect(/^→/mu.test(block)).toBe(false)
  })
})
