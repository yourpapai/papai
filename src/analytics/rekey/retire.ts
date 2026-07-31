// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, ne, notInArray } from 'drizzle-orm'

import {
  analyticsCollectionEligibility,
  analyticsDeletionRequests,
  analyticsDeliveries,
  analyticsEligibilityGrants,
  analyticsEvents,
  analyticsRekeyMappings,
  analyticsSnapshotPublications,
} from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { deriveRekeyedPseudonym } from '../identity/pseudonym.js'
import { shadowEventIdFor } from './dual-write.js'
import { deleteOldGovernanceIn, deleteOldGraphIn } from './retire-graph.js'
import { checkpointRekeyRunIn, parseRekeyVersions } from './run-store.js'
import type { RekeyTx } from './run-store.js'

const log = logger.child({ scope: 'analytics:rekey:retire' })

export const RETIREMENT_REFUSAL_REASONS = [
  'swap_incomplete',
  'horizon',
  'deletion_target',
  'publication_bound',
  'consumer_open',
  'local_verification_incomplete',
  'remote_verification_incomplete',
  'unresolved_deny',
  'unresolved_ref',
] as const

export type RetirementRefusalReason = (typeof RETIREMENT_REFUSAL_REASONS)[number]

export type RetirementEvaluation = Readonly<{
  ok: boolean
  refusedReasons: readonly RetirementRefusalReason[]
}>

export type RetirementCheckInput = Readonly<{
  nowMs: number
  encryptionKeys: readonly Buffer[]
  snapshotConsumerOpen?: () => boolean
}>

export class RetirementRefusedError extends Error {
  readonly refusedReasons: readonly RetirementRefusalReason[]

  constructor(refusedReasons: readonly RetirementRefusalReason[]) {
    super(`rekey retirement refused: ${refusedReasons.join(', ')}`)
    this.name = 'RetirementRefusedError'
    this.refusedReasons = refusedReasons
  }
}

const REMOTE_CLEARED_DELIVERY_STATES: ReadonlySet<string> = new Set(['deleted', 'cancelled', 'dead'])

const sourceEventIdsIn = (tx: RekeyTx, sourceGeneration: string): readonly string[] =>
  tx
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.storageGeneration, sourceGeneration))
    .all()
    .map((row) => row.eventId)

const hasUnmirroredSourceEventIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow): boolean => {
  const sourceRows = tx
    .select({
      sourceKind: analyticsEvents.sourceKind,
      sourceRefKey: analyticsEvents.sourceRefKey,
      eventName: analyticsEvents.eventName,
    })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.storageGeneration, run.sourceGeneration))
    .all()
  for (const row of sourceRows) {
    const shadow = tx
      .select({ eventId: analyticsEvents.eventId })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.eventId, shadowEventIdFor(row, run.targetGeneration)))
      .get()
    if (shadow === undefined) return true
  }
  return false
}

const hasIncompleteRemoteIn = (tx: RekeyTx, sourceEventIds: readonly string[]): boolean => {
  if (sourceEventIds.length === 0) return false
  const row = tx
    .select({ eventId: analyticsDeliveries.eventId })
    .from(analyticsDeliveries)
    .where(
      and(
        inArray(analyticsDeliveries.eventId, [...sourceEventIds]),
        notInArray(analyticsDeliveries.state, [...REMOTE_CLEARED_DELIVERY_STATES]),
      ),
    )
    .get()
  return row !== undefined
}

type CounterpartInput = Readonly<{
  domain: string
  oldKey: string
  toVersions: readonly string[]
  encryptionKeys: readonly Buffer[]
  exists: (candidateKey: string, toVersion: string) => boolean
}>

/**
 * A retained-generation governance row is resolvable only when its
 * deterministic rekeyed counterpart already exists on a target version: after
 * mapping destruction a deny must still bind the rekeyed physical rows.
 */
const hasResolvableCounterpart = (input: CounterpartInput): boolean => {
  for (const toVersion of input.toVersions) {
    for (const encryptionKey of input.encryptionKeys) {
      const candidate = deriveRekeyedPseudonym({
        key: encryptionKey,
        keyVersion: toVersion,
        domain: input.domain,
        sourcePseudonym: input.oldKey,
      })
      if (input.exists(candidate, toVersion)) return true
    }
  }
  return false
}

const hasUnresolvedGrantIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow, encryptionKeys: readonly Buffer[]): boolean => {
  const toVersions = parseRekeyVersions(run.toVersions)
  const grants = tx
    .select()
    .from(analyticsEligibilityGrants)
    .where(inArray(analyticsEligibilityGrants.keyVersion, [...parseRekeyVersions(run.fromVersions)]))
    .all()
  return grants.some(
    (grant) =>
      !hasResolvableCounterpart({
        domain: 'delivery-grant:v1',
        oldKey: grant.grantKey,
        toVersions,
        encryptionKeys,
        exists: (candidateKey, toVersion) =>
          tx
            .select({ grantKey: analyticsEligibilityGrants.grantKey })
            .from(analyticsEligibilityGrants)
            .where(
              and(
                eq(analyticsEligibilityGrants.grantKey, candidateKey),
                eq(analyticsEligibilityGrants.keyVersion, toVersion),
              ),
            )
            .get() !== undefined,
      }),
  )
}

const hasUnresolvedRefIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow, encryptionKeys: readonly Buffer[]): boolean => {
  const toVersions = parseRekeyVersions(run.toVersions)
  const refs = tx
    .select()
    .from(analyticsCollectionEligibility)
    .where(inArray(analyticsCollectionEligibility.keyVersion, [...parseRekeyVersions(run.fromVersions)]))
    .all()
  return refs.some(
    (row) =>
      !hasResolvableCounterpart({
        domain: 'collection-eligibility:v1',
        oldKey: row.refKey,
        toVersions,
        encryptionKeys,
        exists: (candidateKey, toVersion) =>
          tx
            .select({ refKey: analyticsCollectionEligibility.refKey })
            .from(analyticsCollectionEligibility)
            .where(
              and(
                eq(analyticsCollectionEligibility.refKey, candidateKey),
                eq(analyticsCollectionEligibility.keyVersion, toVersion),
              ),
            )
            .get() !== undefined,
      }),
  )
}

const hasUnresolvedDeletionTargetIn = (tx: RekeyTx): boolean =>
  tx
    .select({ requestId: analyticsDeletionRequests.requestId })
    .from(analyticsDeletionRequests)
    .where(ne(analyticsDeletionRequests.state, 'completed'))
    .get() !== undefined

const hasBoundPublicationIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow): boolean =>
  tx
    .select({ snapshotId: analyticsSnapshotPublications.snapshotId })
    .from(analyticsSnapshotPublications)
    .where(
      and(
        eq(analyticsSnapshotPublications.storageGeneration, run.sourceGeneration),
        inArray(analyticsSnapshotPublications.state, ['staged', 'published']),
      ),
    )
    .get() !== undefined

/**
 * Pure, restart-safe retirement gate: re-evaluates every condition from the
 * live tables and never mutates state. Refusal is expected for a long
 * horizon wait, so it is not an error path.
 */
export const evaluateRetirementIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  check: RetirementCheckInput,
): RetirementEvaluation => {
  const reasons: RetirementRefusalReason[] = []
  if (run.swapCompletedAtMs === null || run.retireNotBeforeMs === null) {
    reasons.push('swap_incomplete')
  } else if (check.nowMs < run.retireNotBeforeMs) {
    reasons.push('horizon')
  }
  if (hasUnresolvedDeletionTargetIn(tx)) reasons.push('deletion_target')
  if (hasBoundPublicationIn(tx, run)) reasons.push('publication_bound')
  if (check.snapshotConsumerOpen?.() === true) reasons.push('consumer_open')
  if (hasUnmirroredSourceEventIn(tx, run)) reasons.push('local_verification_incomplete')
  if (hasIncompleteRemoteIn(tx, sourceEventIdsIn(tx, run.sourceGeneration))) {
    reasons.push('remote_verification_incomplete')
  }
  if (hasUnresolvedGrantIn(tx, run, check.encryptionKeys)) reasons.push('unresolved_deny')
  if (hasUnresolvedRefIn(tx, run, check.encryptionKeys)) reasons.push('unresolved_ref')
  log.debug({ ok: reasons.length === 0, refusedReasons: reasons }, 'rekey retirement evaluated')
  return { ok: reasons.length === 0, refusedReasons: reasons }
}

/**
 * Retirement execution: re-evaluates inside the same transaction, then
 * removes the old local graph in FK-safe order, deletes old-version
 * governance rows, destroys the encrypted mappings (hash columns remain as
 * audit evidence), and completes the run. Independent delivery deletion
 * receipts and deletion request/bundle audit rows are retained.
 */
export const executeRetirementIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  check: RetirementCheckInput,
): RetirementEvaluation => {
  const evaluation = evaluateRetirementIn(tx, run, check)
  if (!evaluation.ok) {
    log.warn({ refusedReasons: evaluation.refusedReasons }, 'rekey retirement refused')
    throw new RetirementRefusedError(evaluation.refusedReasons)
  }
  deleteOldGraphIn(tx, run)
  deleteOldGovernanceIn(tx, run)
  tx.update(analyticsRekeyMappings)
    .set({ state: 'destroyed', mappingCiphertext: '' })
    .where(eq(analyticsRekeyMappings.runId, run.runId))
    .run()
  checkpointRekeyRunIn(tx, {
    runId: run.runId,
    phase: 'retire',
    subphase: 'retire.waiting_horizon',
    status: 'completed',
    nowMs: check.nowMs,
  })
  log.info({ runId: run.runId }, 'rekey retirement executed; mappings destroyed')
  return evaluation
}
