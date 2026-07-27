// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import {
  analyticsCensorIntervals,
  analyticsCollectionEligibility,
  analyticsDeliveries,
  analyticsEligibilityGrants,
  analyticsEvents,
  analyticsFeatureOpportunityDays,
  analyticsFeatureUseDays,
  analyticsGoalAttempts,
  analyticsPreferences,
  analyticsSessions,
  analyticsTurnFriction,
} from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { analyticsRemap, governanceRemap } from './copy.js'
import { remapEventRowForTarget } from './dual-write.js'
import type { RekeyFullKeyMaterial } from './dual-write.js'
import { parseRekeyVersions } from './run-store.js'
import type { RekeyTx } from './run-store.js'
import { loadParentPairsIn } from './verify-pairs.js'
import { canonical } from './verify.js'

const log = logger.child({ scope: 'analytics:rekey:verify-content' })

export type ContentVerifyReport = Readonly<{ ok: boolean; mismatches: readonly string[] }>

type RemapKind = 'analytics' | 'governance' | 'eventId'

type ChildScope = 'generation' | 'keyVersion' | 'actor'

type ChildTableLabel =
  | 'sessions'
  | 'goal_attempts'
  | 'feature_opportunity_days'
  | 'feature_use_days'
  | 'turn_friction'
  | 'censor_intervals'
  | 'preferences'
  | 'collection_eligibility'
  | 'eligibility_grants'

type ChildTableSpec = Readonly<{
  label: ChildTableLabel
  scope: ChildScope
  remapped: Readonly<Record<string, readonly [RemapKind, string]>>
}>

const CHILD_TABLE_SPECS: readonly ChildTableSpec[] = [
  {
    label: 'sessions',
    scope: 'generation',
    remapped: {
      sessionKey: ['analytics', 'session:v1'],
      actorKey: ['analytics', 'actor:v1'],
      conversationKey: ['analytics', 'conversation:v1'],
      firstEventId: ['eventId', ''],
      lastEventId: ['eventId', ''],
    },
  },
  {
    label: 'goal_attempts',
    scope: 'generation',
    remapped: {
      attemptKey: ['analytics', 'materialization:v1'],
      turnKey: ['analytics', 'turn:v1'],
      actorKey: ['analytics', 'actor:v1'],
      conversationKey: ['analytics', 'conversation:v1'],
      anchorEventId: ['eventId', ''],
    },
  },
  {
    label: 'feature_opportunity_days',
    scope: 'generation',
    remapped: { actorKey: ['analytics', 'actor:v1'], opportunityEventId: ['eventId', ''] },
  },
  {
    label: 'feature_use_days',
    scope: 'generation',
    remapped: { actorKey: ['analytics', 'actor:v1'], firstUseEventId: ['eventId', ''] },
  },
  {
    label: 'turn_friction',
    scope: 'generation',
    remapped: {
      turnKey: ['analytics', 'turn:v1'],
      actorKey: ['analytics', 'actor:v1'],
      conversationKey: ['analytics', 'conversation:v1'],
      anchorEventId: ['eventId', ''],
    },
  },
  {
    label: 'censor_intervals',
    scope: 'actor',
    remapped: { actorKey: ['analytics', 'actor:v1'] },
  },
  {
    label: 'preferences',
    scope: 'keyVersion',
    remapped: { governanceActorKey: ['governance', 'governance-actor:v1'] },
  },
  {
    label: 'collection_eligibility',
    scope: 'keyVersion',
    remapped: { refKey: ['governance', 'collection-eligibility:v1'] },
  },
  {
    label: 'eligibility_grants',
    scope: 'keyVersion',
    remapped: { grantKey: ['governance', 'delivery-grant:v1'] },
  },
]

type RowSelector = (tx: RekeyTx) => readonly Record<string, unknown>[]

const toRecords = (rows: readonly object[]): readonly Record<string, unknown>[] =>
  rows.map((row): Record<string, unknown> => ({ ...row }))

const CHILD_ROW_SELECTORS: Readonly<Record<ChildTableLabel, RowSelector>> = {
  sessions: (tx) => toRecords(tx.select().from(analyticsSessions).all()),
  goal_attempts: (tx) => toRecords(tx.select().from(analyticsGoalAttempts).all()),
  feature_opportunity_days: (tx) => toRecords(tx.select().from(analyticsFeatureOpportunityDays).all()),
  feature_use_days: (tx) => toRecords(tx.select().from(analyticsFeatureUseDays).all()),
  turn_friction: (tx) => toRecords(tx.select().from(analyticsTurnFriction).all()),
  censor_intervals: (tx) => toRecords(tx.select().from(analyticsCensorIntervals).all()),
  preferences: (tx) => toRecords(tx.select().from(analyticsPreferences).all()),
  collection_eligibility: (tx) => toRecords(tx.select().from(analyticsCollectionEligibility).all()),
  eligibility_grants: (tx) => toRecords(tx.select().from(analyticsEligibilityGrants).all()),
}

const selectChildRowsIn = (tx: RekeyTx, label: ChildTableLabel): readonly Record<string, unknown>[] =>
  CHILD_ROW_SELECTORS[label](tx)

const remapChildRow = (
  row: Record<string, unknown>,
  spec: ChildTableSpec,
  material: RekeyFullKeyMaterial,
  activeToShadow: ReadonlyMap<string, string>,
): Record<string, unknown> => {
  const result = { ...row }
  for (const [column, [kind, domain]] of Object.entries(spec.remapped)) {
    const value = result[column]
    if (typeof value !== 'string') continue
    if (kind === 'eventId') {
      result[column] = activeToShadow.get(value) ?? value
    } else if (kind === 'analytics') {
      result[column] = analyticsRemap(material, domain, value) ?? value
    } else {
      result[column] = governanceRemap(material, domain, value)
    }
  }
  return result
}

const classifyChildRow = (
  row: Record<string, unknown>,
  spec: ChildTableSpec,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
): 'source' | 'target' | 'other' => {
  if (spec.scope === 'generation') {
    if (row['storageGeneration'] === run.sourceGeneration) return 'source'
    if (row['storageGeneration'] === run.targetGeneration) return 'target'
    return 'other'
  }
  if (spec.scope === 'keyVersion') {
    return row['keyVersion'] === material.toVersion ? 'target' : 'source'
  }
  const actorKey = row['actorKey']
  if (typeof actorKey !== 'string') return 'other'
  if (actorKey.startsWith(`${material.toVersion}.`)) return 'target'
  if (parseRekeyVersions(run.fromVersions).some((version) => actorKey.startsWith(`${version}.`))) return 'source'
  return 'other'
}

const verifyChildTableIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  activeToShadow: ReadonlyMap<string, string>,
  spec: ChildTableSpec,
  mismatches: string[],
): void => {
  const allRows = selectChildRowsIn(tx, spec.label)
  const sourceRows = allRows.filter((row) => classifyChildRow(row, spec, run, material) === 'source')
  const targetRows = allRows.filter((row) => classifyChildRow(row, spec, run, material) === 'target')
  const expected = sourceRows
    .map((row) =>
      canonical(
        remapChildRow(
          {
            ...row,
            ...(spec.scope === 'generation' ? { storageGeneration: run.targetGeneration } : {}),
            ...(spec.scope === 'keyVersion' ? { keyVersion: material.toVersion } : {}),
          },
          spec,
          material,
          activeToShadow,
        ),
      ),
    )
    .sort()
  const actual = targetRows.map((row) => canonical({ ...row })).sort()
  if (expected.length !== actual.length || expected.some((row, index) => row !== actual[index])) {
    mismatches.push(spec.label)
  }
}

const verifyParentsIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  activeToShadow: ReadonlyMap<string, string>,
  mismatches: string[],
): void => {
  const parentMaterial = {
    toVersion: material.toVersion,
    toKey: material.analyticsToKey,
    encryptionKey: material.encryptionKey,
  }
  for (const [activeEventId, shadowEventId] of activeToShadow) {
    const active = tx.select().from(analyticsEvents).where(eq(analyticsEvents.eventId, activeEventId)).get()
    const shadow = tx.select().from(analyticsEvents).where(eq(analyticsEvents.eventId, shadowEventId)).get()
    if (active === undefined || shadow === undefined) {
      mismatches.push(`parent:${activeEventId}:missing`)
      continue
    }
    const expected = remapEventRowForTarget({ ...active, storageGeneration: run.targetGeneration }, parentMaterial)
    if (canonical({ ...expected, eventId: shadowEventId }) !== canonical({ ...shadow })) {
      mismatches.push(`parent:${activeEventId}:content`)
    }
  }
}

const deliveryCountForGenerationIn = (tx: RekeyTx, generation: string): number =>
  tx
    .select({ eventId: analyticsDeliveries.eventId })
    .from(analyticsDeliveries)
    .innerJoin(analyticsEvents, eq(analyticsEvents.eventId, analyticsDeliveries.eventId))
    .where(eq(analyticsEvents.storageGeneration, generation))
    .all().length

/** Mapping-normalized parent and child content comparison, kept separate from the equation. */
export const verifyMappingNormalizedContentIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
): ContentVerifyReport => {
  const mismatches: string[] = []
  const { pairs } = loadParentPairsIn(tx, run, material.encryptionKeys)
  const activeToShadow = new Map(pairs.map((pair) => [pair.activeEventId, pair.shadowEventId]))
  verifyParentsIn(tx, run, material, activeToShadow, mismatches)
  for (const spec of CHILD_TABLE_SPECS) {
    verifyChildTableIn(tx, run, material, activeToShadow, spec, mismatches)
  }
  if (
    deliveryCountForGenerationIn(tx, run.sourceGeneration) !== deliveryCountForGenerationIn(tx, run.targetGeneration)
  ) {
    mismatches.push('deliveries:count')
  }
  if (mismatches.length > 0) log.warn({ mismatches: mismatches.length }, 'rekey content verification failed')
  return { ok: mismatches.length === 0, mismatches }
}
