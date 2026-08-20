// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatDateTime } from '../../shared/helpers.js'

export type AnalyticsLane = 'localLongitudinal' | 'externalPseudonymous'
export type AnalyticsChoice = 'allow' | 'deny' | 'unknown'
export type LawfulBasisMode = 'consent' | 'legitimate_interest'
export type DeleteStatus = 'completed' | 'in_progress' | 'failed' | 'requested'

export interface LaneHintInput {
  lane: AnalyticsLane
  value: AnalyticsChoice
  effectiveAtMs: number | null
  lawfulBasisMode: LawfulBasisMode | null
  policyEffectiveAtMs: number | null
  nowMs: number
}

/**
 * Whether an unrecorded choice admits collection on this lane. Mirrors
 * `src/analytics/governance/eligibility.ts:99-111`: the external lane denies on unset
 * unconditionally, while the local lane admits it under legitimate interest once the
 * published policy's effective date has passed. Saying "off until you choose" here would
 * be false on exactly that deployment.
 */
function unsetAdmitsCollection(input: LaneHintInput): boolean {
  if (input.lane !== 'localLongitudinal') return false
  if (input.lawfulBasisMode !== 'legitimate_interest') return false
  if (input.policyEffectiveAtMs === null) return false
  return input.nowMs >= input.policyEffectiveAtMs
}

function since(effectiveAtMs: number | null): string {
  return effectiveAtMs === null ? '.' : ` since ${formatDateTime(effectiveAtMs)}.`
}

export function laneHint(input: LaneHintInput): string {
  if (input.value === 'allow') return `Allowed${since(input.effectiveAtMs)}`
  if (input.value === 'deny') return `Denied${since(input.effectiveAtMs)}`
  const noun = input.lane === 'localLongitudinal' ? 'local' : 'external'
  return unsetAdmitsCollection(input)
    ? `No choice recorded — ${noun} analytics are collected until you deny them.`
    : `No choice recorded — ${noun} analytics stay off until you allow them.`
}

const DELETE_MESSAGES: Record<DeleteStatus, { tone: 'status' | 'alert'; text: string }> = {
  completed: { tone: 'status', text: 'Your analytics data has been deleted. Analytics stores only.' },
  in_progress: { tone: 'status', text: 'Deletion is under way. Analytics stores only.' },
  requested: { tone: 'status', text: 'Deletion has been requested. Analytics stores only.' },
  failed: { tone: 'alert', text: 'Deletion failed — your analytics data was not removed. Try again shortly.' },
}

export function deleteStatusMessage(status: DeleteStatus): { tone: 'status' | 'alert'; text: string } {
  return DELETE_MESSAGES[status]
}

/**
 * Shown when the operator has not configured the governance keyring. Deliberately does not
 * claim nothing is recorded: `eligibility.ts:136` short-circuits aggregate lanes before the
 * governance-readiness check, so aggregate counting continues regardless.
 */
export const RIGHTS_UNAVAILABLE_TEXT =
  'Your operator has not finished configuring analytics governance, so per-account choices, ' +
  'export and deletion are unavailable here. Aggregate analytics that never identify you may ' +
  'still be counted.'
