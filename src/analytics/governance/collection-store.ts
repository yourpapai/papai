// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsCollectionEligibility, analyticsEventCollectionRefs } from '../../db/schema.js'
import type { AnalyticsCollectionEligibilityRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { Pseudonym } from '../controlled-types.js'
import { createPseudonym } from '../identity/pseudonym.js'
import type { CollectionEligibilityRef } from './eligibility.js'

const log = logger.child({ scope: 'analytics:governance:collection-store' })

export const COLLECTION_ELIGIBILITY_DOMAIN = 'collection-eligibility:v1'

export type CollectionStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
}>

const DEFAULT_DEPS: CollectionStoreDeps = { getDrizzleDb: defaultGetDrizzleDb }

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export const revokeEligibilityInTx = (
  tx: Tx,
  input: Readonly<{ refKey: string; policyVersion: number; nowMs: number }>,
): Readonly<{ generation: number }> | null => {
  const current = tx
    .select()
    .from(analyticsCollectionEligibility)
    .where(eq(analyticsCollectionEligibility.refKey, input.refKey))
    .get()
  if (current === undefined) return null
  if (current.state === 'deny') return { generation: current.generation }
  const nextGeneration = current.generation + 1
  tx.update(analyticsCollectionEligibility)
    .set({
      state: 'deny',
      generation: nextGeneration,
      policyVersion: input.policyVersion,
      revokedAt: input.nowMs,
    })
    .where(eq(analyticsCollectionEligibility.refKey, input.refKey))
    .run()
  return { generation: nextGeneration }
}

export const deriveCollectionRefKey = (input: {
  key: Buffer | Uint8Array
  keyVersion: string
  platformInstanceId: string
  platformUserId: string
}): Pseudonym =>
  createPseudonym({
    key: input.key,
    keyVersion: input.keyVersion,
    domain: COLLECTION_ELIGIBILITY_DOMAIN,
    components: [input.platformInstanceId, input.platformUserId],
  })

const toRef = (row: AnalyticsCollectionEligibilityRow): CollectionEligibilityRef => ({
  refKey: row.refKey,
  keyVersion: row.keyVersion,
  generation: row.generation,
})

export const getEligibilityRef = (
  refKey: string,
  deps: CollectionStoreDeps = DEFAULT_DEPS,
): CollectionEligibilityRef | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsCollectionEligibility)
    .where(and(eq(analyticsCollectionEligibility.refKey, refKey), eq(analyticsCollectionEligibility.state, 'allow')))
    .get()
  return row === undefined ? null : toRef(row)
}

export const listEligibilityVersions = (
  refKeys: readonly string[],
  deps: CollectionStoreDeps = DEFAULT_DEPS,
): AnalyticsCollectionEligibilityRow[] => {
  if (refKeys.length === 0) return []
  return deps
    .getDrizzleDb()
    .select()
    .from(analyticsCollectionEligibility)
    .where(inArray(analyticsCollectionEligibility.refKey, [...refKeys]))
    .all()
}

export const setEligibilityState = (
  input: Readonly<{
    refKey: string
    keyVersion: string
    state: 'allow' | 'deny'
    policyVersion: number
    nowMs: number
  }>,
  deps: CollectionStoreDeps = DEFAULT_DEPS,
): Readonly<{ generation: number }> => {
  const db = deps.getDrizzleDb()
  const generation = db.transaction((tx) => {
    const current = tx
      .select()
      .from(analyticsCollectionEligibility)
      .where(eq(analyticsCollectionEligibility.refKey, input.refKey))
      .get()
    const nextGeneration =
      input.state === 'deny' ? (current === undefined ? 1 : current.generation + 1) : (current?.generation ?? 1)
    if (current === undefined) {
      tx.insert(analyticsCollectionEligibility)
        .values({
          refKey: input.refKey,
          keyVersion: input.keyVersion,
          state: input.state,
          generation: nextGeneration,
          policyVersion: input.policyVersion,
          effectiveAt: input.nowMs,
          revokedAt: input.state === 'deny' ? input.nowMs : null,
        })
        .run()
    } else {
      tx.update(analyticsCollectionEligibility)
        .set({
          keyVersion: input.keyVersion,
          state: input.state,
          generation: nextGeneration,
          policyVersion: input.policyVersion,
          effectiveAt: input.nowMs,
          revokedAt: input.state === 'deny' ? input.nowMs : null,
        })
        .where(eq(analyticsCollectionEligibility.refKey, input.refKey))
        .run()
    }
    return nextGeneration
  })
  log.info({ state: input.state, generation }, 'collection eligibility updated')
  return { generation }
}

export const recheckAndAssociateEvent = (
  input: Readonly<{
    ref: CollectionEligibilityRef
    eventId: string
    nowMs: number
  }>,
  deps: CollectionStoreDeps = DEFAULT_DEPS,
): Readonly<{ status: 'associated' | 'not_eligible' }> => {
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(analyticsCollectionEligibility)
      .where(
        and(
          eq(analyticsCollectionEligibility.refKey, input.ref.refKey),
          eq(analyticsCollectionEligibility.keyVersion, input.ref.keyVersion),
          eq(analyticsCollectionEligibility.generation, input.ref.generation),
          eq(analyticsCollectionEligibility.state, 'allow'),
        ),
      )
      .get()
    if (current === undefined) {
      log.warn({ eventId: input.eventId }, 'collection eligibility recheck failed; event not associated')
      return { status: 'not_eligible' }
    }
    tx.insert(analyticsEventCollectionRefs)
      .values({
        eventId: input.eventId,
        refKey: input.ref.refKey,
        keyVersion: input.ref.keyVersion,
        generation: input.ref.generation,
        createdAt: input.nowMs,
      })
      .run()
    return { status: 'associated' }
  })
}
