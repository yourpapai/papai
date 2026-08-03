// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, like } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsBackfillAggregateContributions, analyticsBackfillEventMap } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { utcDayOfMs } from '../aggregate.js'
import type { AnalyticsEventV1 } from '../contracts.js'
import { insertEligibleCanonicalEvent } from '../governance/collection-serialization.js'
import type { CollectionEligibilityRef } from '../governance/eligibility.js'
import { insertIneligibleContribution } from './backfill-apply.js'
import type { EligibilityDenialReason } from './backfill-decisions.js'

const log = logger.child({ scope: 'analytics:jobs:backfill-canonical' })

const FENCE_DENIAL_REASON: EligibilityDenialReason = 'preference_denied'

export type FutureCanonicalInput = Readonly<{
  event: AnalyticsEventV1
  collectionRef: CollectionEligibilityRef
  processEpochId: string
  runId: string
  sourceTable: string
  sourceRefKey: string
  consentCutoffMs: number
}>

export type FutureCanonicalResult =
  | 'inserted'
  | 'already_mapped'
  | 'already_present'
  | 'not_eligible'
  | 'pre_eligibility'

export const routeFutureCanonicalDecision = (
  input: FutureCanonicalInput,
  deps: Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }> = { getDrizzleDb: defaultGetDrizzleDb },
): FutureCanonicalResult => {
  if (input.event.event.occurred_at_ms < input.consentCutoffMs) {
    log.warn({ runId: input.runId }, 'canonical backfill refused: row predates eligibility')
    return 'pre_eligibility'
  }
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    const mapped = tx
      .select({ runId: analyticsBackfillEventMap.runId })
      .from(analyticsBackfillEventMap)
      .where(eq(analyticsBackfillEventMap.sourceRefKey, input.sourceRefKey))
      .limit(1)
      .get()
    if (mapped !== undefined) return 'already_mapped'
    const denied = tx
      .select({ runId: analyticsBackfillAggregateContributions.runId })
      .from(analyticsBackfillAggregateContributions)
      .where(
        and(
          eq(analyticsBackfillAggregateContributions.sourceRefKey, input.sourceRefKey),
          like(analyticsBackfillAggregateContributions.metric, 'ineligible:%'),
        ),
      )
      .limit(1)
      .get()
    if (denied !== undefined) return 'already_mapped'
    const result = insertEligibleCanonicalEvent(
      { event: input.event, processEpochId: input.processEpochId, collectionRef: input.collectionRef },
      { getDrizzleDb: deps.getDrizzleDb },
    )
    if (result.status === 'not_eligible') {
      insertIneligibleContribution(tx, {
        runId: input.runId,
        sourceTable: input.sourceTable,
        utcDay: utcDayOfMs(input.event.event.occurred_at_ms),
        reason: FENCE_DENIAL_REASON,
        sourceRefKey: input.sourceRefKey,
      })
      return 'not_eligible'
    }
    if (result.status === 'already_present') return 'already_present'
    tx.insert(analyticsBackfillEventMap)
      .values({ runId: input.runId, eventId: result.eventId, sourceRefKey: input.sourceRefKey })
      .run()
    return 'inserted'
  })
}
