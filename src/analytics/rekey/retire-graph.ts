// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, inArray } from 'drizzle-orm'

import {
  analyticsBackfillEventMap,
  analyticsCollectionEligibility,
  analyticsDeliveries,
  analyticsEligibilityGrants,
  analyticsEventCollectionRefs,
  analyticsEvents,
  analyticsFeatureOpportunityDays,
  analyticsFeatureUseDays,
  analyticsGoalAttempts,
  analyticsPreferences,
  analyticsSessions,
  analyticsSessionEvents,
  analyticsTurnFriction,
} from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { parseRekeyVersions } from './run-store.js'
import type { RekeyTx } from './run-store.js'

const sourceEventIdsIn = (tx: RekeyTx, sourceGeneration: string): readonly string[] =>
  tx
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.storageGeneration, sourceGeneration))
    .all()
    .map((row) => row.eventId)

const deleteEventChildrenIn = (tx: RekeyTx, sourceEventIds: readonly string[]): void => {
  if (sourceEventIds.length === 0) return
  tx.delete(analyticsDeliveries)
    .where(inArray(analyticsDeliveries.eventId, [...sourceEventIds]))
    .run()
  tx.delete(analyticsEventCollectionRefs)
    .where(inArray(analyticsEventCollectionRefs.eventId, [...sourceEventIds]))
    .run()
  tx.delete(analyticsBackfillEventMap)
    .where(inArray(analyticsBackfillEventMap.eventId, [...sourceEventIds]))
    .run()
}

const deleteMaterializationsIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow): void => {
  tx.delete(analyticsGoalAttempts).where(eq(analyticsGoalAttempts.storageGeneration, run.sourceGeneration)).run()
  tx.delete(analyticsTurnFriction).where(eq(analyticsTurnFriction.storageGeneration, run.sourceGeneration)).run()
  tx.delete(analyticsFeatureOpportunityDays)
    .where(eq(analyticsFeatureOpportunityDays.storageGeneration, run.sourceGeneration))
    .run()
  tx.delete(analyticsFeatureUseDays).where(eq(analyticsFeatureUseDays.storageGeneration, run.sourceGeneration)).run()
}

/**
 * Removes the old local graph in FK-safe order: session events, deliveries,
 * collection refs, backfill maps, materializations, sessions, then events.
 * Independent delivery deletion receipts, deletion requests/bundles, censor
 * intervals, process epochs, and backfill run rows stay as audit evidence.
 */
export const deleteOldGraphIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow): void => {
  const sourceSessionKeys = tx
    .select({ sessionKey: analyticsSessions.sessionKey })
    .from(analyticsSessions)
    .where(eq(analyticsSessions.storageGeneration, run.sourceGeneration))
    .all()
    .map((row) => row.sessionKey)
  if (sourceSessionKeys.length > 0) {
    tx.delete(analyticsSessionEvents)
      .where(inArray(analyticsSessionEvents.sessionKey, [...sourceSessionKeys]))
      .run()
  }
  deleteEventChildrenIn(tx, sourceEventIdsIn(tx, run.sourceGeneration))
  deleteMaterializationsIn(tx, run)
  tx.delete(analyticsSessions).where(eq(analyticsSessions.storageGeneration, run.sourceGeneration)).run()
  tx.delete(analyticsEvents).where(eq(analyticsEvents.storageGeneration, run.sourceGeneration)).run()
}

/** Deletes old-version governance rows after their target-generation counterparts verified. */
export const deleteOldGovernanceIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow): void => {
  const fromVersions = [...parseRekeyVersions(run.fromVersions)]
  tx.delete(analyticsPreferences).where(inArray(analyticsPreferences.keyVersion, fromVersions)).run()
  tx.delete(analyticsCollectionEligibility)
    .where(inArray(analyticsCollectionEligibility.keyVersion, fromVersions))
    .run()
  tx.delete(analyticsEligibilityGrants).where(inArray(analyticsEligibilityGrants.keyVersion, fromVersions)).run()
}
