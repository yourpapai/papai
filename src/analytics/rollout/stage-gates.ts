// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assessSink } from '../delivery/sink.js'
import type { AssessSinkInput } from '../delivery/sink.js'
import type { GovernanceReadiness } from '../governance/policy-store.js'

export const REQUIRED_PRIVACY_CONTROLS = 17
export const STAGE_B_REQUIRED_CONSECUTIVE_WEEKS = 2

const UTC_WEEK_DAYS = 7
const DAY_MS = 86_400_000

export type StageAEvidence = Readonly<{
  greenControls: readonly number[]
  reconciliationZeroDelta: boolean
  snapshotBytesVerified: boolean
  deletionDrillComplete: boolean
  rekeyDrillComplete: boolean
  ownerSigned: boolean
}>

export type StageBReconciliationStatus = 'complete_epoch' | 'delta' | 'unreconciled_restart_gap'

export type StageBDayEvidence = Readonly<{
  utcDay: string
  completeUtcDay: boolean
  reconciliationStatus: StageBReconciliationStatus
}>

export type StageBWindow = Readonly<{
  longestEligibleRunDays: number
  consecutiveCompleteWeeks: number
}>

export type RolloutDecision = Readonly<{ allowed: true }> | Readonly<{ allowed: false; refusals: readonly string[] }>

export const isDayRolloutEligible = (day: StageBDayEvidence): boolean =>
  day.completeUtcDay && day.reconciliationStatus === 'complete_epoch'

const utcDayMs = (utcDay: string): number => Date.parse(`${utcDay}T00:00:00.000Z`)

export const assessStageBWindow = (days: readonly StageBDayEvidence[]): StageBWindow => {
  const sorted = [...days].sort((a, b) => utcDayMs(a.utcDay) - utcDayMs(b.utcDay))
  let longest = 0
  let run = 0
  let previousMs: number | null = null
  for (const day of sorted) {
    const ms = utcDayMs(day.utcDay)
    const adjacent = previousMs !== null && ms - previousMs === DAY_MS
    run = isDayRolloutEligible(day) ? (adjacent ? run + 1 : 1) : 0
    previousMs = ms
    if (run > longest) longest = run
  }
  return { longestEligibleRunDays: longest, consecutiveCompleteWeeks: Math.floor(longest / UTC_WEEK_DAYS) }
}

const decide = (refusals: readonly string[]): RolloutDecision =>
  refusals.length === 0 ? { allowed: true } : { allowed: false, refusals }

const stageARefusals = (evidence: StageAEvidence): readonly string[] => {
  const green = new Set(evidence.greenControls)
  const controlsComplete = Array.from({ length: REQUIRED_PRIVACY_CONTROLS }, (_, index) => index + 1).every((control) =>
    green.has(control),
  )
  return [
    ...(controlsComplete ? [] : ['stage_a_privacy_controls_incomplete']),
    ...(evidence.reconciliationZeroDelta ? [] : ['stage_a_reconciliation_delta']),
    ...(evidence.snapshotBytesVerified ? [] : ['stage_a_snapshot_unverified']),
    ...(evidence.deletionDrillComplete ? [] : ['stage_a_deletion_drill_incomplete']),
    ...(evidence.rekeyDrillComplete ? [] : ['stage_a_rekey_drill_incomplete']),
    ...(evidence.ownerSigned ? [] : ['stage_a_owner_signature_missing']),
  ]
}

export const assessStageAExit = (evidence: StageAEvidence): RolloutDecision => decide(stageARefusals(evidence))

export const assessStageBEntry = (input: Readonly<{ stageA: StageAEvidence }>): RolloutDecision =>
  assessStageAExit(input.stageA)

export const assessStageCEntry = (
  input: Readonly<{ governance: GovernanceReadiness; stageBDays: readonly StageBDayEvidence[] }>,
): RolloutDecision =>
  decide([
    ...(input.governance.ready ? [] : ['governance_incomplete']),
    ...(assessStageBWindow(input.stageBDays).consecutiveCompleteWeeks >= STAGE_B_REQUIRED_CONSECUTIVE_WEEKS
      ? []
      : ['stage_b_window_incomplete']),
  ])

export const assessStageDEntry = (input: Readonly<{ aggregateAssessmentComplete: boolean }>): RolloutDecision =>
  decide(input.aggregateAssessmentComplete ? [] : ['aggregate_assessment_missing'])

export const assessStageEEntry = (
  input: Readonly<{ actorExternalPseudonymousAllow: boolean; sink: AssessSinkInput }>,
): RolloutDecision => {
  const gate = assessSink(input.sink)
  return decide([
    ...(input.actorExternalPseudonymousAllow ? [] : ['actor_not_allowed']),
    ...(gate.approved ? [] : [`sink_${gate.reason}`]),
  ])
}
