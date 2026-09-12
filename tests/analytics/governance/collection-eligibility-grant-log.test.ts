// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { createTrackedLoggerMock } from '../../utils/logger-mock.js'
import type { TrackedLoggerMock } from '../../utils/logger-mock.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { GKEYS, IDENTITY_A, refKeyFor, T } from '../subject-fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>
type CollectionStoreModule = typeof import('../../../src/analytics/governance/collection-store.js')

const isCollectionStoreModule = (value: unknown): value is CollectionStoreModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'grantEligibilityInTx') === 'function'

/**
 * collection-store.ts binds `logger.child({ scope: ... })` at module-eval time,
 * so the tracked mock only reaches it through a fresh evaluation (mirrors
 * tests/tools/search-memos.test.ts).
 */
const loadCollectionStore = async (tracked: TrackedLoggerMock): Promise<CollectionStoreModule> => {
  void mock.module('../../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  const loaded: unknown = await import(`../../../src/analytics/governance/collection-store.js?t=${crypto.randomUUID()}`)
  if (!isCollectionStoreModule(loaded)) throw new Error('collection-store module did not export expected shape')
  return loaded
}

describe('the collection-eligibility grant log record', () => {
  let db: Db
  let tracked: TrackedLoggerMock

  beforeEach(async () => {
    db = await setupTestDb()
    tracked = createTrackedLoggerMock()
  })

  const grantAndCapture = async (): Promise<object> => {
    const { grantEligibilityInTx } = await loadCollectionStore(tracked)
    db.transaction((tx) =>
      grantEligibilityInTx(tx, {
        refKey: refKeyFor(IDENTITY_A, 'v3'),
        keyVersion: 'v3',
        lane: 'local_longitudinal',
        policyVersion: 3,
        nowMs: T,
      }),
    )
    const call = tracked.getCallsByLevel('info').find((entry) => entry.args[1] === 'collection eligibility granted')
    if (call === undefined) throw new Error('no grant log record emitted')
    const meta = call.args[0]
    if (typeof meta !== 'object' || meta === null) throw new Error('grant log record carries no metadata object')
    return meta
  }

  test('names the consenting lane and the derived ref key', async () => {
    const meta = await grantAndCapture()

    // An operator reading the log needs to know which consent produced the ref
    // and which ref it was, without which the record cannot be reconciled
    // against the eligibility table.
    expect(meta).toEqual({
      state: 'allow',
      generation: 1,
      lane: 'local_longitudinal',
      refKey: refKeyFor(IDENTITY_A, 'v3'),
    })
  })

  test('carries no raw subject identifier and no keyring material', async () => {
    const serialized = JSON.stringify(await grantAndCapture())

    expect(serialized).not.toContain(IDENTITY_A.platformUserId)
    expect(serialized).not.toContain(IDENTITY_A.platformInstanceId)
    expect(serialized).not.toContain(GKEYS.v3.toString('hex'))
  })
})
