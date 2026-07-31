// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type AnalyticsLane =
  | 'off'
  | 'local_aggregate'
  | 'local_pseudonymous'
  | 'external_aggregate'
  | 'external_pseudonymous'

export type CollectionEligibilityRef = Readonly<{
  refKey: string
  keyVersion: string
  generation: number
}>

export type DeliveryGrantRef = Readonly<{
  grantKey: string
  keyVersion: string
  generation: number
}>

export type EligibilityDecision =
  | Readonly<{
      allowed: true
      lane: Exclude<AnalyticsLane, 'off'>
      policyVersion: number
      collectionEligibility: CollectionEligibilityRef | null
      deliveryGrant: DeliveryGrantRef | null
    }>
  | Readonly<{
      allowed: false
      reason:
        | 'kill_switch'
        | 'mode_off'
        | 'guest_longitudinal'
        | 'governance_incomplete'
        | 'preference_unknown'
        | 'preference_denied'
        | 'sink_unapproved'
        | 'sink_missing_delete'
    }>

export type SinkAssessment = Readonly<{
  approved: boolean
  capabilities: Readonly<{
    callerControlledIdempotency: boolean
    deterministicReconciliation: boolean
    deleteActor: boolean
  }>
}>

export type EligibilityInput = Readonly<{
  lane: AnalyticsLane
  killSwitchActive: boolean
  localMode: 'off' | 'local_aggregate' | 'local_pseudonymous'
  externalAggregateEnabled: boolean
  externalPseudonymousEnabled: boolean
  lawfulBasis: 'consent' | 'legitimate_interest' | null
  governanceReady: boolean
  policyVersion: number
  policyEffectiveAtMs: number | null
  nowMs: number
  actorRole: 'admin' | 'member' | 'guest' | 'system'
  localPreference: 'unknown' | 'allow' | 'deny'
  externalPreference: 'unknown' | 'allow' | 'deny'
  sink: SinkAssessment | null
  collectionEligibility: CollectionEligibilityRef | null
  deliveryGrant: DeliveryGrantRef | null
}>

type DenialReason = Extract<EligibilityDecision, { allowed: false }>['reason']

const denied = (reason: DenialReason): EligibilityDecision => ({
  allowed: false,
  reason,
})

const isPseudonymousLane = (lane: AnalyticsLane): boolean =>
  lane === 'local_pseudonymous' || lane === 'external_pseudonymous'

const laneEnabled = (input: EligibilityInput, lane: Exclude<AnalyticsLane, 'off'>): boolean => {
  if (lane === 'local_aggregate') return input.localMode !== 'off'
  if (lane === 'local_pseudonymous') return input.localMode === 'local_pseudonymous'
  if (lane === 'external_aggregate') return input.externalAggregateEnabled
  return input.externalPseudonymousEnabled
}

const aggregateDecision = (input: EligibilityInput, lane: Exclude<AnalyticsLane, 'off'>): EligibilityDecision => ({
  allowed: true,
  lane,
  policyVersion: input.policyVersion,
  collectionEligibility: null,
  deliveryGrant: null,
})

const checkLocalPreference = (input: EligibilityInput): EligibilityDecision | null => {
  if (input.localPreference === 'deny') return denied('preference_denied')
  if (input.localPreference === 'allow') return null
  const nonConsentAdmitsUnknown =
    input.lawfulBasis === 'legitimate_interest' &&
    input.policyEffectiveAtMs !== null &&
    input.nowMs >= input.policyEffectiveAtMs
  return nonConsentAdmitsUnknown ? null : denied('preference_unknown')
}

const checkExternalPreferenceAndSink = (input: EligibilityInput): EligibilityDecision | null => {
  if (input.externalPreference === 'deny') return denied('preference_denied')
  if (input.externalPreference !== 'allow') return denied('preference_unknown')
  const sink = input.sink
  if (
    sink === null ||
    !sink.approved ||
    !sink.capabilities.callerControlledIdempotency ||
    !sink.capabilities.deterministicReconciliation
  ) {
    return denied('sink_unapproved')
  }
  if (!sink.capabilities.deleteActor) return denied('sink_missing_delete')
  return null
}

export function decideEligibility(input: EligibilityInput): EligibilityDecision {
  if (input.killSwitchActive) return denied('kill_switch')
  if (input.lane === 'off') return denied('mode_off')
  const lane = input.lane
  if (!laneEnabled(input, lane)) return denied('mode_off')

  if (input.actorRole === 'guest') {
    if (isPseudonymousLane(lane)) return denied('guest_longitudinal')
    return aggregateDecision(input, lane)
  }

  if (!isPseudonymousLane(lane)) return aggregateDecision(input, lane)

  if (!input.governanceReady) return denied('governance_incomplete')

  const gate = lane === 'local_pseudonymous' ? checkLocalPreference(input) : checkExternalPreferenceAndSink(input)
  if (gate !== null) return gate

  if (input.collectionEligibility === null) return denied('governance_incomplete')
  if (lane === 'external_pseudonymous' && input.deliveryGrant === null) {
    return denied('governance_incomplete')
  }

  return {
    allowed: true,
    lane,
    policyVersion: input.policyVersion,
    collectionEligibility: input.collectionEligibility,
    deliveryGrant: lane === 'external_pseudonymous' ? input.deliveryGrant : null,
  }
}
