// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { isPrimarySuppressed } from '../../src/analytics/delivery/release-suppression.js'
import type { ReleaseCellInput } from '../../src/analytics/delivery/release-suppression.js'
import { OPENPANEL_ASSESSED_CAPABILITIES } from '../../src/analytics/delivery/sink.js'
import type { AssessSinkInput, SinkCapabilities } from '../../src/analytics/delivery/sink.js'
import type { GovernanceReadiness } from '../../src/analytics/governance/policy-store.js'
import {
  assessStageAExit,
  assessStageBEntry,
  assessStageBWindow,
  assessStageCEntry,
  assessStageDEntry,
  assessStageEEntry,
  isDayRolloutEligible,
  REQUIRED_PRIVACY_CONTROLS,
  STAGE_B_REQUIRED_CONSECUTIVE_WEEKS,
} from '../../src/analytics/rollout/stage-gates.js'
import type { StageAEvidence, StageBDayEvidence } from '../../src/analytics/rollout/stage-gates.js'

const DAY_MS = 86_400_000
const BASE_MS = Date.parse('2026-08-03T00:00:00.000Z')

const utcDayOfOffset = (offsetDays: number): string =>
  new Date(BASE_MS + offsetDays * DAY_MS).toISOString().slice(0, 10)

const day = (
  offsetDays: number,
  status: StageBDayEvidence['reconciliationStatus'] = 'complete_epoch',
): StageBDayEvidence => ({
  utcDay: utcDayOfOffset(offsetDays),
  completeUtcDay: true,
  reconciliationStatus: status,
})

const eligibleDays = (count: number, startOffset: number): readonly StageBDayEvidence[] =>
  Array.from({ length: count }, (_, index) => day(startOffset + index))

const FULL_STAGE_A: StageAEvidence = {
  greenControls: Array.from({ length: REQUIRED_PRIVACY_CONTROLS }, (_, index) => index + 1),
  reconciliationZeroDelta: true,
  snapshotBytesVerified: true,
  deletionDrillComplete: true,
  rekeyDrillComplete: true,
  ownerSigned: true,
}

const READY_GOVERNANCE: GovernanceReadiness = { ready: true, missing: [] }

const REVIEWED_PROCESSOR = {
  subprocessorReviewed: true,
  residencyReviewed: true,
  deletionPathReviewed: true,
  incidentReviewed: true,
  transferReviewed: true,
  noSecondaryUse: true,
} as const

const CAPABLE: SinkCapabilities = {
  callerControlledIdempotency: true,
  deterministicReconciliation: true,
  deleteActor: true,
}

const sinkInput = (capabilities: SinkCapabilities): AssessSinkInput => ({
  mode: 'pseudonymous',
  state: 'enabled',
  payloadSchemaVersion: 1,
  capabilities,
  processorReview: REVIEWED_PROCESSOR,
  httpsPolicyApproved: true,
})

const refusalsOf = (decision: { allowed: boolean; refusals?: readonly string[] }): readonly string[] =>
  decision.refusals ?? []

const gapCell = (reconciliationStatus: string): ReleaseCellInput => ({
  utcDay: '2026-08-03',
  metric: 'turn_started',
  measureKind: 'counter',
  dimensions: { platform: 'all', contextType: 'all', actorRole: 'all', taskProvider: 'all', appVersion: 'all' },
  counterValue: 250,
  finalized: true,
  partialDay: false,
  reconciliationStatus,
  contributorBasis: 'eligible_actor',
  contributorCount: 40,
})

describe('rollout gate constants', () => {
  test('the contract freezes 17 privacy controls and two consecutive Stage B weeks', () => {
    expect(REQUIRED_PRIVACY_CONTROLS).toBe(17)
    expect(STAGE_B_REQUIRED_CONSECUTIVE_WEEKS).toBe(2)
  })
})

describe('Stage A exit evidence', () => {
  test('allows exit only when every evidence item is present', () => {
    expect(assessStageAExit(FULL_STAGE_A)).toEqual({ allowed: true })
  })

  test('refuses when any privacy control is not green', () => {
    const decision = assessStageAExit({ ...FULL_STAGE_A, greenControls: FULL_STAGE_A.greenControls.slice(0, 16) })
    expect(decision.allowed).toBe(false)
    expect(refusalsOf(decision)).toContain('stage_a_privacy_controls_incomplete')
  })

  test('refuses on reconciliation delta, unverified snapshot, incomplete drills, or missing signature', () => {
    expect(refusalsOf(assessStageAExit({ ...FULL_STAGE_A, reconciliationZeroDelta: false }))).toContain(
      'stage_a_reconciliation_delta',
    )
    expect(refusalsOf(assessStageAExit({ ...FULL_STAGE_A, snapshotBytesVerified: false }))).toContain(
      'stage_a_snapshot_unverified',
    )
    expect(refusalsOf(assessStageAExit({ ...FULL_STAGE_A, deletionDrillComplete: false }))).toContain(
      'stage_a_deletion_drill_incomplete',
    )
    expect(refusalsOf(assessStageAExit({ ...FULL_STAGE_A, rekeyDrillComplete: false }))).toContain(
      'stage_a_rekey_drill_incomplete',
    )
    expect(refusalsOf(assessStageAExit({ ...FULL_STAGE_A, ownerSigned: false }))).toContain(
      'stage_a_owner_signature_missing',
    )
  })
})

describe('Stage B entry', () => {
  test('refuses Stage B without complete Stage A evidence', () => {
    const decision = assessStageBEntry({ stageA: { ...FULL_STAGE_A, reconciliationZeroDelta: false } })
    expect(decision.allowed).toBe(false)
    expect(refusalsOf(decision)).toContain('stage_a_reconciliation_delta')
  })

  test('admits Stage B with complete Stage A evidence', () => {
    expect(assessStageBEntry({ stageA: FULL_STAGE_A })).toEqual({ allowed: true })
  })
})

describe('restart-gap day eligibility', () => {
  test('a UTC day intersecting unreconciled_restart_gap is ineligible as Stage B evidence', () => {
    expect(isDayRolloutEligible(day(0))).toBe(true)
    expect(isDayRolloutEligible(day(0, 'delta'))).toBe(false)
    expect(isDayRolloutEligible(day(0, 'unreconciled_restart_gap'))).toBe(false)
    expect(isDayRolloutEligible({ ...day(0), completeUtcDay: false })).toBe(false)
  })

  test('a restart-gap day is ineligible for publication through release suppression', () => {
    expect(isPrimarySuppressed(gapCell('unreconciled_restart_gap'))).toBe(true)
    expect(isPrimarySuppressed(gapCell('complete_epoch'))).toBe(false)
  })
})

describe('Stage B evidence window', () => {
  test('counts only consecutive complete weeks of eligible days', () => {
    expect(assessStageBWindow([])).toEqual({ longestEligibleRunDays: 0, consecutiveCompleteWeeks: 0 })
    expect(assessStageBWindow(eligibleDays(7, 0))).toEqual({ longestEligibleRunDays: 7, consecutiveCompleteWeeks: 1 })
    expect(assessStageBWindow(eligibleDays(14, 0))).toEqual({ longestEligibleRunDays: 14, consecutiveCompleteWeeks: 2 })
  })

  test('a gap day restarts the window instead of being filled with crash loss', () => {
    const window = assessStageBWindow([
      ...eligibleDays(7, 0),
      day(7, 'unreconciled_restart_gap'),
      ...eligibleDays(7, 8),
    ])
    expect(window.consecutiveCompleteWeeks).toBe(1)
    const recovered = assessStageBWindow([
      ...eligibleDays(7, 0),
      day(7, 'unreconciled_restart_gap'),
      ...eligibleDays(14, 8),
    ])
    expect(recovered.consecutiveCompleteWeeks).toBe(2)
  })

  test('a delta day or a calendar hole breaks the consecutive run', () => {
    expect(
      assessStageBWindow([...eligibleDays(7, 0), day(7, 'delta'), ...eligibleDays(14, 8)]).consecutiveCompleteWeeks,
    ).toBe(2)
    expect(assessStageBWindow([...eligibleDays(7, 0), ...eligibleDays(14, 8)]).consecutiveCompleteWeeks).toBe(2)
  })
})

describe('Stage C entry', () => {
  test('refuses without governance readiness even with two complete weeks', () => {
    const decision = assessStageCEntry({
      governance: { ready: false, missing: ['analytics_keyring'] },
      stageBDays: eligibleDays(14, 0),
    })
    expect(decision.allowed).toBe(false)
    expect(refusalsOf(decision)).toContain('governance_incomplete')
  })

  test('refuses without two complete consecutive Stage B UTC weeks even with governance ready', () => {
    const oneWeek = assessStageCEntry({ governance: READY_GOVERNANCE, stageBDays: eligibleDays(7, 0) })
    expect(oneWeek.allowed).toBe(false)
    expect(refusalsOf(oneWeek)).toContain('stage_b_window_incomplete')
    const gapSplit = assessStageCEntry({
      governance: READY_GOVERNANCE,
      stageBDays: [...eligibleDays(7, 0), day(7, 'unreconciled_restart_gap'), ...eligibleDays(7, 8)],
    })
    expect(gapSplit.allowed).toBe(false)
    expect(refusalsOf(gapSplit)).toContain('stage_b_window_incomplete')
  })

  test('admits with governance ready and two new consecutive weeks after a gap', () => {
    const decision = assessStageCEntry({
      governance: READY_GOVERNANCE,
      stageBDays: [...eligibleDays(7, 0), day(7, 'unreconciled_restart_gap'), ...eligibleDays(14, 8)],
    })
    expect(decision).toEqual({ allowed: true })
  })
})

describe('Stage D entry', () => {
  test('refuses without the aggregate anonymization assessment', () => {
    const decision = assessStageDEntry({ aggregateAssessmentComplete: false })
    expect(decision.allowed).toBe(false)
    expect(refusalsOf(decision)).toContain('aggregate_assessment_missing')
  })

  test('admits with the aggregate assessment complete', () => {
    expect(assessStageDEntry({ aggregateAssessmentComplete: true })).toEqual({ allowed: true })
  })
})

describe('Stage E entry', () => {
  test('refuses without per-actor external_pseudonymous allow even with a capable sink', () => {
    const decision = assessStageEEntry({ actorExternalPseudonymousAllow: false, sink: sinkInput(CAPABLE) })
    expect(decision.allowed).toBe(false)
    expect(refusalsOf(decision)).toContain('actor_not_allowed')
  })

  test('the strict AND refuses a sink missing any one capability', () => {
    const noIdempotency = assessStageEEntry({
      actorExternalPseudonymousAllow: true,
      sink: sinkInput({ ...CAPABLE, callerControlledIdempotency: false }),
    })
    expect(refusalsOf(noIdempotency)).toContain('sink_missing_caller_controlled_idempotency')
    const noReconciliation = assessStageEEntry({
      actorExternalPseudonymousAllow: true,
      sink: sinkInput({ ...CAPABLE, deterministicReconciliation: false }),
    })
    expect(refusalsOf(noReconciliation)).toContain('sink_missing_deterministic_reconciliation')
    const noDelete = assessStageEEntry({
      actorExternalPseudonymousAllow: true,
      sink: sinkInput({ ...CAPABLE, deleteActor: false }),
    })
    expect(refusalsOf(noDelete)).toContain('sink_missing_delete_actor')
  })

  test('OpenPanel cannot satisfy Stage E with its documented capabilities', () => {
    const decision = assessStageEEntry({
      actorExternalPseudonymousAllow: true,
      sink: sinkInput(OPENPANEL_ASSESSED_CAPABILITIES),
    })
    expect(decision.allowed).toBe(false)
    const idempotencyOnly = assessStageEEntry({
      actorExternalPseudonymousAllow: true,
      sink: sinkInput({ ...OPENPANEL_ASSESSED_CAPABILITIES, callerControlledIdempotency: true }),
    })
    expect(idempotencyOnly.allowed).toBe(false)
    const deletionOnly = assessStageEEntry({
      actorExternalPseudonymousAllow: true,
      sink: sinkInput({ ...OPENPANEL_ASSESSED_CAPABILITIES, deleteActor: true }),
    })
    expect(deletionOnly.allowed).toBe(false)
  })

  test('admits with actor allow plus a sink passing the strict AND', () => {
    expect(assessStageEEntry({ actorExternalPseudonymousAllow: true, sink: sinkInput(CAPABLE) })).toEqual({
      allowed: true,
    })
  })
})
