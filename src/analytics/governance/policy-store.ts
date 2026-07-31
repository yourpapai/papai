// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsPolicy } from '../../db/schema.js'
import type { AnalyticsPolicyRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { KeyringState } from '../identity/keyring.js'

const log = logger.child({ scope: 'analytics:governance:policy-store' })

export const ANALYTICS_KILL_SWITCH_ENV = 'ANALYTICS_KILL_SWITCH'

export type PolicyStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  analyticsKeyring: KeyringState
  governanceKeyring: KeyringState
}>

export type EffectiveLanes = Readonly<{
  killSwitchActive: boolean
  localMode: 'off' | 'local_aggregate' | 'local_pseudonymous'
  externalAggregateEnabled: boolean
  externalPseudonymousEnabled: boolean
}>

export type GovernanceReadiness = Readonly<{
  ready: boolean
  missing: readonly string[]
}>

export type PolicyUpdateFields = Readonly<{
  localMode?: 'off' | 'local_aggregate' | 'local_pseudonymous'
  externalAggregateEnabled?: boolean
  externalPseudonymousEnabled?: boolean
  policyVersion?: number
  noticeVersion?: number
  controllerContact?: string
  purpose?: string
  lawfulBasisMode?: 'consent' | 'legitimate_interest'
  retainedEventHorizonDays?: number
  reviewDateMs?: number
  acknowledgedAtMs?: number
  policyEffectiveAtMs?: number
}>

const DEFAULT_DEPS = {
  getDrizzleDb: defaultGetDrizzleDb,
}

export const isKillSwitchActive = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => {
  const raw = env[ANALYTICS_KILL_SWITCH_ENV]
  if (raw === undefined) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'on'
}

export const getPolicy = (
  deps: Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }> = DEFAULT_DEPS,
): AnalyticsPolicyRow => {
  const row = deps.getDrizzleDb().select().from(analyticsPolicy).where(eq(analyticsPolicy.singletonId, 1)).get()
  if (row === undefined) throw new Error('analytics_policy singleton row is missing')
  return row
}

export const assessGovernanceReadiness = (input: {
  policy: AnalyticsPolicyRow
  analyticsKeyring: KeyringState
  governanceKeyring: KeyringState
}): GovernanceReadiness => {
  const missing: string[] = []
  if (input.policy.policyVersion === null) missing.push('policy_version')
  if (input.policy.noticeVersion === null) missing.push('notice_version')
  if (input.policy.controllerContact === null || input.policy.controllerContact.trim().length === 0) {
    missing.push('controller_contact')
  }
  if (input.policy.purpose === null || input.policy.purpose.trim().length === 0) missing.push('purpose')
  if (input.policy.lawfulBasisMode === null) missing.push('lawful_basis_mode')
  if (input.policy.retainedEventHorizonDays === null) missing.push('retention')
  if (input.policy.reviewDateMs === null) missing.push('review_date')
  if (input.policy.acknowledgedAtMs === null) missing.push('operator_acknowledgement')
  if (input.analyticsKeyring.kind !== 'available') missing.push('analytics_keyring')
  if (input.governanceKeyring.kind !== 'available') missing.push('governance_keyring')
  return { ready: missing.length === 0, missing }
}

const parseLocalMode = (value: string): EffectiveLanes['localMode'] => {
  if (value === 'off' || value === 'local_aggregate' || value === 'local_pseudonymous') return value
  throw new Error('analytics_policy holds an unknown local mode')
}

export const resolveEffectiveLanes = (input: {
  policy: AnalyticsPolicyRow
  env?: Readonly<Record<string, string | undefined>>
}): EffectiveLanes => {
  if (isKillSwitchActive(input.env ?? process.env)) {
    return {
      killSwitchActive: true,
      localMode: 'off',
      externalAggregateEnabled: false,
      externalPseudonymousEnabled: false,
    }
  }
  return {
    killSwitchActive: false,
    localMode: parseLocalMode(input.policy.localMode),
    externalAggregateEnabled: input.policy.externalAggregateEnabled,
    externalPseudonymousEnabled: input.policy.externalPseudonymousEnabled,
  }
}

const buildUpdateSet = (fields: PolicyUpdateFields, nowMs: number): Partial<typeof analyticsPolicy.$inferInsert> => {
  const set: Partial<typeof analyticsPolicy.$inferInsert> = {
    updatedAtMs: nowMs,
  }
  if (fields.localMode !== undefined) set.localMode = fields.localMode
  if (fields.externalAggregateEnabled !== undefined) set.externalAggregateEnabled = fields.externalAggregateEnabled
  if (fields.externalPseudonymousEnabled !== undefined) {
    set.externalPseudonymousEnabled = fields.externalPseudonymousEnabled
  }
  if (fields.policyVersion !== undefined) set.policyVersion = fields.policyVersion
  if (fields.noticeVersion !== undefined) set.noticeVersion = fields.noticeVersion
  if (fields.controllerContact !== undefined) set.controllerContact = fields.controllerContact
  if (fields.purpose !== undefined) set.purpose = fields.purpose
  if (fields.lawfulBasisMode !== undefined) set.lawfulBasisMode = fields.lawfulBasisMode
  if (fields.retainedEventHorizonDays !== undefined) set.retainedEventHorizonDays = fields.retainedEventHorizonDays
  if (fields.reviewDateMs !== undefined) set.reviewDateMs = fields.reviewDateMs
  if (fields.acknowledgedAtMs !== undefined) set.acknowledgedAtMs = fields.acknowledgedAtMs
  if (fields.policyEffectiveAtMs !== undefined) set.policyEffectiveAtMs = fields.policyEffectiveAtMs
  return set
}

export const updatePolicy = (
  input: Readonly<{
    expectedConfigVersion: number
    nowMs: number
    fields: PolicyUpdateFields
  }>,
  deps: PolicyStoreDeps,
): AnalyticsPolicyRow => {
  const db = deps.getDrizzleDb()
  const current = getPolicy({ getDrizzleDb: deps.getDrizzleDb })
  if (current.configVersion !== input.expectedConfigVersion) {
    log.warn({ expectedConfigVersion: input.expectedConfigVersion }, 'policy update rejected: config version mismatch')
    throw new Error('analytics_policy config version mismatch')
  }

  const merged: AnalyticsPolicyRow = {
    ...current,
    localMode: input.fields.localMode ?? current.localMode,
    externalPseudonymousEnabled: input.fields.externalPseudonymousEnabled ?? current.externalPseudonymousEnabled,
  }
  const pseudonymousRequested = merged.localMode === 'local_pseudonymous' || merged.externalPseudonymousEnabled
  if (pseudonymousRequested) {
    const candidate: AnalyticsPolicyRow = {
      ...current,
      ...buildUpdateSet(input.fields, input.nowMs),
    }
    const readiness = assessGovernanceReadiness({
      policy: candidate,
      analyticsKeyring: deps.analyticsKeyring,
      governanceKeyring: deps.governanceKeyring,
    })
    if (!readiness.ready) {
      log.warn({ missing: readiness.missing }, 'policy update rejected: governance incomplete')
      throw new Error(`governance incomplete: ${readiness.missing.join(',')}`)
    }
  }

  db.update(analyticsPolicy)
    .set({
      ...buildUpdateSet(input.fields, input.nowMs),
      configVersion: current.configVersion + 1,
    })
    .where(eq(analyticsPolicy.singletonId, 1))
    .run()
  log.info({ configVersion: current.configVersion + 1 }, 'analytics policy updated')
  return getPolicy({ getDrizzleDb: deps.getDrizzleDb })
}
