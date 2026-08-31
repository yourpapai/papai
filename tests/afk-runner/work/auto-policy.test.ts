// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { AutonomyConfig } from '../../../afk-runner/src/config.js'
import type { DigestRecord } from '../../../afk-runner/src/legacy-fold.js'
import {
  evaluateCapHit,
  evaluateEscalationGate,
  evaluateFinalGate,
  projectedSpend,
} from '../../../afk-runner/src/work/auto-policy.js'
import type { PolicySignals } from '../../../afk-runner/src/work/auto-policy.js'
import type { ReviewLoopResult } from '../../../afk-runner/src/work/review-loop.js'

const CHANGE_DIR = 'openspec/changes/thing'

function autonomy(overrides: Partial<AutonomyConfig> = {}): AutonomyConfig {
  return { level: 'assist', costCeilingUsd: 5, metered: true, ...overrides }
}

function converged(overrides: Partial<ReviewLoopResult> = {}): ReviewLoopResult {
  return {
    outcome: 'converged',
    rounds: 2,
    verdict: 'converged',
    raised: { blocker: 0, material: 0, nitpick: 0 },
    openBlockers: [],
    openMaterial: [],
    openNitpicks: [],
    ...overrides,
  }
}

function capHit(overrides: Partial<ReviewLoopResult> = {}): ReviewLoopResult {
  return {
    outcome: 'cap-hit',
    rounds: 3,
    verdict: 'open',
    raised: { blocker: 0, material: 1, nitpick: 0 },
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
    expect(decision).toMatchObject({ rule: 'R1', action: 'approve' })
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
    expect(decision).toMatchObject({ rule: 'R3', action: 'accept-items' })
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
})

describe('R4 metered carve-out (unmetered semantics)', () => {
  const lowBlast = [
    { id: 'A1', text: 't', blastRadius: 'b', blast: 'low' as const, files: [`${CHANGE_DIR}/proposal.md`] },
  ]
  const unmetered = autonomy({ costCeilingUsd: null, metered: false })

  it('unmetered + unknown cost + R2 predicate → R2 extend decides; R4 does not veto', () => {
    const decision = evaluateCapHit(
      signals({
        config: unmetered,
        costKnown: false,
        reviewResult: capHit(),
        trajectory: trajectory([3, 1]),
      }),
    )
    expect(decision).toMatchObject({ rule: 'R2', action: 'extend' })
  })

  it('unmetered + unknown cost + R1-eligible final gate → R1 approves', () => {
    const decision = evaluateFinalGate(signals({ config: unmetered, costKnown: false, assumptions: lowBlast }))
    expect(decision).toMatchObject({ rule: 'R1', action: 'approve' })
  })

  it('unmetered + unknown cost + no decidable predicate → stays pending (gate by none)', () => {
    const decision = evaluateCapHit(
      signals({ config: unmetered, costKnown: false, reviewResult: capHit(), trajectory: trajectory([2, 2]) }),
    )
    expect(decision).toMatchObject({ rule: 'none', action: 'gate' })
  })

  it('metered + unknown cost gates exactly as today in every evaluator', () => {
    expect(
      evaluateCapHit(signals({ costKnown: false, reviewResult: capHit(), trajectory: trajectory([3, 1]) })),
    ).toMatchObject({
      rule: 'R4',
      action: 'gate',
    })
    expect(evaluateFinalGate(signals({ costKnown: false, assumptions: lowBlast }))).toMatchObject({
      rule: 'R4',
      action: 'gate',
    })
  })

  it('numeric exceedance gates in both modes — an explicit ceiling is never bypassed', () => {
    const declaredUnmetered = autonomy({ metered: false })
    expect(
      evaluateCapHit(
        signals({ config: declaredUnmetered, reviewResult: capHit(), trajectory: trajectory([3, 1]), spentUsd: 4.9 }),
      ),
    ).toMatchObject({
      rule: 'R4',
      action: 'gate',
    })
    expect(evaluateFinalGate(signals({ assumptions: lowBlast, spentUsd: 4.9 }))).toMatchObject({
      rule: 'R4',
      action: 'gate',
    })
  })

  it('an unmetered run with no numeric ceiling never gates on spend projection', () => {
    const decision = evaluateFinalGate(signals({ config: unmetered, assumptions: lowBlast, spentUsd: 100 }))
    expect(decision).toMatchObject({ rule: 'R1', action: 'approve' })
  })
})

describe('escalation ladder under unmetered configs (D2)', () => {
  it('a null ceiling falls through to rule none — no over-ceiling veto without a number', () => {
    const decision = evaluateEscalationGate({
      spentUsd: 100,
      costKnown: true,
      config: autonomy({ costCeilingUsd: null, metered: false }),
    })
    expect(decision).toMatchObject({ rule: 'none', action: 'gate' })
  })

  it('unknown cost keeps R5 suppression regardless of metered', () => {
    const unmetered = autonomy({ costCeilingUsd: null, metered: false })
    expect(evaluateEscalationGate({ spentUsd: 1, costKnown: false, config: unmetered })).toMatchObject({
      rule: 'R5',
      action: 'gate',
    })
    expect(evaluateEscalationGate({ spentUsd: 1, costKnown: false, config: autonomy() })).toMatchObject({
      rule: 'R5',
      action: 'gate',
    })
  })
})

describe('evaluateCapHit (R2)', () => {
  it('extends on a strictly decreasing burndown with open MATERIALs and budget headroom', () => {
    const decision = evaluateCapHit(signals({ reviewResult: capHit(), trajectory: trajectory([3, 1]) }))
    expect(decision).toMatchObject({ rule: 'R2', action: 'extend' })
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

  it('extends regardless of prior extend count: trajectory window and budget are the sole bounds', () => {
    const decision = evaluateCapHit(
      signals({ reviewResult: capHit(), trajectory: trajectory([5, 3, 1]), autoExtendsUsed: 4 }),
    )
    expect(decision).toMatchObject({ rule: 'R2', action: 'extend' })
  })

  it('does not extend when projected spend would cross the ceiling', () => {
    const decision = evaluateCapHit(signals({ reviewResult: capHit(), trajectory: trajectory([3, 1]), spentUsd: 4.9 }))
    expect(decision).toMatchObject({ rule: 'R4', action: 'gate' })
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

describe('projectedSpend (exported for the verification-round guard)', () => {
  it('projects one more round at the median cost of a completed round', () => {
    expect(projectedSpend({ spentUsd: 0.6, rounds: 3 })).toBeCloseTo(0.8)
  })

  it('falls back to the conservative constant when no rounds are recorded', () => {
    expect(projectedSpend({ spentUsd: 0.2, rounds: 0 })).toBeCloseTo(0.7)
  })
})
