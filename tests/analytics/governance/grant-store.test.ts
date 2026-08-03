// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { deriveCollectionRefKey } from '../../../src/analytics/governance/collection-store.js'
import {
  checkGrantCurrent,
  deriveDeliveryGrantKey,
  getGrant,
  listGrantVersions,
  setGrantState,
} from '../../../src/analytics/governance/grant-store.js'
import { deriveGovernanceActorKey } from '../../../src/analytics/governance/preference-store.js'
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

const grantKey = (): string => deriveDeliveryGrantKey(ACTOR_INPUT)

describe('analytics delivery grant store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('delivery-grant:v1 differs from governance, analytics, and collection domains', () => {
    const analyticsActorKey = createPseudonym({
      key: KEY,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['inst-1', 'user-1'],
    })
    const deliveryKey = deriveDeliveryGrantKey(ACTOR_INPUT)
    expect(deliveryKey).not.toBe(analyticsActorKey)
    expect(deliveryKey).not.toBe(deriveGovernanceActorKey(ACTOR_INPUT))
    expect(deliveryKey).not.toBe(deriveCollectionRefKey(ACTOR_INPUT))
  })

  test('allow exposes a generation-bearing grant ref passing the current generation check', () => {
    const result = setGrantState(
      {
        grantKey: grantKey(),
        keyVersion: 'v1',
        state: 'allow',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    expect(result.generation).toBe(1)
    expect(getGrant(grantKey(), { getDrizzleDb: () => db })).toEqual({
      grantKey: grantKey(),
      keyVersion: 'v1',
      generation: 1,
    })
    expect(
      checkGrantCurrent({ grantKey: grantKey(), keyVersion: 'v1', generation: 1 }, { getDrizzleDb: () => db }),
    ).toBe(true)
  })

  test('deny increases the generation and the stale generation check fails', () => {
    setGrantState(
      {
        grantKey: grantKey(),
        keyVersion: 'v1',
        state: 'allow',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    const denied = setGrantState(
      {
        grantKey: grantKey(),
        keyVersion: 'v1',
        state: 'deny',
        policyVersion: 1,
        nowMs: 1700000001000,
      },
      { getDrizzleDb: () => db },
    )
    expect(denied.generation).toBe(2)
    expect(getGrant(grantKey(), { getDrizzleDb: () => db })).toBeNull()
    expect(
      checkGrantCurrent({ grantKey: grantKey(), keyVersion: 'v1', generation: 1 }, { getDrizzleDb: () => db }),
    ).toBe(false)
    expect(
      checkGrantCurrent({ grantKey: grantKey(), keyVersion: 'v1', generation: 2 }, { getDrizzleDb: () => db }),
    ).toBe(false)
  })

  test('all retained deny key versions are returned', () => {
    const grantV1 = deriveDeliveryGrantKey(ACTOR_INPUT)
    const grantV2 = deriveDeliveryGrantKey({
      ...ACTOR_INPUT,
      keyVersion: 'v2',
    })
    setGrantState(
      {
        grantKey: grantV1,
        keyVersion: 'v1',
        state: 'deny',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    setGrantState(
      {
        grantKey: grantV2,
        keyVersion: 'v2',
        state: 'deny',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    const rows = listGrantVersions([grantV1, grantV2], {
      getDrizzleDb: () => db,
    })
    expect(rows.map((row) => row.keyVersion).sort()).toEqual(['v1', 'v2'])
    expect(rows.every((row) => row.state === 'deny')).toBe(true)
  })
})
