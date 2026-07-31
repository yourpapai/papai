// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import {
  analyticsDeletionRequests,
  analyticsDeletionTargetBundles,
  analyticsDeliveries,
  analyticsEventCollectionRefs,
  analyticsEvents,
} from '../../db/schema.js'
import type { AnalyticsEventRow, AnalyticsRekeyRunRow } from '../../db/schema.js'
import { openDeletionTargetsIn, sealDeletionTargetPayload } from '../governance/deletion-target-store.js'
import { deriveRekeyedPseudonym } from '../identity/pseudonym.js'
import { insertShadowParentIn, remapEventRowForTarget, shadowEventIdFor } from './dual-write.js'
import type { RekeyFullKeyMaterial } from './dual-write.js'
import type { RekeyTx } from './run-store.js'

export const analyticsRemap = (material: RekeyFullKeyMaterial, domain: string, value: string | null): string | null => {
  if (value === null) return null
  return deriveRekeyedPseudonym({
    key: material.analyticsToKey,
    keyVersion: material.toVersion,
    domain,
    sourcePseudonym: value,
  })
}

export const governanceRemap = (material: RekeyFullKeyMaterial, domain: string, value: string): string =>
  deriveRekeyedPseudonym({
    key: material.governanceToKey,
    keyVersion: material.toVersion,
    domain,
    sourcePseudonym: value,
  })

export const sourceEventMapIn = (tx: RekeyTx, sourceGeneration: string): ReadonlyMap<string, AnalyticsEventRow> => {
  const rows = tx.select().from(analyticsEvents).where(eq(analyticsEvents.storageGeneration, sourceGeneration)).all()
  return new Map(rows.map((row) => [row.eventId, row]))
}

/**
 * Generation-scoped event/source uniqueness guard: a child may only point at
 * a target-shadow parent that actually exists for the source parent.
 */
export const requireShadowParentIn = (
  tx: RekeyTx,
  sourceEvents: ReadonlyMap<string, AnalyticsEventRow>,
  sourceEventId: string,
  targetGeneration: string,
): string => {
  const sourceRow = sourceEvents.get(sourceEventId)
  if (sourceRow === undefined) throw new Error('rekey child references an event outside the source generation')
  const shadowEventId = shadowEventIdFor(sourceRow, targetGeneration)
  const shadow = tx
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.eventId, shadowEventId))
    .get()
  if (shadow === undefined) throw new Error('rekey child refused: target-shadow parent is missing')
  return shadowEventId
}

/** copy_parents.events_sources: one shadow parent per source parent, FK-first. */
export const copyParentsIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow, material: RekeyFullKeyMaterial): number => {
  const sourceRows = tx
    .select()
    .from(analyticsEvents)
    .where(eq(analyticsEvents.storageGeneration, run.sourceGeneration))
    .all()
  let copied = 0
  for (const row of sourceRows) {
    const ref = tx
      .select()
      .from(analyticsEventCollectionRefs)
      .where(eq(analyticsEventCollectionRefs.eventId, row.eventId))
      .get()
    const result = insertShadowParentIn(tx, {
      activeRow: row,
      collectionRef:
        ref === undefined ? null : { refKey: ref.refKey, keyVersion: ref.keyVersion, generation: ref.generation },
      run,
      material: {
        toVersion: material.toVersion,
        toKey: material.analyticsToKey,
        encryptionKey: material.encryptionKey,
      },
    })
    if (result.status === 'created') copied += 1
  }
  return copied
}

/**
 * Shadow delivery rows are held unleasable as `pending` with a far-future
 * `nextAttemptAtMs` (the deliveries state CHECK has no hold state). Only the
 * remote_resend subphase may re-arm a held row after grant/expiry/sink checks.
 */
export const REKEY_HELD_NEXT_ATTEMPT_MS = 253_402_300_799_000

const HELD_DELIVERY_STATES: ReadonlySet<string> = new Set(['pending', 'leased', 'sending', 'ambiguous', 'delivered'])

const copyHeldDeliveriesIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
  sourceEvents: ReadonlyMap<string, AnalyticsEventRow>,
): void => {
  for (const row of tx.select().from(analyticsDeliveries).all()) {
    if (!sourceEvents.has(row.eventId)) continue
    const newEventId = requireShadowParentIn(tx, sourceEvents, row.eventId, run.targetGeneration)
    const exists = tx
      .select()
      .from(analyticsDeliveries)
      .where(and(eq(analyticsDeliveries.eventId, newEventId), eq(analyticsDeliveries.sinkVersionId, row.sinkVersionId)))
      .get()
    if (exists !== undefined) continue
    tx.insert(analyticsDeliveries)
      .values({
        ...row,
        eventId: newEventId,
        grantKey: governanceRemap(material, 'delivery-grant:v1', row.grantKey),
        grantKeyVersion: material.toVersion,
        state: HELD_DELIVERY_STATES.has(row.state) ? 'pending' : row.state,
        nextAttemptAtMs: HELD_DELIVERY_STATES.has(row.state) ? REKEY_HELD_NEXT_ATTEMPT_MS : row.nextAttemptAtMs,
        leaseUntilMs: null,
        sendStartedAtMs: null,
        deliveredAtMs: null,
        remoteReceiptHash: null,
        deleteRequestedAtMs: null,
        deletedAtMs: null,
      })
      .run()
  }
}

const resealDeletionTargetsIn = (tx: RekeyTx, material: RekeyFullKeyMaterial): void => {
  for (const request of tx.select().from(analyticsDeletionRequests).all()) {
    if (request.state === 'completed' || request.keyVersion === material.toVersion) continue
    const targets = openDeletionTargetsIn(tx, { requestId: request.requestId, encryptionKeys: material.encryptionKeys })
    if (targets === null) continue
    const augmented = {
      analyticsActorKeys: [
        ...new Set([
          ...targets.analyticsActorKeys,
          ...targets.analyticsActorKeys.map((key) => analyticsRemap(material, 'actor:v1', key) ?? key),
        ]),
      ],
      governanceActorKeys: [
        ...new Set([
          ...targets.governanceActorKeys,
          ...targets.governanceActorKeys.map((key) => governanceRemap(material, 'governance-actor:v1', key)),
        ]),
      ],
      collectionRefKeys: [
        ...new Set([
          ...targets.collectionRefKeys,
          ...targets.collectionRefKeys.map((key) => governanceRemap(material, 'collection-eligibility:v1', key)),
        ]),
      ],
      grantKeys: [
        ...new Set([
          ...targets.grantKeys,
          ...targets.grantKeys.map((key) => governanceRemap(material, 'delivery-grant:v1', key)),
        ]),
      ],
    }
    const sealed = sealDeletionTargetPayload(augmented, material.encryptionKey)
    tx.update(analyticsDeletionTargetBundles)
      .set({ targetCiphertext: sealed.ciphertext, targetHash: sealed.targetHash })
      .where(eq(analyticsDeletionTargetBundles.requestId, request.requestId))
      .run()
    tx.update(analyticsDeletionRequests)
      .set({ keyVersion: material.toVersion })
      .where(eq(analyticsDeletionRequests.requestId, request.requestId))
      .run()
  }
}

/** copy_children.delivery_deletion: held shadow deliveries, preserved receipts, resealed deletion targets. */
export const copyChildrenDeliveryDeletionIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
): void => {
  copyHeldDeliveriesIn(tx, run, material, sourceEventMapIn(tx, run.sourceGeneration))
  resealDeletionTargetsIn(tx, material)
}

export { remapEventRowForTarget }
