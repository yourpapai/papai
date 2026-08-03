// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AnalyticsAggregateV1Schema,
  AnalyticsEventV1Schema,
  llmCompletedFixture,
} from '../../../src/analytics/contracts.js'
import {
  decideEligibility,
  type AnalyticsLane,
  type CollectionEligibilityRef,
  type DeliveryGrantRef,
  type EligibilityDecision,
  type EligibilityInput,
  type SinkAssessment,
} from '../../../src/analytics/governance/eligibility.js'

const REF: CollectionEligibilityRef = {
  refKey: 'v1.c-ref',
  keyVersion: 'v1',
  generation: 3,
}
const GRANT: DeliveryGrantRef = {
  grantKey: 'v1.d-grant',
  keyVersion: 'v1',
  generation: 2,
}

const LOCAL_MODES = ['off', 'local_aggregate', 'local_pseudonymous'] as const
const LAWFUL_BASES = ['consent', 'legitimate_interest', null] as const
const PREFERENCES = ['unknown', 'allow', 'deny'] as const
const ACTOR_ROLES = ['admin', 'member', 'guest', 'system'] as const
const READINESS = [true, false] as const
const EFFECTIVE_TIMES = [1_600_000_000_000, null] as const
const LANES: readonly AnalyticsLane[] = [
  'off',
  'local_aggregate',
  'local_pseudonymous',
  'external_aggregate',
  'external_pseudonymous',
]

const APPROVED_SINK: SinkAssessment = {
  approved: true,
  capabilities: {
    callerControlledIdempotency: true,
    deterministicReconciliation: true,
    deleteActor: true,
  },
}

const SINK_VARIANTS: Record<string, SinkAssessment | null> = {
  none: null,
  unapproved: {
    approved: false,
    capabilities: {
      callerControlledIdempotency: true,
      deterministicReconciliation: true,
      deleteActor: true,
    },
  },
  no_idempotency: {
    approved: true,
    capabilities: {
      callerControlledIdempotency: false,
      deterministicReconciliation: true,
      deleteActor: true,
    },
  },
  no_reconciliation: {
    approved: true,
    capabilities: {
      callerControlledIdempotency: true,
      deterministicReconciliation: false,
      deleteActor: true,
    },
  },
  no_delete: {
    approved: true,
    capabilities: {
      callerControlledIdempotency: true,
      deterministicReconciliation: true,
      deleteActor: false,
    },
  },
  approved_full: APPROVED_SINK,
}

const SINK_NAMES = Object.keys(SINK_VARIANTS)

const NOW_MS = 1_700_000_000_000

const isPseudonymous = (lane: AnalyticsLane): boolean =>
  lane === 'local_pseudonymous' || lane === 'external_pseudonymous'

type Cell = Readonly<{
  input: EligibilityInput
  decision: EligibilityDecision
}>

const TOTAL_CELLS =
  LANES.length *
  LOCAL_MODES.length *
  LAWFUL_BASES.length *
  PREFERENCES.length *
  PREFERENCES.length *
  ACTOR_ROLES.length *
  READINESS.length *
  SINK_NAMES.length *
  EFFECTIVE_TIMES.length

const buildInput = (index: number): EligibilityInput => {
  let remainder = index
  const pick = <T>(values: readonly T[]): T => {
    const value = values[remainder % values.length]
    remainder = Math.floor(remainder / values.length)
    if (value === undefined) throw new Error('matrix dimension index out of range')
    return value
  }
  const sinkName = pick(SINK_NAMES)
  return {
    lane: pick(LANES),
    killSwitchActive: false,
    localMode: pick(LOCAL_MODES),
    externalAggregateEnabled: true,
    externalPseudonymousEnabled: true,
    lawfulBasis: pick(LAWFUL_BASES),
    governanceReady: pick(READINESS),
    policyVersion: 7,
    policyEffectiveAtMs: pick(EFFECTIVE_TIMES),
    nowMs: NOW_MS,
    actorRole: pick(ACTOR_ROLES),
    localPreference: pick(PREFERENCES),
    externalPreference: pick(PREFERENCES),
    sink: SINK_VARIANTS[sinkName] ?? null,
    collectionEligibility: REF,
    deliveryGrant: GRANT,
  }
}

const buildCells = (): Cell[] => {
  const cells: Cell[] = []
  for (let index = 0; index < TOTAL_CELLS; index += 1) {
    const input = buildInput(index)
    cells.push({ input, decision: decideEligibility(input) })
  }
  return cells
}

const isAllowed = (cell: Cell): boolean => cell.decision.allowed

const isAllowedAggregate = (cell: Cell): boolean => cell.decision.allowed && !isPseudonymous(cell.input.lane)

const isAllowedPseudonymous = (cell: Cell): boolean => cell.decision.allowed && isPseudonymous(cell.input.lane)

const collectionRefOf = (cell: Cell): CollectionEligibilityRef | null =>
  cell.decision.allowed ? cell.decision.collectionEligibility : null

const deliveryGrantOf = (cell: Cell): DeliveryGrantRef | null =>
  cell.decision.allowed ? cell.decision.deliveryGrant : null

const hasCurrentCollectionRef = (cell: Cell): boolean => {
  const ref = collectionRefOf(cell)
  return (
    ref !== null && ref.refKey === REF.refKey && ref.keyVersion === REF.keyVersion && ref.generation === REF.generation
  )
}

const refsAreNull = (cell: Cell): boolean => collectionRefOf(cell) === null && deliveryGrantOf(cell) === null

const deliveryGrantMatchesLane = (cell: Cell): boolean => {
  if (!cell.decision.allowed) return true
  if (cell.input.lane === 'external_pseudonymous') {
    const grant = deliveryGrantOf(cell)
    return (
      grant !== null &&
      grant.grantKey === GRANT.grantKey &&
      grant.keyVersion === GRANT.keyVersion &&
      grant.generation === GRANT.generation
    )
  }
  return deliveryGrantOf(cell) === null
}

const isGuestPseudonymousDenial = (cell: Cell): boolean =>
  cell.input.actorRole !== 'guest' || !isPseudonymous(cell.input.lane) || !cell.decision.allowed

const isGuestLongitudinalReasonOnEnabledLane = (cell: Cell): boolean => {
  if (cell.input.actorRole !== 'guest') return true
  if (cell.input.lane === 'local_pseudonymous' && cell.input.localMode === 'local_pseudonymous') {
    return !cell.decision.allowed && cell.decision.reason === 'guest_longitudinal'
  }
  if (cell.input.lane === 'external_pseudonymous' && cell.input.externalPseudonymousEnabled) {
    return !cell.decision.allowed && cell.decision.reason === 'guest_longitudinal'
  }
  return true
}

const expectedDecision = (input: EligibilityInput): EligibilityDecision => {
  const denied = (reason: Extract<EligibilityDecision, { allowed: false }>['reason']): EligibilityDecision => ({
    allowed: false,
    reason,
  })

  if (input.killSwitchActive) return denied('kill_switch')
  if (input.lane === 'off') return denied('mode_off')
  if (input.lane === 'local_aggregate' && input.localMode === 'off') return denied('mode_off')
  if (input.lane === 'local_pseudonymous' && input.localMode !== 'local_pseudonymous') return denied('mode_off')
  if (input.lane === 'external_aggregate' && !input.externalAggregateEnabled) return denied('mode_off')
  if (input.lane === 'external_pseudonymous' && !input.externalPseudonymousEnabled) return denied('mode_off')

  if (input.actorRole === 'guest') {
    if (isPseudonymous(input.lane)) return denied('guest_longitudinal')
    return {
      allowed: true,
      lane: input.lane,
      policyVersion: input.policyVersion,
      collectionEligibility: null,
      deliveryGrant: null,
    }
  }

  if (!isPseudonymous(input.lane)) {
    return {
      allowed: true,
      lane: input.lane,
      policyVersion: input.policyVersion,
      collectionEligibility: null,
      deliveryGrant: null,
    }
  }

  if (!input.governanceReady) return denied('governance_incomplete')

  if (input.lane === 'local_pseudonymous') {
    if (input.localPreference === 'deny') return denied('preference_denied')
    if (input.localPreference === 'unknown') {
      const nonConsentAdmits =
        input.lawfulBasis === 'legitimate_interest' &&
        input.policyEffectiveAtMs !== null &&
        input.nowMs >= input.policyEffectiveAtMs
      if (!nonConsentAdmits) return denied('preference_unknown')
    }
  } else {
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
  }

  if (input.collectionEligibility === null) return denied('governance_incomplete')
  if (input.lane === 'external_pseudonymous' && input.deliveryGrant === null) return denied('governance_incomplete')

  return {
    allowed: true,
    lane: input.lane,
    policyVersion: input.policyVersion,
    collectionEligibility: input.collectionEligibility,
    deliveryGrant: input.lane === 'external_pseudonymous' ? input.deliveryGrant : null,
  }
}

describe('eligibility matrix', () => {
  const cells = buildCells()

  test('full Cartesian fixture matches the mandated decision for every cell', () => {
    expect(cells).toHaveLength(5 * 3 * 3 * 3 * 3 * 4 * 2 * 6 * 2)
    for (const cell of cells) {
      expect(cell.decision).toEqual(expectedDecision(cell.input))
    }
  })

  test('every allowed pseudonymous decision carries the current collection ref', () => {
    const allowedPseudonymous = cells.filter(isAllowedPseudonymous)
    expect(allowedPseudonymous.length).toBeGreaterThan(0)
    expect(allowedPseudonymous.every(hasCurrentCollectionRef)).toBe(true)
  })

  test('aggregate lanes always carry null refs', () => {
    const allowedAggregate = cells.filter(isAllowedAggregate)
    expect(allowedAggregate.length).toBeGreaterThan(0)
    expect(allowedAggregate.every(refsAreNull)).toBe(true)
  })

  test('only external pseudonymous carries a delivery grant', () => {
    expect(cells.filter(isAllowed).every(deliveryGrantMatchesLane)).toBe(true)
  })

  test('guests never reach either pseudonymous lane in any combination', () => {
    expect(cells.every(isGuestPseudonymousDenial)).toBe(true)
    expect(cells.every(isGuestLongitudinalReasonOnEnabledLane)).toBe(true)
  })

  test('kill switch denies every lane', () => {
    for (const lane of LANES) {
      const decision = decideEligibility({
        lane,
        killSwitchActive: true,
        localMode: 'local_pseudonymous',
        externalAggregateEnabled: true,
        externalPseudonymousEnabled: true,
        lawfulBasis: 'consent',
        governanceReady: true,
        policyVersion: 7,
        policyEffectiveAtMs: 1_600_000_000_000,
        nowMs: NOW_MS,
        actorRole: 'admin',
        localPreference: 'allow',
        externalPreference: 'allow',
        sink: APPROVED_SINK,
        collectionEligibility: REF,
        deliveryGrant: GRANT,
      })
      expect(decision).toEqual({ allowed: false, reason: 'kill_switch' })
    }
  })

  test('operator switch off denies external pseudonymous as mode_off even with allow and an approved sink', () => {
    const decision = decideEligibility({
      lane: 'external_pseudonymous',
      killSwitchActive: false,
      localMode: 'local_pseudonymous',
      externalAggregateEnabled: true,
      externalPseudonymousEnabled: false,
      lawfulBasis: 'consent',
      governanceReady: true,
      policyVersion: 7,
      policyEffectiveAtMs: 1_600_000_000_000,
      nowMs: NOW_MS,
      actorRole: 'admin',
      localPreference: 'allow',
      externalPreference: 'allow',
      sink: APPROVED_SINK,
      collectionEligibility: REF,
      deliveryGrant: GRANT,
    })
    expect(decision).toEqual({ allowed: false, reason: 'mode_off' })
  })

  test('documented non-consent mode admits unknown locally only after policy effective time', () => {
    const base = {
      lane: 'local_pseudonymous' as const,
      killSwitchActive: false,
      localMode: 'local_pseudonymous' as const,
      externalAggregateEnabled: false,
      externalPseudonymousEnabled: false,
      lawfulBasis: 'legitimate_interest' as const,
      governanceReady: true,
      policyVersion: 7,
      actorRole: 'member' as const,
      localPreference: 'unknown' as const,
      externalPreference: 'unknown' as const,
      sink: null,
      collectionEligibility: REF,
      deliveryGrant: null,
    }
    const before = decideEligibility({
      ...base,
      policyEffectiveAtMs: NOW_MS + 1000,
      nowMs: NOW_MS,
    })
    expect(before).toEqual({ allowed: false, reason: 'preference_unknown' })

    const after = decideEligibility({
      ...base,
      policyEffectiveAtMs: NOW_MS - 1000,
      nowMs: NOW_MS,
    })
    expect(after.allowed).toBe(true)

    const denied = decideEligibility({
      ...base,
      localPreference: 'deny',
      policyEffectiveAtMs: NOW_MS - 1000,
      nowMs: NOW_MS,
    })
    expect(denied).toEqual({ allowed: false, reason: 'preference_denied' })
  })

  test('missing refs fail closed for otherwise eligible pseudonymous decisions', () => {
    const local = decideEligibility({
      lane: 'local_pseudonymous',
      killSwitchActive: false,
      localMode: 'local_pseudonymous',
      externalAggregateEnabled: false,
      externalPseudonymousEnabled: false,
      lawfulBasis: 'consent',
      governanceReady: true,
      policyVersion: 7,
      policyEffectiveAtMs: 1_600_000_000_000,
      nowMs: NOW_MS,
      actorRole: 'admin',
      localPreference: 'allow',
      externalPreference: 'unknown',
      sink: null,
      collectionEligibility: null,
      deliveryGrant: null,
    })
    expect(local).toEqual({ allowed: false, reason: 'governance_incomplete' })
  })

  test('canonical contracts reject the operational refs', () => {
    const withRef = AnalyticsEventV1Schema.safeParse({
      ...llmCompletedFixture,
      collectionEligibility: REF,
    })
    expect(withRef.success).toBe(false)

    const aggregate = {
      schema: { name: 'papai.analytics.aggregate', version: 1 },
      bucket: {
        utc_day: '2026-01-01',
        definition_version: 1,
        finalized: false,
      },
      dimensions: {
        platform: 'telegram',
        context_type: 'dm',
        actor_role: 'admin',
        task_provider: 'none',
        app_version: '6.10.0',
      },
      measure: { kind: 'counter', metric: 'message_accepted', value: 1 },
      quality: {
        source: 'live',
        partial_day: false,
        restart_gap_detected: false,
        reconciliation: 'complete_epoch',
        late_event_count: 0,
      },
      disclosure: {
        scope: 'local_only',
        contributor_basis: 'not_required',
        contributor_count: null,
        threshold: null,
      },
    }
    const parsed = AnalyticsAggregateV1Schema.safeParse(aggregate)
    expect(parsed.success).toBe(true)
    const withGrant = AnalyticsAggregateV1Schema.safeParse({
      ...aggregate,
      deliveryGrant: GRANT,
    })
    expect(withGrant.success).toBe(false)
  })
})
