// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { setEligibilityState } from '../../src/analytics/governance/collection-store.js'
import { setGrantState } from '../../src/analytics/governance/grant-store.js'
import { createSnapshotInvalidator } from '../../src/analytics/governance/snapshot-invalidator.js'
import {
  promoteStagedSnapshot,
  stageSnapshotPublication,
} from '../../src/analytics/governance/snapshot-publication-store.js'
import { deriveSubjectKeys } from '../../src/analytics/governance/subject-keys.js'
import type { SubjectIdentity, SubjectKeyrings } from '../../src/analytics/governance/subject-keys.js'
import type { SubjectServiceDeps } from '../../src/analytics/governance/subject-service.js'
import { createPseudonym } from '../../src/analytics/identity/pseudonym.js'
import * as schema from '../../src/db/schema.js'
import type { getTestDb } from '../utils/test-helpers.js'

export type Db = ReturnType<typeof getTestDb>

export const T = 1_800_000_000_000
export const DAY = 86_400_000

export const AKEYS = {
  v1: Buffer.alloc(32, 11),
  v2: Buffer.alloc(32, 12),
  v3: Buffer.alloc(32, 13),
} as const

export const GKEYS = {
  v1: Buffer.alloc(32, 21),
  v2: Buffer.alloc(32, 22),
  v3: Buffer.alloc(32, 23),
} as const

export type KeyVersionId = keyof typeof AKEYS

export const KEYRING = {
  analytics: {
    kind: 'available',
    activeVersion: 'v3',
    activeKey: AKEYS.v3,
    keys: new Map([
      ['v1', AKEYS.v1],
      ['v2', AKEYS.v2],
      ['v3', AKEYS.v3],
    ]),
  },
  governance: {
    kind: 'available',
    activeVersion: 'v3',
    activeKey: GKEYS.v3,
    keys: new Map([
      ['v1', GKEYS.v1],
      ['v2', GKEYS.v2],
      ['v3', GKEYS.v3],
    ]),
  },
} as const satisfies SubjectKeyrings

export const GENERATIONS = {
  retired: 'gen-retired',
  shadow: 'gen-shadow',
  active: 'gen-1',
} as const

export const IDENTITY_A: SubjectIdentity = { platformInstanceId: 'pi-1', platformUserId: 'user-a' }
export const IDENTITY_B: SubjectIdentity = { platformInstanceId: 'pi-1', platformUserId: 'user-b' }

export const actorKeyFor = (identity: SubjectIdentity, keyVersion: KeyVersionId): string =>
  createPseudonym({
    key: AKEYS[keyVersion],
    keyVersion,
    domain: 'actor:v1',
    components: [identity.platformInstanceId, identity.platformUserId],
  })

export const govActorKeyFor = (identity: SubjectIdentity, keyVersion: KeyVersionId): string =>
  createPseudonym({
    key: GKEYS[keyVersion],
    keyVersion,
    domain: 'governance-actor:v1',
    components: [identity.platformInstanceId, identity.platformUserId],
  })

export const refKeyFor = (identity: SubjectIdentity, keyVersion: KeyVersionId): string =>
  createPseudonym({
    key: GKEYS[keyVersion],
    keyVersion,
    domain: 'collection-eligibility:v1',
    components: [identity.platformInstanceId, identity.platformUserId],
  })

export const grantKeyFor = (identity: SubjectIdentity, keyVersion: KeyVersionId): string =>
  createPseudonym({
    key: GKEYS[keyVersion],
    keyVersion,
    domain: 'delivery-grant:v1',
    components: [identity.platformInstanceId, identity.platformUserId],
  })

export const subjectKeysFor = (identity: SubjectIdentity): ReturnType<typeof deriveSubjectKeys> =>
  deriveSubjectKeys(identity, KEYRING)

export const SUBJECT_EPOCH = 'epoch-subject'

export const seedSubjectEvent = (
  db: Db,
  identity: SubjectIdentity,
  input: Readonly<{
    keyVersion: KeyVersionId
    storageGeneration: string
    sourceRefKey: string
    eventId?: string
    eventName?: string
    occurredAtMs?: number
    expiresAtMs?: number
    actorRole?: string
    turnKey?: string | null
    conversationKey?: string | null
    props?: Record<string, unknown>
  }>,
): string => {
  const occurredAtMs = input.occurredAtMs ?? T
  const eventId = input.eventId ?? `ev-${input.sourceRefKey}-${input.storageGeneration}`
  db.insert(schema.analyticsProcessEpochs)
    .values({ epochId: SUBJECT_EPOCH, state: 'open', startedAtMs: T - 400 * DAY })
    .onConflictDoNothing()
    .run()
  db.insert(schema.analyticsEvents)
    .values({
      eventId,
      storageGeneration: input.storageGeneration,
      processEpochId: SUBJECT_EPOCH,
      sourceRefKey: input.sourceRefKey,
      sourceKind: 'live',
      schemaVersion: 1,
      eventName: input.eventName ?? 'turn_started',
      eventVersion: 1,
      occurredAtMs,
      ingestedAtMs: occurredAtMs + 1,
      source: 'live',
      attributionQuality: 'native',
      appVersion: '6.10.0',
      deploymentKey: 'v1.p-deploy',
      keyVersion: input.keyVersion,
      platform: 'telegram',
      platformInstanceKey: 'v1.p-instance',
      actorKey: actorKeyFor(identity, input.keyVersion),
      contextKey: 'v1.c-group',
      threadKey: null,
      conversationKey: input.conversationKey === undefined ? 'v1.c-group' : input.conversationKey,
      taskInstanceKey: null,
      contextType: 'group',
      actorRole: input.actorRole ?? 'member',
      taskProvider: 'none',
      invocationMode: 'normal',
      turnKey: input.turnKey ?? null,
      sessionKey: null,
      policyVersion: 3,
      eligibility: 'allowed',
      maxClass: 'C2',
      propsJson: JSON.stringify(input.props ?? {}),
      expiresAtMs: input.expiresAtMs ?? occurredAtMs + 90 * DAY,
    })
    .run()
  return eventId
}

export const seedRefAssociation = (
  db: Db,
  input: Readonly<{ eventId: string; refKey: string; keyVersion: string; generation: number }>,
): void => {
  db.insert(schema.analyticsEventCollectionRefs)
    .values({
      eventId: input.eventId,
      refKey: input.refKey,
      keyVersion: input.keyVersion,
      generation: input.generation,
      createdAt: T,
    })
    .run()
}

export const allowCollectionRef = (
  db: Db,
  identity: SubjectIdentity,
  keyVersion: KeyVersionId,
  nowMs = T,
): Readonly<{ refKey: string; keyVersion: string; generation: number }> => {
  const refKey = refKeyFor(identity, keyVersion)
  const { generation } = setEligibilityState(
    { refKey, keyVersion, state: 'allow', policyVersion: 3, nowMs },
    { getDrizzleDb: () => db },
  )
  return { refKey, keyVersion, generation }
}

export const allowGrantFor = (
  db: Db,
  identity: SubjectIdentity,
  keyVersion: KeyVersionId,
  nowMs = T,
): Readonly<{ grantKey: string; keyVersion: string; generation: number }> => {
  const grantKey = grantKeyFor(identity, keyVersion)
  const { generation } = setGrantState(
    { grantKey, keyVersion, state: 'allow', policyVersion: 3, nowMs },
    { getDrizzleDb: () => db },
  )
  return { grantKey, keyVersion, generation }
}

export const seedSink = (db: Db, sinkVersionId: string): void => {
  db.insert(schema.analyticsSinks)
    .values({
      sinkVersionId,
      logicalSinkId: `logical-${sinkVersionId}`,
      version: 1,
      kind: 'webhook',
      state: 'disabled',
      payloadSchemaVersion: 1,
      egressMode: 'pseudonymous',
      endpointCiphertext: 'ct-endpoint',
      secretCiphertext: 'ct-secret',
      configFingerprint: `fp-${sinkVersionId}`,
      createdAtMs: T,
    })
    .run()
}

export const seedDelivery = (
  db: Db,
  input: Readonly<{
    eventId: string
    sinkVersionId: string
    state: string
    grant?: Readonly<{ grantKey: string; keyVersion: string; generation: number }>
    nextAttemptAtMs?: number
    leaseUntilMs?: number | null
    sendStartedAtMs?: number | null
    deliveredAtMs?: number | null
    remoteReceiptHash?: string | null
    lastErrorClass?: string | null
  }>,
): void => {
  db.insert(schema.analyticsDeliveries)
    .values({
      eventId: input.eventId,
      sinkVersionId: input.sinkVersionId,
      grantKey: input.grant?.grantKey ?? 'v1.d-grant',
      grantKeyVersion: input.grant?.keyVersion ?? 'v1',
      grantGeneration: input.grant?.generation ?? 1,
      state: input.state,
      attempts: 1,
      nextAttemptAtMs: input.nextAttemptAtMs ?? T,
      leaseUntilMs: input.leaseUntilMs ?? null,
      sendStartedAtMs: input.sendStartedAtMs ?? null,
      lastErrorClass: input.lastErrorClass ?? null,
      deliveredAtMs: input.deliveredAtMs ?? null,
      remoteReceiptHash: input.remoteReceiptHash ?? null,
      payloadSchemaVersion: 1,
    })
    .run()
}

export const seedSession = (
  db: Db,
  input: Readonly<{
    sessionKey: string
    storageGeneration: string
    actorKey: string
    eventId: string
    startMs: number
    endMs: number
  }>,
): void => {
  db.insert(schema.analyticsSessions)
    .values({
      sessionKey: input.sessionKey,
      storageGeneration: input.storageGeneration,
      actorKey: input.actorKey,
      conversationKey: 'v1.c-group',
      startMs: input.startMs,
      endMs: input.endMs,
      durationMs: input.endMs - input.startMs,
      activityCount: 2,
      turnCount: 1,
      firstEventId: input.eventId,
      lastEventId: input.eventId,
      sessionizationVersion: 1,
    })
    .run()
}

export const seedAttempt = (
  db: Db,
  input: Readonly<{
    attemptKey: string
    storageGeneration: string
    actorKey: string
    turnKey: string
    eventId: string
  }>,
): void => {
  db.insert(schema.analyticsGoalAttempts)
    .values({
      attemptKey: input.attemptKey,
      storageGeneration: input.storageGeneration,
      turnKey: input.turnKey,
      goal: 'I01',
      actorKey: input.actorKey,
      conversationKey: 'v1.c-group',
      startMs: T,
      matureAtMs: T + DAY,
      outcome: 'censored',
      resolvedAtMs: null,
      anchorEventId: input.eventId,
      outcomeVersion: 1,
    })
    .run()
}

export const seedFriction = (
  db: Db,
  input: Readonly<{ turnKey: string; storageGeneration: string; actorKey: string; eventId: string }>,
): void => {
  db.insert(schema.analyticsTurnFriction)
    .values({
      turnKey: input.turnKey,
      storageGeneration: input.storageGeneration,
      actorKey: input.actorKey,
      conversationKey: 'v1.c-group',
      occurredAtMs: T,
      rephrase: true,
      clarificationAbandoned: false,
      permissionIssue: false,
      stop: false,
      longTurn: false,
      disclosureFallback: false,
      failureChain: false,
      componentCount: 1,
      displayScore: 1,
      anchorEventId: input.eventId,
      frictionVersion: 1,
    })
    .run()
}

export const seedFeatureDays = (
  db: Db,
  input: Readonly<{ actorKey: string; storageGeneration: string; eventId: string }>,
): void => {
  db.insert(schema.analyticsFeatureOpportunityDays)
    .values({
      actorKey: input.actorKey,
      feature: 'task_create',
      utcDay: new Date(T).toISOString().slice(0, 10),
      storageGeneration: input.storageGeneration,
      available: true,
      reason: 'other',
      opportunityEventId: input.eventId,
      definitionVersion: 1,
    })
    .run()
  db.insert(schema.analyticsFeatureUseDays)
    .values({
      actorKey: input.actorKey,
      feature: 'task_create',
      utcDay: new Date(T).toISOString().slice(0, 10),
      storageGeneration: input.storageGeneration,
      successCount: 1,
      failureCount: 0,
      blockedCount: 0,
      joinedAvailable: true,
      adopted: true,
      firstUseEventId: input.eventId,
      definitionVersion: 1,
    })
    .run()
}

export const publishSnapshot = (db: Db, snapshotId: string, storageGeneration: string): void => {
  const deps = { getDrizzleDb: (): Db => db }
  stageSnapshotPublication(
    { snapshotId, storageGeneration, pathHash: `h-${snapshotId}`, sourceHighWater: 'hw-1', nowMs: T },
    deps,
  )
  promoteStagedSnapshot({ snapshotId, nowMs: T }, deps)
}

export const makeSubjectDeps = (db: Db, overrides?: Partial<SubjectServiceDeps>): SubjectServiceDeps => ({
  getDrizzleDb: (): Db => db,
  keyrings: KEYRING,
  snapshotInvalidator: createSnapshotInvalidator({ getDrizzleDb: (): Db => db }),
  ...overrides,
})

export const eventRowById = (db: Db, eventId: string): typeof schema.analyticsEvents.$inferSelect | undefined =>
  db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, eventId)).get()

export const allEvents = (db: Db): readonly (typeof schema.analyticsEvents.$inferSelect)[] =>
  db.select().from(schema.analyticsEvents).all()

export const allDeliveries = (db: Db): readonly (typeof schema.analyticsDeliveries.$inferSelect)[] =>
  db.select().from(schema.analyticsDeliveries).all()

export const allReceipts = (db: Db): readonly (typeof schema.analyticsDeliveryDeletionReceipts.$inferSelect)[] =>
  db.select().from(schema.analyticsDeliveryDeletionReceipts).all()

export const allRefs = (db: Db): readonly (typeof schema.analyticsEventCollectionRefs.$inferSelect)[] =>
  db.select().from(schema.analyticsEventCollectionRefs).all()
