// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createDeletionRequestIn,
  destroyDeletionTargetCiphertextIn,
  getDeletionRequest,
  listUnresolvedDeletionRequests,
  markDeletionRequestStateIn,
  openDeletionTargets,
  sealDeletionTargetsIn,
} from '../../../src/analytics/governance/deletion-target-store.js'
import type { DeletionTargetSet } from '../../../src/analytics/governance/deletion-target-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const T = 1_800_000_000_000
const KEY = Buffer.alloc(32, 9)

const TARGETS: DeletionTargetSet = {
  analyticsActorKeys: ['v1.a-one', 'v2.a-two'],
  governanceActorKeys: ['v1.g-one'],
  collectionRefKeys: ['v1.c-one', 'v3.c-three'],
  grantKeys: ['v2.d-two'],
}

const seedRequest = (db: Db, requestId = 'req-1'): void => {
  db.transaction((tx) => {
    createDeletionRequestIn(tx, {
      requestId,
      governanceActorKey: 'v1.g-one',
      keyVersion: 'v1',
      policyVersion: 3,
      nowMs: T,
    })
  })
}

describe('deletion target store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('a sealed bundle round-trips its targets without retaining native identity', () => {
    seedRequest(db)
    const targetHash = db.transaction((tx) =>
      sealDeletionTargetsIn(tx, { requestId: 'req-1', targets: TARGETS, encryptionKey: KEY, nowMs: T }),
    )
    expect(targetHash).toMatch(/^[0-9a-f]{64}$/u)
    const opened = openDeletionTargets({ requestId: 'req-1', encryptionKeys: [KEY] }, { getDrizzleDb: () => db })
    expect(opened).toEqual(TARGETS)
    const row = db.select().from(schema.analyticsDeletionTargetBundles).all()[0]
    expect(row?.targetCiphertext).not.toContain('v1.a-one')
    expect(row?.destroyedAt).toBeNull()
  })

  test('opening with the wrong key fails closed', () => {
    seedRequest(db)
    db.transaction((tx) =>
      sealDeletionTargetsIn(tx, { requestId: 'req-1', targets: TARGETS, encryptionKey: KEY, nowMs: T }),
    )
    expect(() =>
      openDeletionTargets({ requestId: 'req-1', encryptionKeys: [Buffer.alloc(32, 4)] }, { getDrizzleDb: () => db }),
    ).toThrow()
  })

  test('request state transitions are transactional and list only unresolved work', () => {
    seedRequest(db, 'req-a')
    seedRequest(db, 'req-b')
    db.transaction((tx) => markDeletionRequestStateIn(tx, { requestId: 'req-a', state: 'in_progress', nowMs: T + 1 }))
    expect(
      listUnresolvedDeletionRequests({ getDrizzleDb: () => db })
        .map((row) => row.requestId)
        .sort(),
    ).toEqual(['req-a', 'req-b'])
    db.transaction((tx) => markDeletionRequestStateIn(tx, { requestId: 'req-a', state: 'completed', nowMs: T + 2 }))
    expect(listUnresolvedDeletionRequests({ getDrizzleDb: () => db }).map((row) => row.requestId)).toEqual(['req-b'])
    const completed = getDeletionRequest('req-a', { getDrizzleDb: () => db })
    expect(completed?.state).toBe('completed')
    expect(completed?.completedAtMs).toBe(T + 2)
  })

  test('destroying the ciphertext retains the hash and blocks further opens', () => {
    seedRequest(db)
    db.transaction((tx) =>
      sealDeletionTargetsIn(tx, { requestId: 'req-1', targets: TARGETS, encryptionKey: KEY, nowMs: T }),
    )
    db.transaction((tx) => destroyDeletionTargetCiphertextIn(tx, { requestId: 'req-1', nowMs: T + 5 }))
    const row = db.select().from(schema.analyticsDeletionTargetBundles).all()[0]
    expect(row?.targetCiphertext).toBe('')
    expect(row?.targetHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(row?.destroyedAt).toBe(T + 5)
    expect(openDeletionTargets({ requestId: 'req-1', encryptionKeys: [KEY] }, { getDrizzleDb: () => db })).toBeNull()
  })

  test('a request without a bundle opens as null', () => {
    seedRequest(db)
    expect(openDeletionTargets({ requestId: 'req-1', encryptionKeys: [KEY] }, { getDrizzleDb: () => db })).toBeNull()
  })
})
