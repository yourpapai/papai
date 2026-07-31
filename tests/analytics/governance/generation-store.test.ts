// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  completeRekeySwap,
  insertRekeyMapping,
  planRekeyRun,
  REKEY_MAPPING_DOMAINS,
  resolveActive,
  setActiveGeneration,
  SUBJECT_RIGHTS_LOOKUP_HORIZON_DAYS,
} from '../../../src/analytics/governance/generation-store.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY_MS = 86_400_000

const planRun = (db: Db, runId: string, target = 'gen-2'): void => {
  planRekeyRun(
    {
      runId,
      sourceGeneration: 'gen-1',
      targetGeneration: target,
      fromVersions: ['v1'],
      toVersions: ['v2'],
      sourceHighWater: 'hw-1',
      planHash: 'plan-hash',
      nowMs: 1700000000000,
    },
    { getDrizzleDb: () => db },
  )
}

describe('analytics generation store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('resolveActive reads the persisted singleton row', () => {
    const active = resolveActive({ getDrizzleDb: () => db })
    expect(active.generation).toBe('gen-1')
  })

  test('an atomic update changes the one row and updated_at_ms', () => {
    setActiveGeneration({ generation: 'gen-2', nowMs: 1700000000500 }, { getDrizzleDb: () => db })
    const active = resolveActive({ getDrizzleDb: () => db })
    expect(active.generation).toBe('gen-2')
    expect(active.updatedAtMs).toBe(1700000000500)
    const count = db.$client.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM analytics_active_generation').get()
    expect(count?.n).toBe(1)
  })

  test('the advisory cache invalidates on updated_at_ms changes', () => {
    resolveActive({ getDrizzleDb: () => db })
    db.$client.run(
      `UPDATE analytics_active_generation SET active_generation = 'gen-9', updated_at_ms = 1700000000999 WHERE singleton_id = 1`,
    )
    const active = resolveActive({ getDrizzleDb: () => db })
    expect(active.generation).toBe('gen-9')
    expect(active.updatedAtMs).toBe(1700000000999)
  })

  test('mapping domain registry covers the complete set including thread:v1', () => {
    expect(REKEY_MAPPING_DOMAINS).toContain('thread:v1')
    expect(REKEY_MAPPING_DOMAINS).toContain('governance-actor:v1')
    expect(REKEY_MAPPING_DOMAINS).toContain('collection-eligibility:v1')
    expect(REKEY_MAPPING_DOMAINS).toContain('delivery-grant:v1')
    expect(SUBJECT_RIGHTS_LOOKUP_HORIZON_DAYS).toBe(90)
  })

  test('a second nonterminal run fails transactionally; only a completed run permits a new plan', () => {
    planRun(db, 'run-1')
    expect(() => planRun(db, 'run-2')).toThrow()

    completeRekeySwap(
      { runId: 'run-1', retainedEventHorizonDays: 30, nowMs: 1700000001000 },
      { getDrizzleDb: () => db },
    )
    planRun(db, 'run-2', 'gen-3')
  })

  test('plan rejects equal source and target generations', () => {
    expect(() =>
      planRekeyRun(
        {
          runId: 'run-eq',
          sourceGeneration: 'gen-1',
          targetGeneration: 'gen-1',
          fromVersions: ['v1'],
          toVersions: ['v1'],
          sourceHighWater: 'hw',
          planHash: 'h',
          nowMs: 1700000000000,
        },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })

  test('mapping insert accepts registry domains and rejects unknown domains', () => {
    planRun(db, 'run-1')
    insertRekeyMapping(
      {
        runId: 'run-1',
        domain: 'thread:v1',
        oldKeyHash: 'old-hash',
        mappingCiphertext: 'ct',
        mappingHash: 'mh',
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    expect(() =>
      insertRekeyMapping(
        {
          runId: 'run-1',
          domain: 'native-user-id:v1',
          oldKeyHash: 'old-hash-2',
          mappingCiphertext: 'ct',
          mappingHash: 'mh',
          nowMs: 1700000000000,
        },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })

  test('swap anchors retirement to the greater of the configured horizon and the 90-day lookup horizon', () => {
    planRun(db, 'run-1')
    const swap = completeRekeySwap(
      { runId: 'run-1', retainedEventHorizonDays: 30, nowMs: 1700000001000 },
      { getDrizzleDb: () => db },
    )
    expect(swap.swapCompletedAtMs).toBe(1700000001000)
    expect(swap.retireNotBeforeMs).toBe(1700000001000 + 90 * DAY_MS)
    expect(resolveActive({ getDrizzleDb: () => db }).generation).toBe('gen-2')
  })

  test('swap with an equal 90-day configured horizon keeps the 90-day anchor', () => {
    planRun(db, 'run-1')
    const swap = completeRekeySwap(
      { runId: 'run-1', retainedEventHorizonDays: 90, nowMs: 1700000001000 },
      { getDrizzleDb: () => db },
    )
    expect(swap.retireNotBeforeMs).toBe(1700000001000 + 90 * DAY_MS)
  })

  test('swap rejects a configured horizon above the v1 90-day event-retention cap', () => {
    planRun(db, 'run-1')
    expect(() =>
      completeRekeySwap(
        { runId: 'run-1', retainedEventHorizonDays: 91, nowMs: 1700000001000 },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
    const active = resolveActive({ getDrizzleDb: () => db })
    expect(active.generation).toBe('gen-1')
  })
})
