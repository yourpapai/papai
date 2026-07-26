// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsBackfillEventMap,
  analyticsCensorIntervals,
  analyticsDeliveryDeletionReceipts,
  analyticsEventCollectionRefs,
  analyticsEvents,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import {
  cancelNeverStartedIn,
  deleteDeliveryRowsForEventsIn,
  listDeliveryRowsForEvents,
  markSendingAmbiguousIn,
} from '../delivery/settlement.js'
import { rebuildDailyAggregatesForDays } from '../storage/aggregate-rebuild.js'
import { deleteEventRowsIn } from '../storage/event-store.js'
import {
  destroyDeletionTargetCiphertextIn,
  getDeletionRequest,
  markDeletionRequestStateIn,
  openDeletionTargets,
} from './deletion-target-store.js'
import type { DeletionTargetSet } from './deletion-target-store.js'
import type { SnapshotInvalidator } from './snapshot-invalidator.js'
import type { SubjectKeyrings } from './subject-keys.js'

const log = logger.child({ scope: 'analytics:governance:subject-deletion' })

const DAY_MS = 86_400_000

export class DeletionIncompleteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeletionIncompleteError'
  }
}

export type RemoteDeletionConfirmation = Readonly<{ remoteReceiptHash: string }>

/**
 * Requests and confirms remote deletion of one sink's copy of the subject's
 * delivered/ambiguous payloads. Returns null when the sink refuses or cannot
 * confirm; the deletion workflow then fails the request and retains the
 * sealed target bundle so it can be resumed.
 */
export type RemoteDeletionRequest = (sinkVersionId: string) => RemoteDeletionConfirmation | null

export type SubjectDeletionDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  keyrings: SubjectKeyrings
  snapshotInvalidator: SnapshotInvalidator
  requestRemoteDeletion?: RemoteDeletionRequest
}>

export type DeletionWorkflowResult = Readonly<{
  state: 'completed'
  eventsRemoved: number
  deliveryRowsRemoved: number
}>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export const REMOTE_SETTLED_STATES: ReadonlySet<string> = new Set(['delivered', 'sending', 'ambiguous'])

const insertWithdrawalCensorsIn = (tx: Tx, actorKeys: readonly string[], nowMs: number): void => {
  for (const actorKey of actorKeys) {
    const existing = tx
      .select({ actorKey: analyticsCensorIntervals.actorKey })
      .from(analyticsCensorIntervals)
      .where(and(eq(analyticsCensorIntervals.actorKey, actorKey), eq(analyticsCensorIntervals.kind, 'withdrawal')))
      .get()
    if (existing !== undefined) continue
    tx.insert(analyticsCensorIntervals)
      .values({ actorKey, kind: 'withdrawal', startMs: nowMs, endMs: null, censorVersion: 1 })
      .run()
  }
}

const governanceEncryptionKeys = (keyrings: SubjectKeyrings): readonly Buffer[] => {
  if (keyrings.governance.kind !== 'available') {
    throw new DeletionIncompleteError('governance keyring unavailable; deletion cannot resume')
  }
  const { activeKey, activeVersion, keys } = keyrings.governance
  const retired = [...keys.entries()].filter(([version]) => version !== activeVersion).map(([, key]) => key)
  return [activeKey, ...retired]
}

const listSubjectEventIds = (
  db: Db,
  analyticsActorKeys: readonly string[],
): readonly { eventId: string; occurredAtMs: number }[] => {
  if (analyticsActorKeys.length === 0) return []
  return db
    .select({ eventId: analyticsEvents.eventId, occurredAtMs: analyticsEvents.occurredAtMs })
    .from(analyticsEvents)
    .where(inArray(analyticsEvents.actorKey, [...analyticsActorKeys]))
    .all()
}

export const confirmRemoteDeletions = (
  sinkVersionIds: readonly string[],
  requestRemoteDeletion: RemoteDeletionRequest | undefined,
): readonly Readonly<{ sinkVersionId: string; remoteReceiptHash: string }>[] | null => {
  const confirmations: { sinkVersionId: string; remoteReceiptHash: string }[] = []
  for (const sinkVersionId of [...sinkVersionIds].sort()) {
    const confirmation = requestRemoteDeletion === undefined ? null : requestRemoteDeletion(sinkVersionId)
    if (confirmation === null) {
      log.warn('remote deletion was not confirmed')
      return null
    }
    confirmations.push({ sinkVersionId, remoteReceiptHash: confirmation.remoteReceiptHash })
  }
  return confirmations
}

const settleAndRemoveEventGraph = (
  db: Db,
  input: Readonly<{ requestId: string; nowMs: number }>,
  targets: Readonly<{ analyticsActorKeys: readonly string[] }>,
  eventIds: readonly string[],
  confirmations: readonly Readonly<{ sinkVersionId: string; remoteReceiptHash: string }>[],
): Readonly<{ deliveryRowsRemoved: number; eventsRemoved: number }> =>
  db.transaction((tx) => {
    cancelNeverStartedIn(tx, eventIds)
    markSendingAmbiguousIn(tx, eventIds)
    for (const confirmation of confirmations) {
      tx.insert(analyticsDeliveryDeletionReceipts)
        .values({
          deletionRequestId: input.requestId,
          sinkVersionId: confirmation.sinkVersionId,
          state: 'reconciled',
          remoteReceiptHash: confirmation.remoteReceiptHash,
          requestedAtMs: input.nowMs,
          reconciledAtMs: input.nowMs,
        })
        .onConflictDoNothing()
        .run()
    }
    const deliveryRowsRemoved = deleteDeliveryRowsForEventsIn(tx, eventIds)
    if (eventIds.length > 0) {
      tx.delete(analyticsBackfillEventMap)
        .where(inArray(analyticsBackfillEventMap.eventId, [...eventIds]))
        .run()
      tx.delete(analyticsEventCollectionRefs)
        .where(inArray(analyticsEventCollectionRefs.eventId, [...eventIds]))
        .run()
    }
    const eventsRemoved = deleteEventRowsIn(tx, eventIds)
    insertWithdrawalCensorsIn(tx, targets.analyticsActorKeys, input.nowMs)
    return { deliveryRowsRemoved, eventsRemoved }
  })

const failRequest = (db: Db, requestId: string, nowMs: number): void => {
  db.transaction((tx) => {
    markDeletionRequestStateIn(tx, { requestId, state: 'failed', nowMs })
  })
}

const resolveResumableTargets = (
  db: Db,
  input: Readonly<{ requestId: string; nowMs: number }>,
  deps: SubjectDeletionDeps,
): DeletionTargetSet | 'completed' => {
  const request = getDeletionRequest(input.requestId, deps)
  if (request === null) throw new DeletionIncompleteError('deletion request not found')
  if (request.state === 'completed') return 'completed'
  const targets = openDeletionTargets(
    { requestId: input.requestId, encryptionKeys: governanceEncryptionKeys(deps.keyrings) },
    deps,
  )
  if (targets === null) {
    throw new DeletionIncompleteError('deletion target bundle unavailable; the request cannot be resumed')
  }
  db.transaction((tx) => {
    markDeletionRequestStateIn(tx, { requestId: input.requestId, state: 'in_progress', nowMs: input.nowMs })
  })
  return targets
}

const completeRequest = (
  db: Db,
  deps: SubjectDeletionDeps,
  input: Readonly<{ requestId: string; nowMs: number }>,
): void => {
  const invalidation = deps.snapshotInvalidator({ reason: 'subject_deletion', nowMs: input.nowMs })
  if (invalidation.publishedSnapshotContainsContribution) {
    throw new DeletionIncompleteError('a published snapshot still contains the subject contribution')
  }
  db.transaction((tx) => {
    destroyDeletionTargetCiphertextIn(tx, { requestId: input.requestId, nowMs: input.nowMs })
    markDeletionRequestStateIn(tx, { requestId: input.requestId, state: 'completed', nowMs: input.nowMs })
  })
}

export const executeDeletionWorkflow = (
  input: Readonly<{ requestId: string; nowMs: number }>,
  deps: SubjectDeletionDeps,
): DeletionWorkflowResult => {
  const db = deps.getDrizzleDb()
  const targets = resolveResumableTargets(db, input, deps)
  if (targets === 'completed') return { state: 'completed', eventsRemoved: 0, deliveryRowsRemoved: 0 }

  const events = listSubjectEventIds(db, targets.analyticsActorKeys)
  const eventIds = events.map((row) => row.eventId)
  const deliveryRows = listDeliveryRowsForEvents(db, eventIds)
  const remoteSinks = [
    ...new Set(deliveryRows.filter((row) => REMOTE_SETTLED_STATES.has(row.state)).map((row) => row.sinkVersionId)),
  ]

  const confirmations = confirmRemoteDeletions(remoteSinks, deps.requestRemoteDeletion)
  if (confirmations === null) {
    failRequest(db, input.requestId, input.nowMs)
    throw new DeletionIncompleteError('remote deletion was not confirmed for every approved sink')
  }

  const settled = settleAndRemoveEventGraph(db, input, targets, eventIds, confirmations)

  const utcDays = [
    ...new Set(
      events.map((row) => new Date(row.occurredAtMs - (row.occurredAtMs % DAY_MS)).toISOString().slice(0, 10)),
    ),
  ]
  if (utcDays.length > 0) rebuildDailyAggregatesForDays({ utcDays, nowMs: input.nowMs }, deps)

  completeRequest(db, deps, input)
  log.info({ eventsRemoved: settled.eventsRemoved }, 'subject deletion workflow completed')
  return { state: 'completed', eventsRemoved: settled.eventsRemoved, deliveryRowsRemoved: settled.deliveryRowsRemoved }
}
