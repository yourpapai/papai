// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  ANALYTICS_KILL_SWITCH_ENV,
  assessGovernanceReadiness,
  getPolicy,
  isKillSwitchActive,
  resolveEffectiveLanes,
  updatePolicy,
} from '../../../src/analytics/governance/policy-store.js'
import { parseAnalyticsKeyring, parseGovernanceKeyring } from '../../../src/analytics/identity/keyring.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEYRING_VALUE = `v1:${'ab'.repeat(32)}`
const COMPLETE_FIELDS = {
  policyVersion: 1,
  noticeVersion: 1,
  controllerContact: 'dpo@example.com',
  purpose: 'product_analytics',
  lawfulBasisMode: 'consent',
  retainedEventHorizonDays: 30,
  reviewDateMs: 1700000000000,
  acknowledgedAtMs: 1700000000000,
  policyEffectiveAtMs: 1700000000000,
} as const

const availableKeyrings = (): {
  analyticsKeyring: ReturnType<typeof parseAnalyticsKeyring>
  governanceKeyring: ReturnType<typeof parseGovernanceKeyring>
} => ({
  analyticsKeyring: parseAnalyticsKeyring(KEYRING_VALUE),
  governanceKeyring: parseGovernanceKeyring(KEYRING_VALUE),
})

const completePolicy = (db: Db): void => {
  updatePolicy(
    { expectedConfigVersion: 1, nowMs: 1700000000000, fields: COMPLETE_FIELDS },
    { getDrizzleDb: () => db, ...availableKeyrings() },
  )
}

describe('analytics policy store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('default policy is local_aggregate with external lanes disabled and incomplete governance', () => {
    const policy = getPolicy({ getDrizzleDb: () => db })
    expect(policy.localMode).toBe('local_aggregate')
    expect(policy.externalAggregateEnabled).toBe(false)
    expect(policy.externalPseudonymousEnabled).toBe(false)

    const readiness = assessGovernanceReadiness({
      policy,
      ...availableKeyrings(),
    })
    expect(readiness.ready).toBe(false)
    expect(readiness.missing).toContain('policy_version')
    expect(readiness.missing).toContain('notice_version')
    expect(readiness.missing).toContain('controller_contact')
    expect(readiness.missing).toContain('purpose')
    expect(readiness.missing).toContain('lawful_basis_mode')
    expect(readiness.missing).toContain('retention')
    expect(readiness.missing).toContain('review_date')
    expect(readiness.missing).toContain('operator_acknowledgement')
  })

  test('readiness requires available analytics and governance keyrings', () => {
    completePolicy(db)
    const policy = getPolicy({ getDrizzleDb: () => db })
    expect(assessGovernanceReadiness({ policy, ...availableKeyrings() })).toEqual({ ready: true, missing: [] })

    const missingAnalytics = assessGovernanceReadiness({
      policy,
      analyticsKeyring: { kind: 'unavailable' },
      governanceKeyring: parseGovernanceKeyring(KEYRING_VALUE),
    })
    expect(missingAnalytics.ready).toBe(false)
    expect(missingAnalytics.missing).toContain('analytics_keyring')

    const missingGovernance = assessGovernanceReadiness({
      policy,
      analyticsKeyring: parseAnalyticsKeyring(KEYRING_VALUE),
      governanceKeyring: { kind: 'unavailable' },
    })
    expect(missingGovernance.ready).toBe(false)
    expect(missingGovernance.missing).toContain('governance_keyring')
  })

  test('an incomplete policy cannot enable local_pseudonymous', () => {
    expect(() =>
      updatePolicy(
        {
          expectedConfigVersion: 1,
          nowMs: 1700000000000,
          fields: { localMode: 'local_pseudonymous' },
        },
        { getDrizzleDb: () => db, ...availableKeyrings() },
      ),
    ).toThrow()
    expect(getPolicy({ getDrizzleDb: () => db }).localMode).toBe('local_aggregate')
  })

  test('an incomplete policy cannot enable external pseudonymous', () => {
    expect(() =>
      updatePolicy(
        {
          expectedConfigVersion: 1,
          nowMs: 1700000000000,
          fields: { externalPseudonymousEnabled: true },
        },
        { getDrizzleDb: () => db, ...availableKeyrings() },
      ),
    ).toThrow()
  })

  test('a complete policy enables local_pseudonymous and bumps config_version', () => {
    completePolicy(db)
    const updated = updatePolicy(
      {
        expectedConfigVersion: 2,
        nowMs: 1700000001000,
        fields: { localMode: 'local_pseudonymous' },
      },
      { getDrizzleDb: () => db, ...availableKeyrings() },
    )
    expect(updated.localMode).toBe('local_pseudonymous')
    expect(updated.configVersion).toBe(3)
    expect(updated.updatedAtMs).toBe(1700000001000)
  })

  test('update requires the expected config version', () => {
    expect(() =>
      updatePolicy(
        {
          expectedConfigVersion: 99,
          nowMs: 1700000000000,
          fields: { externalAggregateEnabled: true },
        },
        { getDrizzleDb: () => db, ...availableKeyrings() },
      ),
    ).toThrow()
  })

  test('the environment kill switch overrides every stored mode', () => {
    completePolicy(db)
    updatePolicy(
      {
        expectedConfigVersion: 2,
        nowMs: 1700000001000,
        fields: {
          localMode: 'local_pseudonymous',
          externalAggregateEnabled: true,
        },
      },
      { getDrizzleDb: () => db, ...availableKeyrings() },
    )
    const policy = getPolicy({ getDrizzleDb: () => db })

    const stored = resolveEffectiveLanes({ policy, env: {} })
    expect(stored).toEqual({
      killSwitchActive: false,
      localMode: 'local_pseudonymous',
      externalAggregateEnabled: true,
      externalPseudonymousEnabled: false,
    })

    const killed = resolveEffectiveLanes({
      policy,
      env: { [ANALYTICS_KILL_SWITCH_ENV]: '1' },
    })
    expect(killed).toEqual({
      killSwitchActive: true,
      localMode: 'off',
      externalAggregateEnabled: false,
      externalPseudonymousEnabled: false,
    })
  })

  test('no settings mutation can override the kill switch', () => {
    completePolicy(db)
    const env = { [ANALYTICS_KILL_SWITCH_ENV]: 'true' }
    updatePolicy(
      {
        expectedConfigVersion: 2,
        nowMs: 1700000001000,
        fields: { localMode: 'local_pseudonymous' },
      },
      { getDrizzleDb: () => db, ...availableKeyrings() },
    )
    const policy = getPolicy({ getDrizzleDb: () => db })
    expect(resolveEffectiveLanes({ policy, env }).localMode).toBe('off')
    expect(isKillSwitchActive(env)).toBe(true)
  })

  test('kill switch parser accepts only explicit truthy values', () => {
    expect(isKillSwitchActive({ [ANALYTICS_KILL_SWITCH_ENV]: '1' })).toBe(true)
    expect(isKillSwitchActive({ [ANALYTICS_KILL_SWITCH_ENV]: 'true' })).toBe(true)
    expect(isKillSwitchActive({ [ANALYTICS_KILL_SWITCH_ENV]: 'on' })).toBe(true)
    expect(isKillSwitchActive({ [ANALYTICS_KILL_SWITCH_ENV]: '0' })).toBe(false)
    expect(isKillSwitchActive({ [ANALYTICS_KILL_SWITCH_ENV]: 'false' })).toBe(false)
    expect(isKillSwitchActive({})).toBe(false)
  })
})
