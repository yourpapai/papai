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
import { createDefaultGovernanceDualWriteResolver } from '../rekey/governance-dual-write.js'
import type { GovernanceDualWriteResolver } from '../rekey/governance-dual-write.js'
import type { CollectionEligibilityRef } from './eligibility.js'

const log = logger.child({ scope: 'analytics:governance:collection-store' })

export const COLLECTION_ELIGIBILITY_DOMAIN = 'collection-eligibility:v1'

export type CollectionStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  dualWriteResolver?: GovernanceDualWriteResolver
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

export type SetEligibilityStateInput = Readonly<{
  refKey: string
  keyVersion: string
  state: 'allow' | 'deny'
  policyVersion: number
  nowMs: number
}>

const upsertEligibilityInTx = (tx: Tx, input: SetEligibilityStateInput, nextGeneration: number): void => {
  const writable = {
    keyVersion: input.keyVersion,
    state: input.state,
    generation: nextGeneration,
    policyVersion: input.policyVersion,
    effectiveAt: input.nowMs,
    revokedAt: input.state === 'deny' ? input.nowMs : null,
  }
  const current = tx
    .select()
    .from(analyticsCollectionEligibility)
    .where(eq(analyticsCollectionEligibility.refKey, input.refKey))
    .get()
  if (current === undefined) {
    tx.insert(analyticsCollectionEligibility)
      .values({ refKey: input.refKey, ...writable })
      .run()
    return
  }
  tx.update(analyticsCollectionEligibility)
    .set(writable)
    .where(eq(analyticsCollectionEligibility.refKey, input.refKey))
    .run()
}

const mirrorEligibilityInTx = (
  tx: Tx,
  resolver: GovernanceDualWriteResolver,
  sourceRefKey: string,
  mirror: Readonly<{ state: 'allow' | 'deny'; generation: number; policyVersion: number; nowMs: number }>,
): void => {
  const target = resolver(COLLECTION_ELIGIBILITY_DOMAIN, sourceRefKey)
  if (target === null) return
  const current = tx
    .select()
    .from(analyticsCollectionEligibility)
    .where(eq(analyticsCollectionEligibility.refKey, target.key))
    .get()
  if (current === undefined) {
    tx.insert(analyticsCollectionEligibility)
      .values({
        refKey: target.key,
        keyVersion: target.keyVersion,
        state: mirror.state,
        generation: mirror.generation,
        policyVersion: mirror.policyVersion,
        effectiveAt: mirror.nowMs,
        revokedAt: mirror.state === 'deny' ? mirror.nowMs : null,
      })
      .run()
    return
  }
  tx.update(analyticsCollectionEligibility)
    .set({
      keyVersion: target.keyVersion,
      state: mirror.state,
      generation: mirror.generation,
      policyVersion: mirror.policyVersion,
      revokedAt: mirror.state === 'deny' ? (current.revokedAt ?? mirror.nowMs) : null,
    })
    .where(eq(analyticsCollectionEligibility.refKey, target.key))
    .run()
}

/**
 * The one write both the ordinary setter and the transactional grant share.
 * Deny advances the generation so events associated under the prior one stay
 * orphaned; allow keeps it, because a deny row was never associable and so has
 * no generation to step past.
 */
const applyEligibilityStateInTx = (
  tx: Tx,
  resolver: GovernanceDualWriteResolver,
  input: SetEligibilityStateInput,
): number => {
  const current = tx
    .select()
    .from(analyticsCollectionEligibility)
    .where(eq(analyticsCollectionEligibility.refKey, input.refKey))
    .get()
  const nextGeneration =
    input.state === 'deny' ? (current === undefined ? 1 : current.generation + 1) : (current?.generation ?? 1)
  upsertEligibilityInTx(tx, input, nextGeneration)
  mirrorEligibilityInTx(tx, resolver, input.refKey, {
    state: input.state,
    generation: nextGeneration,
    policyVersion: input.policyVersion,
    nowMs: input.nowMs,
  })
  return nextGeneration
}

export const setEligibilityState = (
  input: SetEligibilityStateInput,
  deps: CollectionStoreDeps = DEFAULT_DEPS,
): Readonly<{ generation: number }> => {
  const db = deps.getDrizzleDb()
  const resolver = deps.dualWriteResolver ?? createDefaultGovernanceDualWriteResolver(deps.getDrizzleDb)
  const generation = db.transaction((tx) => applyEligibilityStateInTx(tx, resolver, input))
  log.info({ state: input.state, generation }, 'collection eligibility updated')
  return { generation }
}

/**
 * Grants collection eligibility inside the caller's transaction, so a consent
 * record and its ref commit or roll back as one. The transactional twin of
 * `revokeEligibilityInTx`; `setEligibilityState` remains the standalone
 * primitive for callers that own no transaction.
 */
export const grantEligibilityInTx = (
  tx: Tx,
  input: Readonly<{ refKey: string; keyVersion: string; policyVersion: number; nowMs: number }>,
  resolver: GovernanceDualWriteResolver = () => null,
): Readonly<{ generation: number }> => {
  const generation = applyEligibilityStateInTx(tx, resolver, { ...input, state: 'allow' })
  log.info({ state: 'allow', generation }, 'collection eligibility granted')
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
