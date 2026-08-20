// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  deriveCollectionRefKey,
  getEligibilityRef,
  grantEligibilityInTx,
  revokeEligibilityInTx,
} from '../../../src/analytics/governance/collection-store.js'
import { decideEligibility } from '../../../src/analytics/governance/eligibility.js'
import type { EligibilityInput } from '../../../src/analytics/governance/eligibility.js'
import { deriveGovernanceActorKey, setPreference } from '../../../src/analytics/governance/preference-store.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { GKEYS, IDENTITY_A, T } from '../subject-fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const APPROVED_SINK: EligibilityInput['sink'] = {
  approved: true,
  capabilities: {
    callerControlledIdempotency: true,
    deterministicReconciliation: true,
    deleteActor: true,
  },
}

/**
 * The ref key exactly as `readCollectionRef` in start-analytics.ts derives it:
 * governance active key, active version, and the subject's platform pair. A
 * test that derived it any other way would prove nothing about the path the
 * runtime actually takes.
 */
const runtimeRefKey = (): string =>
  deriveCollectionRefKey({
    key: GKEYS.v3,
    keyVersion: 'v3',
    platformInstanceId: IDENTITY_A.platformInstanceId,
    platformUserId: IDENTITY_A.platformUserId,
  })

const decisionFor = (
  db: Db,
  lane: 'local_pseudonymous' | 'external_pseudonymous',
  overrides: Partial<EligibilityInput> = {},
): ReturnType<typeof decideEligibility> =>
  decideEligibility({
    lane,
    killSwitchActive: false,
    localMode: 'local_pseudonymous',
    externalAggregateEnabled: true,
    externalPseudonymousEnabled: true,
    lawfulBasis: 'consent',
    governanceReady: true,
    policyVersion: 3,
    policyEffectiveAtMs: T - 1,
    nowMs: T,
    actorRole: 'member',
    localPreference: 'allow',
    externalPreference: 'allow',
    sink: APPROVED_SINK,
    collectionEligibility: getEligibilityRef(runtimeRefKey(), { getDrizzleDb: () => db }),
    deliveryGrant: { grantKey: 'v3.grant', keyVersion: 'v3', generation: 1 },
    ...overrides,
  })

const denialReasonOf = (decision: ReturnType<typeof decideEligibility>): string =>
  decision.allowed ? 'allowed' : decision.reason

const eligibilityRows = (db: Db): readonly (typeof schema.analyticsCollectionEligibility.$inferSelect)[] =>
  db.select().from(schema.analyticsCollectionEligibility).all()

describe('collection eligibility without a grant', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  const storeConsent = (): void => {
    const governanceActorKey = deriveGovernanceActorKey({
      key: GKEYS.v3,
      keyVersion: 'v3',
      platformInstanceId: IDENTITY_A.platformInstanceId,
      platformUserId: IDENTITY_A.platformUserId,
    })
    // Hoisted out of the loop: the arrow closes over the per-test `db`, which is
    // reassigned in beforeEach.
    const storeDeps = { getDrizzleDb: (): Db => db }
    for (const lane of ['local_longitudinal', 'external_pseudonymous'] as const) {
      setPreference(
        {
          governanceActorKey,
          keyVersion: 'v3',
          lane,
          value: 'allow',
          policyVersion: 3,
          source: 'settings',
          nowMs: T,
        },
        storeDeps,
      )
    }
  }

  test('a stored pseudonymous preference alone never admits collection', () => {
    storeConsent()

    // Named explicitly: `governance_incomplete` is the reason an operator sees in
    // the field, and it is what distinguishes a missing eligibility ref from a
    // subject who declined (`preference_denied`).
    expect(denialReasonOf(decisionFor(db, 'local_pseudonymous'))).toBe('governance_incomplete')
    expect(denialReasonOf(decisionFor(db, 'external_pseudonymous'))).toBe('governance_incomplete')
  })

  test('reading the decision creates no eligibility row', () => {
    storeConsent()
    decisionFor(db, 'external_pseudonymous')

    expect(eligibilityRows(db)).toHaveLength(0)
  })
})

describe('grantEligibilityInTx', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  const grant = (nowMs = T): Readonly<{ generation: number }> =>
    db.transaction((tx) =>
      grantEligibilityInTx(tx, { refKey: runtimeRefKey(), keyVersion: 'v3', policyVersion: 3, nowMs }),
    )

  test('writes an allow row the ordinary reader resolves', () => {
    const { generation } = grant()

    const ref = getEligibilityRef(runtimeRefKey(), { getDrizzleDb: () => db })
    expect(ref).toEqual({ refKey: runtimeRefKey(), keyVersion: 'v3', generation })
  })

  test('a repeated grant is idempotent and does not advance the generation', () => {
    const first = grant()
    const second = grant(T + 1000)

    expect(second.generation).toBe(first.generation)
    expect(eligibilityRows(db)).toHaveLength(1)
  })

  test('re-granting after a revoke advances the generation past the revoked one', () => {
    const granted = grant()
    const revoked = db.transaction((tx) =>
      revokeEligibilityInTx(tx, { refKey: runtimeRefKey(), policyVersion: 3, nowMs: T + 1 }),
    )
    const regranted = grant(T + 2)

    // Revoking advances the generation, which is what orphans events associated
    // under the old one: recheckAndAssociateEvent matches on generation. The
    // re-grant then keeps that advanced number rather than stepping again --
    // nothing was ever associable while the row read 'deny', so there is no
    // second generation to step past, and this matches setEligibilityState.
    expect(revoked).not.toBeNull()
    expect(revoked?.generation).toBe(granted.generation + 1)
    expect(regranted.generation).toBe(granted.generation + 1)
    expect(getEligibilityRef(runtimeRefKey(), { getDrizzleDb: () => db })?.generation).toBe(regranted.generation)
  })

  test('clears the revocation timestamp so the row does not read as revoked', () => {
    grant()
    db.transaction((tx) => revokeEligibilityInTx(tx, { refKey: runtimeRefKey(), policyVersion: 3, nowMs: T + 1 }))
    grant(T + 2)

    expect(eligibilityRows(db)[0]?.revokedAt).toBeNull()
  })

  test('persists the derived pseudonym and no raw subject identifier', () => {
    grant()

    const row = eligibilityRows(db)[0]
    expect(row?.refKey).toBe(runtimeRefKey())
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain(IDENTITY_A.platformUserId)
    expect(serialized).not.toContain(IDENTITY_A.platformInstanceId)
    expect(serialized).not.toContain(GKEYS.v3.toString('hex'))
  })
})
