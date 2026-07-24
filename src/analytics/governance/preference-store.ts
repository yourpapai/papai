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

const log = logger.child({ scope: 'analytics:governance:preference-store' })

export const GOVERNANCE_ACTOR_DOMAIN = 'governance-actor:v1'

export type PreferenceStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
}>

export type PreferenceLane = 'local_longitudinal' | 'external_pseudonymous'
export type PreferenceValue = 'allow' | 'deny'
export type PreferenceSource = 'settings' | 'authenticated_request' | 'operator_migration'

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

type Tx = Parameters<ReturnType<typeof defaultGetDrizzleDb>['transaction']>[0] extends (tx: infer T) => unknown
  ? T
  : never

type PreferenceUpsertInput = Readonly<{
  governanceActorKey: string
  keyVersion: string
  policyVersion: number
  source: PreferenceSource
  nowMs: number
  apply: (
    current: AnalyticsPreferenceRow | undefined,
  ) => Pick<AnalyticsPreferenceRow, 'localLongitudinal' | 'externalPseudonymous'>
}>

const insertPreferenceRow = (
  tx: Tx,
  input: PreferenceUpsertInput,
  lanes: Pick<AnalyticsPreferenceRow, 'localLongitudinal' | 'externalPseudonymous'>,
): void => {
  tx.insert(analyticsPreferences)
    .values({
      governanceActorKey: input.governanceActorKey,
      keyVersion: input.keyVersion,
      localLongitudinal: lanes.localLongitudinal,
      externalPseudonymous: lanes.externalPseudonymous,
      policyVersion: input.policyVersion,
      source: input.source,
      effectiveAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .run()
}

const updatePreferenceRow = (
  tx: Tx,
  input: PreferenceUpsertInput,
  lanes: Pick<AnalyticsPreferenceRow, 'localLongitudinal' | 'externalPseudonymous'>,
): void => {
  tx.update(analyticsPreferences)
    .set({
      keyVersion: input.keyVersion,
      localLongitudinal: lanes.localLongitudinal,
      externalPseudonymous: lanes.externalPseudonymous,
      policyVersion: input.policyVersion,
      source: input.source,
      effectiveAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .where(eq(analyticsPreferences.governanceActorKey, input.governanceActorKey))
    .run()
}

const upsertPreferenceRow = (tx: Tx, input: PreferenceUpsertInput): AnalyticsPreferenceRow => {
  const current = tx
    .select()
    .from(analyticsPreferences)
    .where(eq(analyticsPreferences.governanceActorKey, input.governanceActorKey))
    .get()
  const lanes = input.apply(current)
  if (current === undefined) {
    insertPreferenceRow(tx, input, lanes)
  } else {
    updatePreferenceRow(tx, input, lanes)
  }
  const row = tx
    .select()
    .from(analyticsPreferences)
    .where(eq(analyticsPreferences.governanceActorKey, input.governanceActorKey))
    .get()
  if (row === undefined) throw new Error('preference upsert failed to persist')
  return row
}

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

export const setPreference = (
  input: Readonly<{
    governanceActorKey: string
    keyVersion: string
    lane: PreferenceLane
    value: PreferenceValue
    policyVersion: number
    source: PreferenceSource
    nowMs: number
  }>,
  deps: PreferenceStoreDeps = DEFAULT_DEPS,
): PreferenceMutationResult => {
  const auditId = randomUUID()
  const row = deps.getDrizzleDb().transaction((tx: Tx) => {
    const upserted = upsertPreferenceRow(tx, {
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
    appendAuditRow(tx, {
      auditId,
      governanceActorKey: input.governanceActorKey,
      action: input.value,
      policyVersion: input.policyVersion,
      nowMs: input.nowMs,
    })
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
  const row = deps.getDrizzleDb().transaction((tx: Tx) => {
    const upserted = upsertPreferenceRow(tx, {
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
