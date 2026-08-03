// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { deriveCollectionRefKey } from '../../../src/analytics/governance/collection-store.js'
import { deriveDeliveryGrantKey } from '../../../src/analytics/governance/grant-store.js'
import {
  deriveGovernanceActorKey,
  getPreference,
  listPolicyAudit,
  setPreference,
  withdrawPreference,
} from '../../../src/analytics/governance/preference-store.js'
import { createPseudonym } from '../../../src/analytics/identity/pseudonym.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 7)
const ACTOR_INPUT = {
  key: KEY,
  keyVersion: 'v1',
  platformInstanceId: 'inst-1',
  platformUserId: 'user-1',
}

const actorKey = (): string => deriveGovernanceActorKey(ACTOR_INPUT)

const setLocalAllow = (db: Db, nowMs: number): ReturnType<typeof setPreference> =>
  setPreference(
    {
      governanceActorKey: actorKey(),
      keyVersion: 'v1',
      lane: 'local_longitudinal',
      value: 'allow',
      policyVersion: 1,
      source: 'settings',
      nowMs,
    },
    { getDrizzleDb: () => db },
  )

describe('analytics preference store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('governance actor key differs from analytics, collection, and delivery domains', () => {
    const analyticsActorKey = createPseudonym({
      key: KEY,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['inst-1', 'user-1'],
    })
    const governanceKey = deriveGovernanceActorKey(ACTOR_INPUT)
    expect(governanceKey).not.toBe(analyticsActorKey)
    expect(governanceKey).not.toBe(deriveCollectionRefKey(ACTOR_INPUT))
    expect(governanceKey).not.toBe(deriveDeliveryGrantKey(ACTOR_INPUT))
  })

  test('first allow creates one current row and appends an applied audit row', () => {
    const result = setLocalAllow(db, 1700000000000)
    expect(result.status).toBe('applied')

    const row = getPreference(actorKey(), { getDrizzleDb: () => db })
    expect(row?.localLongitudinal).toBe('allow')
    expect(row?.externalPseudonymous).toBe('unknown')
    expect(row?.effectiveAt).toBe(1700000000000)
    expect(row?.updatedAt).toBe(1700000000000)

    const audit = listPolicyAudit(actorKey(), { getDrizzleDb: () => db })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: 'allow',
      result: 'applied',
      policyVersion: 1,
    })
  })

  test('deny UPSERT leaves exactly one current row and two append-only audit rows', () => {
    setLocalAllow(db, 1700000000000)
    setPreference(
      {
        governanceActorKey: actorKey(),
        keyVersion: 'v1',
        lane: 'local_longitudinal',
        value: 'deny',
        policyVersion: 1,
        source: 'settings',
        nowMs: 1700000001000,
      },
      { getDrizzleDb: () => db },
    )

    const row = getPreference(actorKey(), { getDrizzleDb: () => db })
    expect(row?.localLongitudinal).toBe('deny')
    expect(row?.updatedAt).toBe(1700000001000)

    const audit = listPolicyAudit(actorKey(), { getDrizzleDb: () => db })
    expect(audit).toHaveLength(2)
    expect(audit.map((entry) => entry.action)).toEqual(['allow', 'deny'])
    expect(audit.every((entry) => entry.result === 'applied')).toBe(true)
  })

  test('withdrawal stores deny on both lanes with a withdraw audit action', () => {
    setLocalAllow(db, 1700000000000)
    const result = withdrawPreference(
      {
        governanceActorKey: actorKey(),
        keyVersion: 'v1',
        policyVersion: 1,
        source: 'authenticated_request',
        nowMs: 1700000002000,
      },
      { getDrizzleDb: () => db },
    )
    expect(result.status).toBe('applied')

    const row = getPreference(actorKey(), { getDrizzleDb: () => db })
    expect(row?.localLongitudinal).toBe('deny')
    expect(row?.externalPseudonymous).toBe('deny')

    const audit = listPolicyAudit(actorKey(), { getDrizzleDb: () => db })
    expect(audit.map((entry) => entry.action)).toEqual(['allow', 'withdraw'])
  })

  test('the minimal deny marker row is retained after withdrawal', () => {
    setLocalAllow(db, 1700000000000)
    withdrawPreference(
      {
        governanceActorKey: actorKey(),
        keyVersion: 'v1',
        policyVersion: 1,
        source: 'authenticated_request',
        nowMs: 1700000002000,
      },
      { getDrizzleDb: () => db },
    )
    const row = getPreference(actorKey(), { getDrizzleDb: () => db })
    expect(row).not.toBeNull()
    expect(row?.localLongitudinal).toBe('deny')
  })

  test('the preference table has no supersedes_at column', () => {
    const columns = db.$client
      .query<{ name: string }, []>('PRAGMA table_info(analytics_preferences)')
      .all()
      .map((column) => column.name)
    expect(columns).not.toContain('supersedes_at')
  })
})
