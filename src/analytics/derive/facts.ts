// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq, isNotNull, ne, or, sql } from 'drizzle-orm'

import { analyticsCollectionEligibility, analyticsEventCollectionRefs, analyticsEvents } from '../../db/schema.js'
import type { CollectionEligibilityRef } from '../governance/eligibility.js'
import type { FeatureOpportunityFact, FeatureUseFact } from './features.js'
import type { AffectedPartition, Db, EventRow } from './store.js'
import { partitionFilter, readProps } from './store.js'

export const loadFeatureFacts = (
  db: Db,
  generation: string,
  actorKey: string,
): Readonly<{ opportunities: readonly FeatureOpportunityFact[]; uses: readonly FeatureUseFact[] }> => {
  const rows = db
    .select()
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.storageGeneration, generation),
        eq(analyticsEvents.actorKey, actorKey),
        ne(analyticsEvents.actorRole, 'guest'),
        or(eq(analyticsEvents.eventName, 'feature_opportunity'), eq(analyticsEvents.eventName, 'feature_used')),
      ),
    )
    .orderBy(asc(analyticsEvents.occurredAtMs), asc(analyticsEvents.eventId))
    .all()
  const opportunities: FeatureOpportunityFact[] = []
  const uses: FeatureUseFact[] = []
  for (const row of rows) {
    const props = readProps(row)
    if (row.eventName === 'feature_opportunity') {
      if (typeof props['feature'] !== 'string' || typeof props['available'] !== 'boolean') continue
      opportunities.push({
        eventId: row.eventId,
        actorKey,
        feature: props['feature'],
        available: props['available'],
        reason: typeof props['reason'] === 'string' ? props['reason'] : 'other',
        occurredAtMs: row.occurredAtMs,
      })
    } else {
      const outcome = props['outcome']
      if (
        typeof props['feature'] !== 'string' ||
        (outcome !== 'success' && outcome !== 'failure' && outcome !== 'blocked')
      )
        continue
      uses.push({ eventId: row.eventId, actorKey, feature: props['feature'], outcome, occurredAtMs: row.occurredAtMs })
    }
  }
  return { opportunities, uses }
}

export const findWithdrawnActorCensors = (db: Db): readonly Readonly<{ actorKey: string; startMs: number }>[] =>
  db
    .select({
      actorKey: analyticsEvents.actorKey,
      startMs: sql<number>`min(coalesce(${analyticsCollectionEligibility.revokedAt}, ${analyticsCollectionEligibility.effectiveAt}))`,
    })
    .from(analyticsEventCollectionRefs)
    .innerJoin(analyticsEvents, eq(analyticsEventCollectionRefs.eventId, analyticsEvents.eventId))
    .innerJoin(
      analyticsCollectionEligibility,
      eq(analyticsEventCollectionRefs.refKey, analyticsCollectionEligibility.refKey),
    )
    .where(and(eq(analyticsCollectionEligibility.state, 'deny'), isNotNull(analyticsEvents.actorKey)))
    .groupBy(analyticsEvents.actorKey)
    .all()
    .filter((row): row is { actorKey: string; startMs: number } => row.actorKey !== null)

export const collectionRefForEvent = (db: Db, eventId: string): CollectionEligibilityRef | null => {
  const row = db
    .select({
      refKey: analyticsEventCollectionRefs.refKey,
      keyVersion: analyticsEventCollectionRefs.keyVersion,
      generation: analyticsEventCollectionRefs.generation,
    })
    .from(analyticsEventCollectionRefs)
    .where(eq(analyticsEventCollectionRefs.eventId, eventId))
    .get()
  return row ?? null
}

export const loadEventRow = (db: Db, eventId: string): EventRow | undefined =>
  db.select().from(analyticsEvents).where(eq(analyticsEvents.eventId, eventId)).get()

export const findDerivedClarificationEvent = (db: Db, turnKey: string): Readonly<{ eventId: string }> | undefined =>
  db
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.eventName, 'clarification_abandoned'), eq(analyticsEvents.turnKey, turnKey)))
    .get()

export const findDerivedClarificationEvents = (
  db: Db,
  generation: string,
  partition: AffectedPartition,
): readonly Readonly<{ eventId: string; turnKey: string }>[] =>
  db
    .select({ eventId: analyticsEvents.eventId, turnKey: analyticsEvents.turnKey })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.storageGeneration, generation),
        eq(analyticsEvents.eventName, 'clarification_abandoned'),
        isNotNull(analyticsEvents.turnKey),
        partitionFilter(partition),
      ),
    )
    .all()
    .filter((row): row is { eventId: string; turnKey: string } => row.turnKey !== null)
