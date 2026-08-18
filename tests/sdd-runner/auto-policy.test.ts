// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { classifyAssumptions, evaluateCapHit, evaluateFinalGate } from '../../sdd-runner/src/auto-policy.js'
import type { ClassifiableAssumption, PolicySignals } from '../../sdd-runner/src/auto-policy.js'
import type { AutonomyConfig } from '../../sdd-runner/src/config.js'
import type { DigestRecord } from '../../sdd-runner/src/replay.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'

const CHANGE_DIR = 'openspec/changes/thing'
const RUN_DIR = '.sdd-runner/runs/run-1'

function autonomy(overrides: Partial<AutonomyConfig> = {}): AutonomyConfig {
  return {
    level: 'assist',
    costCeilingUsd: 5,
    autoExtendMax: 1,
    deadlineMinutes: undefined,
    rules: {},
    ...overrides,
  }
}

function converged(overrides: Partial<ReviewLoopResult> = {}): ReviewLoopResult {
  return { outcome: 'converged', rounds: 2, openBlockers: [], openMaterial: [], openNitpicks: [], ...overrides }
}

function capHit(overrides: Partial<ReviewLoopResult> = {}): ReviewLoopResult {
  return {
    outcome: 'cap-hit',
    rounds: 3,
    openBlockers: [],
    openMaterial: [{ id: 'F1', class: 'MATERIAL', resolution: 'assumed', outcome: 'kept' }],
    openNitpicks: [],
    ...overrides,
  }
}

function trajectory(totals: readonly number[]): DigestRecord[] {
  return totals.map((total, i) => ({
    round: i + 1,
    counts: { blocker: 0, material: total, nitpick: 0 },
    resolved: 0,
    dismissed: 0,
    verdict: 'open' as const,
  }))
}

function signals(overrides: Partial<PolicySignals> = {}): PolicySignals {
  return {
    reviewResult: converged(),
    trajectory: trajectory([3, 1]),
    assumptions: [],
    spentUsd: 0.5,
    costKnown: true,
    autoExtendsUsed: 0,
    deadlineExpired: false,
    config: autonomy(),
    ...overrides,
  }
}

describe('classifyAssumptions (R3)', () => {
  const recordedPaths = [
    `${CHANGE_DIR}/proposal.md`,
    `${CHANGE_DIR}/design.md`,
    `${CHANGE_DIR}/specs/thing/spec.md`,
    `${CHANGE_DIR}/tasks.md`,
    `${RUN_DIR}/sidecars/resolutions-1.json`,
  ]

  function assumption(
    id: string,
    files: readonly string[] | null,
    overrides: { blast_radius?: string } = {},
  ): ClassifiableAssumption {
    return {
      id,
      text: `assumption ${id}`,
      blast_radius: overrides.blast_radius ?? 'claims tiny blast',
      ...(files === null ? {} : { evidence: { files } }),
    }
  }

  it('classifies low-blast when all referenced files sit inside the change folder and are recorded', () => {
    const classified = classifyAssumptions(
      [assumption('A1', [`${CHANGE_DIR}/proposal.md`, `${RUN_DIR}/sidecars/resolutions-1.json`])],
      { changeDir: CHANGE_DIR, runDir: RUN_DIR, recordedPaths },
    )
    expect(classified[0]).toMatchObject({ id: 'A1', blast: 'low' })
  })

  it('classifies high-blast when a referenced file lies outside both boundaries', () => {
    const classified = classifyAssumptions([assumption('A1', ['src/chat/router.ts'])], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(classified[0]).toMatchObject({ blast: 'high' })
  })

  it('classifies high-blast when a spec delta file is touched', () => {
    const classified = classifyAssumptions([assumption('A1', [`${CHANGE_DIR}/specs/thing/spec.md`])], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(classified[0]).toMatchObject({ blast: 'high' })
  })

  it('classifies high-blast when tasks.md is touched (checklist surface)', () => {
    const classified = classifyAssumptions([assumption('A1', [`${CHANGE_DIR}/tasks.md`])], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(classified[0]).toMatchObject({ blast: 'high' })
  })

  it('fails closed on missing, empty, or un-recorded evidence (never vacuously low-blast)', () => {
    const missing = classifyAssumptions([assumption('A1', null)], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(missing[0]).toMatchObject({ blast: 'high' })
    const empty = classifyAssumptions([assumption('A1', [])], { changeDir: CHANGE_DIR, runDir: RUN_DIR, recordedPaths })
    expect(empty[0]).toMatchObject({ blast: 'high' })
    const unrecorded = classifyAssumptions([assumption('A1', [`${CHANGE_DIR}/not-recorded-anywhere.md`])], {
      changeDir: CHANGE_DIR,
      runDir: RUN_DIR,
      recordedPaths,
    })
    expect(unrecorded[0]).toMatchObject({ blast: 'high' })
  })

  it('never consults the agent blast_radius text: same files, wildly different text, same class', () => {
    const classified = classifyAssumptions(
      [
        assumption('A1', [`${CHANGE_DIR}/proposal.md`], { blast_radius: 'absolutely tiny, trust me' }),
        assumption('A2', [`${CHANGE_DIR}/proposal.md`], { blast_radius: 'ENTIRE PRODUCTION' }),
      ],
      { changeDir: CHANGE_DIR, runDir: RUN_DIR, recordedPaths },
    )
    expect(classified.map((a) => a.blast)).toEqual(['low', 'low'])
  })

  it('carries id/text/blastRadius through for gate rendering', () => {
    const classified = classifyAssumptions(
      [assumption('A1', [`${CHANGE_DIR}/proposal.md`], { blast_radius: 'display text' })],
      { changeDir: CHANGE_DIR, runDir: RUN_DIR, recordedPaths },
    )
    expect(classified[0]).toMatchObject({
      id: 'A1',
      text: 'assumption A1',
      blastRadius: 'display text',
    })
  })
})

describe('evaluateFinalGate (R1)', () => {
  const lowBlast = [
    {
      id: 'A1',
      text: 't',
      blastRadius: 'b',
      blast: 'low' as const,
      files: [`${CHANGE_DIR}/proposal.md`],
    },
  ]
  const highBlast = [
    {
      id: 'A2',
      text: 't',
      blastRadius: 'b',
      blast: 'high' as const,
      files: ['src/chat/router.ts'],
    },
  ]

  it('approves a converged final gate with all-low-blast assumptions at assist', () => {
    const decision = evaluateFinalGate(signals({ assumptions: lowBlast }))
    expect(decision).toMatchObject({ rule: 'R1', action: 'approve', permittedAt: 'assist' })
    expect(decision.evidenceDigest.length).toBeGreaterThan(0)
  })

  it('does not fire R1 with an open BLOCKER or open MATERIAL', () => {
    const blocker = evaluateFinalGate(
      signals({
        reviewResult: converged({
          openBlockers: [{ id: 'F9', class: 'BLOCKER', resolution: 'edited', outcome: 'x' }],
        }),
        assumptions: lowBlast,
      }),
    )
    expect(blocker).toMatchObject({ action: 'gate' })
    const material = evaluateFinalGate(
      signals({
        reviewResult: converged({
          openMaterial: [{ id: 'F8', class: 'MATERIAL', resolution: 'assumed', outcome: 'x' }],
        }),
        assumptions: lowBlast,
      }),
    )
    expect(material).toMatchObject({ action: 'gate' })
  })

  it('does not fire R1 when a surviving assumption is high-blast; offers R3 accept-items instead', () => {
    const decision = evaluateFinalGate(signals({ assumptions: [...lowBlast, ...highBlast] }))
    expect(decision).toMatchObject({ rule: 'R3', action: 'accept-items', permittedAt: 'assist' })
  })

  it('R1 disabled via rules map falls through to a human gate', () => {
    const decision = evaluateFinalGate(signals({ assumptions: lowBlast, config: autonomy({ rules: { R1: false } }) }))
    expect(decision).toMatchObject({ rule: 'R1', action: 'gate' })
  })

  it('R3 disabled via rules map suppresses accept-items on a mixed gate', () => {
    const decision = evaluateFinalGate(
      signals({ assumptions: [...lowBlast, ...highBlast], config: autonomy({ rules: { R3: false } }) }),
    )
    expect(decision).toMatchObject({ action: 'gate' })
  })
})

describe('R4 budget guard', () => {
  const lowBlast = [
    { id: 'A1', text: 't', blastRadius: 'b', blast: 'low' as const, files: [`${CHANGE_DIR}/proposal.md`] },
  ]

  it('fails closed on unknown cost in every evaluator', () => {
    expect(evaluateFinalGate(signals({ costKnown: false, assumptions: lowBlast }))).toMatchObject({
      rule: 'R4',
      action: 'gate',
    })
    expect(evaluateCapHit(signals({ costKnown: false }))).toMatchObject({ rule: 'R4', action: 'gate' })
  })

  it('gates when projected spend crosses the effective ceiling despite other predicates', () => {
    const decision = evaluateFinalGate(signals({ assumptions: lowBlast, spentUsd: 4.9 }))
    expect(decision).toMatchObject({ rule: 'R4', action: 'gate' })
  })

  it('ignores a rules entry naming R4 (never-cut invariant)', () => {
    const decision = evaluateFinalGate(
      signals({ assumptions: lowBlast, spentUsd: 4.9, config: autonomy({ rules: { R4: false } }) }),
    )
    expect(decision).toMatchObject({ rule: 'R4', action: 'gate' })
  })
})

describe('evaluateCapHit (R2)', () => {
  it('extends on a strictly decreasing burndown with open MATERIALs and budget headroom', () => {
    const decision = evaluateCapHit(signals({ reviewResult: capHit(), trajectory: trajectory([3, 1]) }))
    expect(decision).toMatchObject({ rule: 'R2', action: 'extend', permittedAt: 'assist' })
  })

  it('does not extend on a flat or increasing trajectory', () => {
    expect(evaluateCapHit(signals({ reviewResult: capHit(), trajectory: trajectory([2, 2]) }))).toMatchObject({
      action: 'gate',
    })
    expect(evaluateCapHit(signals({ reviewResult: capHit(), trajectory: trajectory([1, 2]) }))).toMatchObject({
      action: 'gate',
    })
  })

  it('does not extend with an open BLOCKER (never-cut)', () => {
    const decision = evaluateCapHit(
      signals({
        reviewResult: capHit({
          openBlockers: [{ id: 'F9', class: 'BLOCKER', resolution: 'edited', outcome: 'x' }],
        }),
        trajectory: trajectory([3, 1]),
      }),
    )
    expect(decision).toMatchObject({ rule: 'none', action: 'gate' })
  })

  it('does not extend with zero open MATERIALs (nothing to burndown)', () => {
    const decision = evaluateCapHit(
      signals({
        reviewResult: capHit({ openMaterial: [] }),
        trajectory: trajectory([3, 1]),
      }),
    )
    expect(decision.action).toBe('gate')
  })

  it('does not extend past the autoExtendMax bound', () => {
    const decision = evaluateCapHit(
      signals({ reviewResult: capHit(), trajectory: trajectory([3, 1]), autoExtendsUsed: 1 }),
    )
    expect(decision.action).toBe('gate')
  })

  it('does not extend when projected spend would cross the ceiling', () => {
    const decision = evaluateCapHit(signals({ reviewResult: capHit(), trajectory: trajectory([3, 1]), spentUsd: 4.9 }))
    expect(decision).toMatchObject({ rule: 'R4', action: 'gate' })
  })

  it('R2 disabled via rules map presents the human gate', () => {
    const decision = evaluateCapHit(
      signals({ reviewResult: capHit(), trajectory: trajectory([3, 1]), config: autonomy({ rules: { R2: false } }) }),
    )
    expect(decision).toMatchObject({ rule: 'R2', action: 'gate' })
  })
})

describe('deadline-expiry conservative branches', () => {
  const lowBlast = [
    { id: 'A1', text: 't', blastRadius: 'b', blast: 'low' as const, files: [`${CHANGE_DIR}/proposal.md`] },
  ]
  const highBlast = [{ id: 'A2', text: 't', blastRadius: 'b', blast: 'high' as const, files: ['src/x.ts'] }]

  it('expiry permits R1 approve', () => {
    const decision = evaluateFinalGate(signals({ assumptions: lowBlast, deadlineExpired: true }))
    expect(decision).toMatchObject({ rule: 'R1', action: 'approve' })
  })

  it('expiry permits R2 extend', () => {
    const decision = evaluateCapHit(
      signals({ reviewResult: capHit(), trajectory: trajectory([3, 1]), deadlineExpired: true }),
    )
    expect(decision).toMatchObject({ rule: 'R2', action: 'extend' })
  })

  it('expiry suppresses R3 accept-items (stay pending)', () => {
    const decision = evaluateFinalGate(signals({ assumptions: [...lowBlast, ...highBlast], deadlineExpired: true }))
    expect(decision.action).toBe('gate')
  })
})

describe('ladder evidence digest', () => {
  it('is deterministic for identical signals and differs when signals differ', () => {
    const a = evaluateFinalGate(signals())
    const b = evaluateFinalGate(signals())
    const c = evaluateFinalGate(signals({ spentUsd: 1.5 }))
    expect(a.evidenceDigest).toBe(b.evidenceDigest)
    expect(a.evidenceDigest).not.toBe(c.evidenceDigest)
  })
})
