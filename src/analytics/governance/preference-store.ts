// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { asc, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsPolicyAudit, analyticsPreferences } from '../../db/schema.js'
import type { AnalyticsPolicyAuditRow, AnalyticsPreferenceRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { Pseudonym } from '../controlled-types.js'
import { createPseudonym } from '../identity/pseudonym.js'
import { createDefaultGovernanceDualWriteResolver } from '../rekey/governance-dual-write.js'
import type { GovernanceDualWriteResolver } from '../rekey/governance-dual-write.js'
import { upsertPreferenceRowInTx } from './preference-row.js'
import type { PreferenceTx as Tx } from './preference-row.js'
import type { PreferenceSource } from './preference-types.js'

const log = logger.child({ scope: 'analytics:governance:preference-store' })

export const GOVERNANCE_ACTOR_DOMAIN = 'governance-actor:v1'

export type PreferenceStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  dualWriteResolver?: GovernanceDualWriteResolver
}>

export type PreferenceLane = 'local_longitudinal' | 'external_pseudonymous'
export type PreferenceValue = 'allow' | 'deny'

export type PreferenceMutationResult = Readonly<{
  status: 'applied'
  auditId: string
  row: AnalyticsPreferenceRow
}>

const DEFAULT_DEPS: PreferenceStoreDeps = { getDrizzleDb: defaultGetDrizzleDb }

export const deriveGovernanceActorKey = (input: {
  key: Buffer | Uint8Array
  keyVersion: string
  platformInstanceId: string
  platformUserId: string
}): Pseudonym =>
  createPseudonym({
    key: input.key,
    keyVersion: input.keyVersion,
    domain: GOVERNANCE_ACTOR_DOMAIN,
    components: [input.platformInstanceId, input.platformUserId],
  })

export const getPreference = (
  governanceActorKey: string,
  deps: PreferenceStoreDeps = DEFAULT_DEPS,
): AnalyticsPreferenceRow | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsPreferences)
    .where(eq(analyticsPreferences.governanceActorKey, governanceActorKey))
    .get()
  return row ?? null
}

export const listPolicyAudit = (
  governanceActorKey: string,
  deps: PreferenceStoreDeps = DEFAULT_DEPS,
): AnalyticsPolicyAuditRow[] =>
  deps
    .getDrizzleDb()
    .select()
    .from(analyticsPolicyAudit)
    .where(eq(analyticsPolicyAudit.governanceActorKey, governanceActorKey))
    .orderBy(asc(analyticsPolicyAudit.occurredAt), asc(analyticsPolicyAudit.auditId))
    .all()

const appendAuditRow = (
  tx: Tx,
  input: Readonly<{
    auditId: string
    governanceActorKey: string
    action: 'allow' | 'deny' | 'withdraw'
    policyVersion: number
    nowMs: number
  }>,
): void => {
  tx.insert(analyticsPolicyAudit)
    .values({
      auditId: input.auditId,
      governanceActorKey: input.governanceActorKey,
      action: input.action,
      policyVersion: input.policyVersion,
      occurredAt: input.nowMs,
      result: 'applied',
      failureClass: null,
    })
    .run()
}

const mirrorPreferenceInTx = (
  tx: Tx,
  resolver: GovernanceDualWriteResolver,
  source: Readonly<{
    governanceActorKey: string
    policyVersion: number
    source: PreferenceSource
    nowMs: number
    lanes: Pick<AnalyticsPreferenceRow, 'localLongitudinal' | 'externalPseudonymous'>
  }>,
): void => {
  const target = resolver(GOVERNANCE_ACTOR_DOMAIN, source.governanceActorKey)
  if (target === null) return
  upsertPreferenceRowInTx(tx, {
    governanceActorKey: target.key,
    keyVersion: target.keyVersion,
    policyVersion: source.policyVersion,
    source: source.source,
    nowMs: source.nowMs,
    apply: () => ({
      localLongitudinal: source.lanes.localLongitudinal,
      externalPseudonymous: source.lanes.externalPseudonymous,
    }),
  })
}

/**
 * Runs inside the preference transaction, after the row is upserted and before
 * it commits, and receives the resulting lane state. Throwing rolls the whole
 * preference write back -- that is how a consent record is kept from outliving
 * the collection-eligibility ref it depends on.
 */
export type PreferenceAppliedInTx = (tx: Tx, row: AnalyticsPreferenceRow) => void

export const setPreference = (
  input: Readonly<{
    governanceActorKey: string
    keyVersion: string
    lane: PreferenceLane
    value: PreferenceValue
    policyVersion: number
    source: PreferenceSource
    nowMs: number
    onAppliedInTx?: PreferenceAppliedInTx
  }>,
  deps: PreferenceStoreDeps = DEFAULT_DEPS,
): PreferenceMutationResult => {
  const auditId = randomUUID()
  const resolver = deps.dualWriteResolver ?? createDefaultGovernanceDualWriteResolver(deps.getDrizzleDb)
  const row = deps.getDrizzleDb().transaction((tx: Tx) => {
    const upserted = upsertPreferenceRowInTx(tx, {
      governanceActorKey: input.governanceActorKey,
      keyVersion: input.keyVersion,
      policyVersion: input.policyVersion,
      source: input.source,
      nowMs: input.nowMs,
      apply: (current) => ({
        localLongitudinal:
          input.lane === 'local_longitudinal' ? input.value : (current?.localLongitudinal ?? 'unknown'),
        externalPseudonymous:
          input.lane === 'external_pseudonymous' ? input.value : (current?.externalPseudonymous ?? 'unknown'),
      }),
    })
    mirrorPreferenceInTx(tx, resolver, {
      governanceActorKey: input.governanceActorKey,
      policyVersion: input.policyVersion,
      source: input.source,
      nowMs: input.nowMs,
      lanes: { localLongitudinal: upserted.localLongitudinal, externalPseudonymous: upserted.externalPseudonymous },
    })
    appendAuditRow(tx, {
      auditId,
      governanceActorKey: input.governanceActorKey,
      action: input.value,
      policyVersion: input.policyVersion,
      nowMs: input.nowMs,
    })
    input.onAppliedInTx?.(tx, upserted)
    return upserted
  })
  log.info({ action: input.value, lane: input.lane }, 'analytics preference applied')
  return { status: 'applied', auditId, row }
}

export const withdrawPreference = (
  input: Readonly<{
    governanceActorKey: string
    keyVersion: string
    policyVersion: number
    source: PreferenceSource
    nowMs: number
  }>,
  deps: PreferenceStoreDeps = DEFAULT_DEPS,
): PreferenceMutationResult => {
  const auditId = randomUUID()
  const resolver = deps.dualWriteResolver ?? createDefaultGovernanceDualWriteResolver(deps.getDrizzleDb)
  const row = deps.getDrizzleDb().transaction((tx: Tx) => {
    const upserted = upsertPreferenceRowInTx(tx, {
      governanceActorKey: input.governanceActorKey,
      keyVersion: input.keyVersion,
      policyVersion: input.policyVersion,
      source: input.source,
      nowMs: input.nowMs,
      apply: () => ({
        localLongitudinal: 'deny',
        externalPseudonymous: 'deny',
      }),
    })
    mirrorPreferenceInTx(tx, resolver, {
      governanceActorKey: input.governanceActorKey,
      policyVersion: input.policyVersion,
      source: input.source,
      nowMs: input.nowMs,
      lanes: { localLongitudinal: 'deny', externalPseudonymous: 'deny' },
    })
    appendAuditRow(tx, {
      auditId,
      governanceActorKey: input.governanceActorKey,
      action: 'withdraw',
      policyVersion: input.policyVersion,
      nowMs: input.nowMs,
    })
    return upserted
  })
  log.info({ action: 'withdraw' }, 'analytics preference withdrawn')
  return { status: 'applied', auditId, row }
}
