// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { deriveRekeyedPseudonym } from '../../../src/analytics/identity/pseudonym.js'
import {
  buildMappingForKey,
  expandKeysThroughMappings,
  insertMappingPairIn,
  listMappingPairs,
  oldKeyHashFor,
  openMappingForVerify,
  REKEY_MAPPING_CRYPTO_DOMAIN,
} from '../../../src/analytics/rekey/mapping-store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { GOV_KEY_V1, GOV_KEY_V2 } from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const NOW = 1700000000000
const ANALYTICS_KEY_V2 = Buffer.alloc(32, 11)
const RUN_ID = 'run-1'

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const planRun = (db: Db, runId = RUN_ID): void => {
  planRekeyRun(
    {
      runId,
      sourceGeneration: 'gen-1',
      targetGeneration: 'gen-2',
      fromVersions: ['v1'],
      toVersions: ['v2'],
      sourceHighWater: 'hw-1',
      planHash: 'plan-hash',
      nowMs: NOW,
    },
    depsOf(db),
  )
}

const mustCiphertext = (db: Db, domain: string): string => {
  const row = db.$client
    .query<{ mapping_ciphertext: string }, [string]>(
      `SELECT mapping_ciphertext FROM analytics_rekey_mappings WHERE domain = ?`,
    )
    .get(domain)
  if (row === undefined || row === null) throw new Error('mapping row missing')
  return row.mapping_ciphertext
}

describe('rekeyed pseudonym derivation', () => {
  test('derives deterministically from the old pseudonym under the target key', () => {
    const first = deriveRekeyedPseudonym({
      key: ANALYTICS_KEY_V2,
      keyVersion: 'v2',
      domain: 'thread:v1',
      sourcePseudonym: 'v1.p-thread',
    })
    const second = deriveRekeyedPseudonym({
      key: ANALYTICS_KEY_V2,
      keyVersion: 'v2',
      domain: 'thread:v1',
      sourcePseudonym: 'v1.p-thread',
    })
    expect(first).toBe(second)
    expect(first.startsWith('v2.')).toBe(true)
    expect(first).not.toBe('v1.p-thread')
  })
})

describe('rekey mapping store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    planRun(db)
  })

  test('mapping crypto domain and old-key hash are stable', () => {
    expect(REKEY_MAPPING_CRYPTO_DOMAIN).toBe('rekey-mapping:v1')
    expect(oldKeyHashFor('thread:v1', 'v1.p-thread')).toBe(oldKeyHashFor('thread:v1', 'v1.p-thread'))
    expect(oldKeyHashFor('thread:v1', 'v1.p-thread')).not.toBe(oldKeyHashFor('actor:v1', 'v1.p-thread'))
  })

  test('buildMappingForKey derives the target key deterministically', () => {
    const mapped = buildMappingForKey({
      domain: 'thread:v1',
      oldKey: 'v1.p-thread',
      toKey: ANALYTICS_KEY_V2,
      toVersion: 'v2',
    })
    expect(mapped.startsWith('v2.')).toBe(true)
    expect(mapped).toBe(
      buildMappingForKey({ domain: 'thread:v1', oldKey: 'v1.p-thread', toKey: ANALYTICS_KEY_V2, toVersion: 'v2' }),
    )
  })

  test('insertMappingPairIn encrypts the pair and is idempotent for an identical retry', () => {
    const first = db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'thread:v1',
        oldKey: 'v1.p-thread',
        newKey: 'v2.p-thread',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    const second = db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'thread:v1',
        oldKey: 'v1.p-thread',
        newKey: 'v2.p-thread',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    expect(first).toBe('inserted')
    expect(second).toBe('already_present')
    const pairs = listMappingPairs({ runId: RUN_ID, encryptionKeys: [GOV_KEY_V2] }, depsOf(db))
    expect(pairs).toEqual([{ domain: 'thread:v1', oldKey: 'v1.p-thread', newKey: 'v2.p-thread' }])
  })

  test('insertMappingPairIn rejects a conflicting remap of the same old key', () => {
    db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'thread:v1',
        oldKey: 'v1.p-thread',
        newKey: 'v2.p-thread',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    expect(() =>
      db.transaction((tx) =>
        insertMappingPairIn(tx, {
          runId: RUN_ID,
          domain: 'thread:v1',
          oldKey: 'v1.p-thread',
          newKey: 'v2.p-other',
          encryptionKey: GOV_KEY_V2,
        }),
      ),
    ).toThrow(/conflict/u)
  })

  test('insertMappingPairIn rejects two distinct old keys sharing one new key', () => {
    db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'thread:v1',
        oldKey: 'v1.p-thread',
        newKey: 'v2.p-thread',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    expect(() =>
      db.transaction((tx) =>
        insertMappingPairIn(tx, {
          runId: RUN_ID,
          domain: 'thread:v1',
          oldKey: 'v1.p-thread-2',
          newKey: 'v2.p-thread',
          encryptionKey: GOV_KEY_V2,
        }),
      ),
    ).toThrow(/collision/u)
  })

  test('insertMappingPairIn rejects an unknown domain', () => {
    expect(() =>
      db.transaction((tx) =>
        insertMappingPairIn(tx, {
          runId: RUN_ID,
          domain: 'bogus:v1',
          oldKey: 'a',
          newKey: 'b',
          encryptionKey: GOV_KEY_V2,
        }),
      ),
    ).toThrow(/unknown rekey mapping domain/u)
  })

  test('openMappingForVerify authenticates with the retained key and rejects a wrong key', () => {
    db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'actor:v1',
        oldKey: 'v1.p-actor',
        newKey: 'v2.p-actor',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    const ciphertext = mustCiphertext(db, 'actor:v1')
    const pair = openMappingForVerify(ciphertext, GOV_KEY_V2)
    expect(pair).toEqual({ domain: 'actor:v1', oldKey: 'v1.p-actor', newKey: 'v2.p-actor' })
    expect(() => openMappingForVerify(ciphertext, GOV_KEY_V1)).toThrow()
  })

  test('listMappingPairs skips destroyed mappings', () => {
    db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'actor:v1',
        oldKey: 'v1.p-actor',
        newKey: 'v2.p-actor',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    db.$client.run(`UPDATE analytics_rekey_mappings SET state = 'destroyed', mapping_ciphertext = ''`)
    expect(listMappingPairs({ runId: RUN_ID, encryptionKeys: [GOV_KEY_V2] }, depsOf(db))).toEqual([])
  })

  test('expandKeysThroughMappings follows chained generations forward', () => {
    db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'actor:v1',
        oldKey: 'v1.p-actor',
        newKey: 'v2.p-actor',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'actor:v1',
        oldKey: 'v2.p-actor',
        newKey: 'v3.p-actor',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    const expanded = expandKeysThroughMappings({ 'actor:v1': ['v1.p-actor'] }, [GOV_KEY_V2], depsOf(db))
    expect(expanded.get('actor:v1')).toEqual(['v1.p-actor', 'v2.p-actor', 'v3.p-actor'])
  })

  test('expandKeysThroughMappings skips mappings no retained key can open', () => {
    db.transaction((tx) =>
      insertMappingPairIn(tx, {
        runId: RUN_ID,
        domain: 'actor:v1',
        oldKey: 'v1.p-actor',
        newKey: 'v2.p-actor',
        encryptionKey: GOV_KEY_V2,
      }),
    )
    const expanded = expandKeysThroughMappings({ 'actor:v1': ['v1.p-actor'] }, [GOV_KEY_V1], depsOf(db))
    expect(expanded.get('actor:v1')).toEqual(['v1.p-actor'])
  })
})
