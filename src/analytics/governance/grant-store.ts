// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsEligibilityGrants } from '../../db/schema.js'
import type { AnalyticsEligibilityGrantRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { Pseudonym } from '../controlled-types.js'
import { createPseudonym } from '../identity/pseudonym.js'
import type { DeliveryGrantRef } from './eligibility.js'

const log = logger.child({ scope: 'analytics:governance:grant-store' })

export const DELIVERY_GRANT_DOMAIN = 'delivery-grant:v1'

export type GrantStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
}>

const DEFAULT_DEPS: GrantStoreDeps = { getDrizzleDb: defaultGetDrizzleDb }

export const deriveDeliveryGrantKey = (input: {
  key: Buffer | Uint8Array
  keyVersion: string
  platformInstanceId: string
  platformUserId: string
}): Pseudonym =>
  createPseudonym({
    key: input.key,
    keyVersion: input.keyVersion,
    domain: DELIVERY_GRANT_DOMAIN,
    components: [input.platformInstanceId, input.platformUserId],
  })

const toRef = (row: AnalyticsEligibilityGrantRow): DeliveryGrantRef => ({
  grantKey: row.grantKey,
  keyVersion: row.keyVersion,
  generation: row.generation,
})

export const getGrant = (grantKey: string, deps: GrantStoreDeps = DEFAULT_DEPS): DeliveryGrantRef | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsEligibilityGrants)
    .where(and(eq(analyticsEligibilityGrants.grantKey, grantKey), eq(analyticsEligibilityGrants.state, 'allow')))
    .get()
  return row === undefined ? null : toRef(row)
}

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export const checkGrantCurrentIn = (
  db: Db | Tx,
  input: Readonly<{ grantKey: string; keyVersion: string; generation: number }>,
): boolean => {
  const row = db
    .select({ grantKey: analyticsEligibilityGrants.grantKey })
    .from(analyticsEligibilityGrants)
    .where(
      and(
        eq(analyticsEligibilityGrants.grantKey, input.grantKey),
        eq(analyticsEligibilityGrants.keyVersion, input.keyVersion),
        eq(analyticsEligibilityGrants.generation, input.generation),
        eq(analyticsEligibilityGrants.state, 'allow'),
      ),
    )
    .get()
  return row !== undefined
}

export const checkGrantCurrent = (
  input: Readonly<{ grantKey: string; keyVersion: string; generation: number }>,
  deps: GrantStoreDeps = DEFAULT_DEPS,
): boolean => checkGrantCurrentIn(deps.getDrizzleDb(), input)

export const listGrantVersions = (
  grantKeys: readonly string[],
  deps: GrantStoreDeps = DEFAULT_DEPS,
): AnalyticsEligibilityGrantRow[] => {
  if (grantKeys.length === 0) return []
  return deps
    .getDrizzleDb()
    .select()
    .from(analyticsEligibilityGrants)
    .where(inArray(analyticsEligibilityGrants.grantKey, [...grantKeys]))
    .all()
}

export const setGrantState = (
  input: Readonly<{
    grantKey: string
    keyVersion: string
    state: 'allow' | 'deny'
    policyVersion: number
    nowMs: number
  }>,
  deps: GrantStoreDeps = DEFAULT_DEPS,
): Readonly<{ generation: number }> => {
  const db = deps.getDrizzleDb()
  const generation = db.transaction((tx) => {
    const current = tx
      .select()
      .from(analyticsEligibilityGrants)
      .where(eq(analyticsEligibilityGrants.grantKey, input.grantKey))
      .get()
    const nextGeneration =
      input.state === 'deny' ? (current === undefined ? 1 : current.generation + 1) : (current?.generation ?? 1)
    if (current === undefined) {
      tx.insert(analyticsEligibilityGrants)
        .values({
          grantKey: input.grantKey,
          keyVersion: input.keyVersion,
          state: input.state,
          generation: nextGeneration,
          policyVersion: input.policyVersion,
          effectiveAt: input.nowMs,
          revokedAt: input.state === 'deny' ? input.nowMs : null,
        })
        .run()
    } else {
      tx.update(analyticsEligibilityGrants)
        .set({
          keyVersion: input.keyVersion,
          state: input.state,
          generation: nextGeneration,
          policyVersion: input.policyVersion,
          effectiveAt: input.nowMs,
          revokedAt: input.state === 'deny' ? input.nowMs : null,
        })
        .where(eq(analyticsEligibilityGrants.grantKey, input.grantKey))
        .run()
    }
    return nextGeneration
  })
  log.info({ state: input.state, generation }, 'delivery grant updated')
  return { generation }
}
