// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { createContributorTracker } from '../../../src/analytics/aggregate-contributors.js'
import { KeyVersionSchema, VersionStringSchema } from '../../../src/analytics/controlled-types.js'
import { getEligibilityRef } from '../../../src/analytics/governance/collection-store.js'
import { decideEligibility } from '../../../src/analytics/governance/eligibility.js'
import type { EligibilityDecision } from '../../../src/analytics/governance/eligibility.js'
import { setPreference } from '../../../src/analytics/governance/preference-store.js'
import type { PreferenceLane } from '../../../src/analytics/governance/preference-store.js'
import type { NormalizerEnv } from '../../../src/analytics/normalizer.js'
import { createProductionSinks } from '../../../src/analytics/production-sinks.js'
import { createAnalyticsObserver } from '../../../src/analytics/runtime.js'
import { createRecordingHealth } from '../../../src/analytics/runtime.testing.js'
import type { AnalyticsSourceContext, ChatMessageAcceptedFact } from '../../../src/analytics/source-facts.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import * as schema from '../../../src/db/schema.js'
import { activeCollectionRefKey, collectionEligibilityEffect } from '../../../src/debug/settings/analytics-consent.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { createTestEpoch, TEST_EPOCH_ID } from '../storage-fixtures.js'
import { AKEYS, govActorKeyFor, IDENTITY_A, KEYRING, refKeyFor, T } from '../subject-fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const POLICY_VERSION = 3

const env: NormalizerEnv = {
  hmacKey: AKEYS.v3,
  keyVersion: KeyVersionSchema.parse('v3'),
  installId: 'install-uuid-1',
  appVersion: VersionStringSchema.parse('6.10.0'),
  policyVersion: POLICY_VERSION,
  ingestedAtMs: T + 500,
}

const source: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: IDENTITY_A.platformInstanceId,
  chatUserId: IDENTITY_A.platformUserId,
  nativeContextId: IDENTITY_A.platformUserId,
  storageContextId: toScopedContextId({
    platformInstanceId: IDENTITY_A.platformInstanceId,
    nativeContextId: IDENTITY_A.platformUserId,
  }),
  configContextId: toScopedContextId({
    platformInstanceId: IDENTITY_A.platformInstanceId,
    nativeContextId: IDENTITY_A.platformUserId,
  }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

const messageFact: ChatMessageAcceptedFact = {
  version: 1,
  type: 'chat_message_accepted',
  sourceEventId: 'se-1',
  occurredAtMs: T,
  source,
  inputCount: 1,
  inputLengthChars: 200,
  attachmentCount: 0,
  isCommand: false,
  command: 'none',
}

/** The ref an admitting decision carries, or null when it denied. */
const grantedRefOf = (decision: EligibilityDecision): unknown =>
  decision.allowed ? decision.collectionEligibility : null

describe('a granted consent makes the pseudonymous path reachable', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    createTestEpoch(db)
  })

  /**
   * Consent exactly as the settings handler records it: the same `setPreference`
   * call with the same in-transaction eligibility effect. Going through the
   * production wiring rather than calling the grant helper directly is what makes
   * this a proof that the shipped path is reachable.
   */
  const consent = (lane: PreferenceLane): void => {
    setPreference(
      {
        governanceActorKey: govActorKeyFor(IDENTITY_A, 'v3'),
        keyVersion: 'v3',
        lane,
        value: 'allow',
        policyVersion: POLICY_VERSION,
        source: 'settings',
        nowMs: T,
        onAppliedInTx: collectionEligibilityEffect(activeCollectionRefKey(IDENTITY_A, KEYRING), {
          policyVersion: POLICY_VERSION,
          nowMs: T,
        }),
      },
      { getDrizzleDb: (): Db => db },
    )
  }

  /** The decision `buildDecide` in start-analytics.ts produces for this subject. */
  const decide = (): EligibilityDecision =>
    decideEligibility({
      lane: 'local_pseudonymous',
      killSwitchActive: false,
      localMode: 'local_pseudonymous',
      externalAggregateEnabled: false,
      externalPseudonymousEnabled: false,
      lawfulBasis: 'consent',
      governanceReady: true,
      policyVersion: POLICY_VERSION,
      policyEffectiveAtMs: T - 1,
      nowMs: T,
      actorRole: source.actorRole,
      localPreference: 'allow',
      externalPreference: 'unknown',
      sink: null,
      collectionEligibility: getEligibilityRef(refKeyFor(IDENTITY_A, 'v3'), { getDrizzleDb: (): Db => db }),
      deliveryGrant: null,
    })

  const runObserver = async (): Promise<ReturnType<typeof createRecordingHealth>> => {
    const health = createRecordingHealth()
    const observer = createAnalyticsObserver({
      decide,
      normalizerEnv: () => env,
      health,
      log: { warn: () => undefined },
      sinks: createProductionSinks({
        epochId: TEST_EPOCH_ID,
        tracker: createContributorTracker(),
        getDrizzleDb: (): Db => db,
      }),
    })
    observer.observe(messageFact)
    await observer.flush()
    return health
  }

  const canonicalEvents = (): readonly (typeof schema.analyticsEvents.$inferSelect)[] =>
    db.select().from(schema.analyticsEvents).all()

  const refAssociations = (): readonly (typeof schema.analyticsEventCollectionRefs.$inferSelect)[] =>
    db.select().from(schema.analyticsEventCollectionRefs).all()

  test('the pseudonymous decision admits with the granted ref', () => {
    consent('local_longitudinal')

    const decision = decide()

    expect(decision.allowed).toBe(true)
    expect(grantedRefOf(decision)).toEqual({
      refKey: refKeyFor(IDENTITY_A, 'v3'),
      keyVersion: 'v3',
      generation: 1,
    })
  })

  test('a canonical event is written and associated with the granted ref', async () => {
    consent('local_longitudinal')

    const health = await runObserver()

    expect(canonicalEvents()).toHaveLength(1)
    expect(refAssociations().map((row) => row.refKey)).toEqual([refKeyFor(IDENTITY_A, 'v3')])
    // The sink write is inside a swallow-and-count catch, so a silent failure
    // would otherwise read as an ordinary empty queue.
    expect(health.counts.observer_failure).toBe(0)
  })

  test('without the grant the same run writes no canonical event', async () => {
    await runObserver()

    expect(canonicalEvents()).toHaveLength(0)
  })
})
