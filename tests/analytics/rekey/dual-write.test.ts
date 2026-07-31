// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../../src/analytics/controlled-types.js'
import { insertEligibleCanonicalEvent } from '../../../src/analytics/governance/collection-serialization.js'
import type {
  CollectionSerializationDeps,
  InsertEligibleCanonicalEventResult,
} from '../../../src/analytics/governance/collection-serialization.js'
import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { shadowEventIdFor } from '../../../src/analytics/rekey/dual-write.js'
import type { RekeyKeyMaterial } from '../../../src/analytics/rekey/dual-write.js'
import { listMappingPairs } from '../../../src/analytics/rekey/mapping-store.js'
import { checkpointRekeyRunIn } from '../../../src/analytics/rekey/run-store.js'
import { physicalEventIdFor } from '../../../src/analytics/storage/event-store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { makeTestEvent } from '../storage-fixtures.js'
import { ANALYTICS_KEY_V2, countRows, GOV_KEY_V1, NOW, SOURCE_GEN, TARGET_GEN } from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const RUN_ID = 'run-1'

const depsOf = (db: Db): CollectionSerializationDeps => ({
  getDrizzleDb: (): Db => db,
  getRekeyKeyMaterial: (): RekeyKeyMaterial => ({
    toVersion: 'v2',
    toKey: ANALYTICS_KEY_V2,
    encryptionKey: GOV_KEY_V1,
  }),
})

const planAndArmDualWrite = (db: Db): void => {
  planRekeyRun(
    {
      runId: RUN_ID,
      sourceGeneration: SOURCE_GEN,
      targetGeneration: TARGET_GEN,
      fromVersions: ['v1'],
      toVersions: ['v2'],
      sourceHighWater: 'hw-1',
      planHash: 'plan-hash',
      nowMs: NOW,
    },
    { getDrizzleDb: () => db },
  )
  db.transaction((tx) => {
    checkpointRekeyRunIn(tx, {
      runId: RUN_ID,
      phase: 'dual_write',
      subphase: 'dual_write.identity',
      status: 'running',
      nowMs: NOW,
    })
  })
}

const seedEligibility = (db: Db): void => {
  db.$client.run(`INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('epoch-1', 'open', 0)`)
  db.$client.run(
    `INSERT INTO analytics_collection_eligibility (ref_key, key_version, state, generation, policy_version, effective_at)
     VALUES ('v1.p-colref', 'v1', 'allow', 1, 1, 0)`,
  )
}

const COLLECTION_REF = { refKey: 'v1.p-colref', keyVersion: 'v1', generation: 1 } as const

const insertLive = (db: Db, eventId: string): InsertEligibleCanonicalEventResult => {
  const base = makeTestEvent()
  return insertEligibleCanonicalEvent(
    {
      event: makeTestEvent({
        event: { ...base.event, id: PseudonymSchema.parse(eventId) },
        correlation: {
          ...base.correlation,
          turn_key: PseudonymSchema.parse('v1.p-turn-dw'),
          session_key: PseudonymSchema.parse('v1.p-session-dw'),
        },
      }),
      processEpochId: 'epoch-1',
      collectionRef: COLLECTION_REF,
    },
    depsOf(db),
  )
}

const counterValue = (db: Db, disposition: string): number => {
  const row = db.$client
    .query<{ value: number }, [string]>(`SELECT value FROM analytics_epoch_source_counters WHERE disposition = ?`)
    .get(disposition)
  return row?.value ?? 0
}

const mustInserted = (
  result: InsertEligibleCanonicalEventResult,
): Readonly<{ status: 'inserted'; eventId: string }> => {
  if (result.status !== 'inserted') throw new Error('expected insert')
  return result
}

const mustShadowNewKey = (pairs: readonly Readonly<{ domain: string; oldKey: string; newKey: string }>[]): string => {
  const pair = pairs.find((candidate) => candidate.domain === 'event-source-ref:v1')
  if (pair === undefined) throw new Error('shadow pair missing')
  return pair.newKey
}

describe('rekey dual-write parent seam', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedEligibility(db)
  })

  test('the shadow physical id is the generation-scoped derivation of the source opportunity', () => {
    const row = {
      storageGeneration: 'gen-1',
      sourceKind: 'live',
      sourceRefKey: 'src-9',
      eventName: 'llm_completed',
    } as const
    const shadowId = shadowEventIdFor(row, 'gen-2')
    expect(shadowId).toBe(physicalEventIdFor({ ...row, storageGeneration: 'gen-2' }))
    expect(shadowId).not.toBe(physicalEventIdFor(row))
  })

  test('without a run the writer creates exactly one active parent', () => {
    const result = insertLive(db, 'v1.ev-solo')
    expect(result.status).toBe('inserted')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events`)).toBe(1)
    expect(counterValue(db, 'canonical')).toBe(1)
  })

  test('an armed run yields one active plus one target-shadow parent for one opportunity', () => {
    planAndArmDualWrite(db)
    const result = insertLive(db, 'v1.ev-dual')
    expect(result.status).toBe('inserted')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-1'`)).toBe(1)
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events WHERE storage_generation = 'gen-2'`)).toBe(1)
    expect(counterValue(db, 'opportunity')).toBe(1)
    expect(counterValue(db, 'canonical')).toBe(1)
  })

  test('the shadow pair is persisted only in the encrypted mapping and shares the exact collection ref', () => {
    planAndArmDualWrite(db)
    const result = mustInserted(insertLive(db, 'v1.ev-pair'))
    const pairs = listMappingPairs({ runId: RUN_ID, encryptionKeys: [GOV_KEY_V1] }, { getDrizzleDb: () => db })
    const pair = pairs.find((candidate) => candidate.domain === 'event-source-ref:v1')
    expect(pair?.oldKey).toBe(result.eventId)
    expect(pair?.oldKey).not.toBe(pair?.newKey)
    const refs = db.$client
      .query<{ event_id: string; ref_key: string; key_version: string; generation: number }, []>(
        `SELECT event_id, ref_key, key_version, generation FROM analytics_event_collection_refs ORDER BY event_id`,
      )
      .all()
    expect(refs).toHaveLength(2)
    expect(refs[0]?.ref_key).toBe('v1.p-colref')
    expect(refs[1]?.ref_key).toBe('v1.p-colref')
    expect(refs[0]?.generation).toBe(1)
    expect(refs[1]?.generation).toBe(1)
    const shadow = db.$client
      .query<{ key_version: string; actor_key: string | null; turn_key: string | null }, [string]>(
        `SELECT key_version, actor_key, turn_key FROM analytics_events WHERE event_id = ?`,
      )
      .get(mustShadowNewKey(pairs))
    expect(shadow?.key_version).toBe('v2')
    expect(shadow?.actor_key?.startsWith('v2.')).toBe(true)
    expect(shadow?.turn_key?.startsWith('v2.')).toBe(true)
    const plaintext = db.$client
      .query<{ n: number }, []>(
        `SELECT COUNT(*) AS n FROM analytics_events WHERE actor_key = 'v1.p-actor' AND storage_generation = 'gen-2'`,
      )
      .get()
    expect(plaintext?.n).toBe(0)
  })

  test('an idempotent retry does not duplicate parents, mappings, or dispositions', () => {
    planAndArmDualWrite(db)
    const first = insertLive(db, 'v1.ev-retry')
    const second = insertLive(db, 'v1.ev-retry')
    expect(first.status).toBe('inserted')
    expect(second.status).toBe('already_present')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events`)).toBe(2)
    expect(
      countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE domain = 'event-source-ref:v1'`),
    ).toBe(1)
    expect(counterValue(db, 'canonical')).toBe(1)
  })

  test('a deny recheck failure produces no active and no shadow parent', () => {
    planAndArmDualWrite(db)
    db.$client.run(
      `UPDATE analytics_collection_eligibility SET state = 'deny', generation = 2 WHERE ref_key = 'v1.p-colref'`,
    )
    const result = insertLive(db, 'v1.ev-denied')
    expect(result.status).toBe('not_eligible')
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_events`)).toBe(0)
    expect(counterValue(db, 'governance_ineligible')).toBe(1)
  })

  test('a one-sided insert into the target generation cannot be requested by a caller', () => {
    planAndArmDualWrite(db)
    const result = insertLive(db, 'v1.ev-nogen')
    expect(result.status).toBe('inserted')
    const generations = db.$client
      .query<{ storage_generation: string }, []>(`SELECT storage_generation FROM analytics_events ORDER BY 1`)
      .all()
      .map((row) => row.storage_generation)
    expect(generations).toEqual(['gen-1', 'gen-2'])
  })
})
