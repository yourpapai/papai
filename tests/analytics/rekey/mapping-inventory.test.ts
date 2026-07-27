// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import {
  collectDomainInventory,
  installDomainMappings,
  installDomainMappingsIn,
} from '../../../src/analytics/rekey/mapping-inventory.js'
import {
  buildMappingForKey,
  insertMappingPairIn,
  listMappingPairs,
  oldKeyHashFor,
} from '../../../src/analytics/rekey/mapping-store.js'
import { checkpointRekeyRunIn, getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { countRows, seedRekeySourceGraph } from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const NOW = 1700000000000
const GOV_KEY_V1 = Buffer.alloc(32, 7)
const GOV_KEY_V2 = Buffer.alloc(32, 9)
const ANALYTICS_KEY_V2 = Buffer.alloc(32, 11)

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const planRun = (db: Db, runId = 'run-1'): void => {
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

describe('rekey mapping inventory', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('inventory covers events, governance, and props domains including thread:v1', () => {
    seedRekeySourceGraph(db)
    const inventory = collectDomainInventory(db, 'gen-1')
    expect(inventory.get('actor:v1')?.has('v1.p-actor')).toBe(true)
    expect(inventory.get('thread:v1')?.has('v1.p-thread')).toBe(true)
    expect(inventory.get('conversation:v1')?.has('v1.p-conversation')).toBe(true)
    expect(inventory.get('turn:v1')?.has('v1.p-turn')).toBe(true)
    expect(inventory.get('session:v1')?.has('v1.p-session')).toBe(true)
    expect(inventory.get('deployment:v1')?.has('v1.p-deploy')).toBe(true)
    expect(inventory.get('platform-instance:v1')?.has('v1.p-platform')).toBe(true)
    expect(inventory.get('llm-attempt:v1')?.has('v1.p-attempt')).toBe(true)
    expect(inventory.get('model:v1')?.has('v1.p-model')).toBe(true)
    expect(inventory.get('tool:v1')?.has('v1.p-tool')).toBe(true)
    expect(inventory.get('governance-actor:v1')?.has('v1.p-gov-actor')).toBe(true)
    expect(inventory.get('collection-eligibility:v1')?.has('v1.p-colref')).toBe(true)
    expect(inventory.get('delivery-grant:v1')?.has('v1.p-grant')).toBe(true)
    expect(inventory.get('materialization:v1')?.has('v1.p-goal-attempt')).toBe(true)
  })

  test('installDomainMappings seals encrypted pairs openable by a retained key', () => {
    seedRekeySourceGraph(db)
    planRun(db)
    const result = installDomainMappings(
      {
        runId: 'run-1',
        sourceGeneration: 'gen-1',
        domains: ['thread:v1', 'actor:v1'],
        toKey: ANALYTICS_KEY_V2,
        toVersion: 'v2',
        encryptionKey: GOV_KEY_V1,
        nowMs: NOW,
      },
      depsOf(db),
    )
    expect(result.installed).toBe(3)
    const pairs = listMappingPairs({ runId: 'run-1', encryptionKeys: [GOV_KEY_V2, GOV_KEY_V1] }, depsOf(db))
    expect(pairs).toHaveLength(3)
    const thread = pairs.filter((pair) => pair.domain === 'thread:v1').find((pair) => pair.oldKey === 'v1.p-thread')
    expect(thread?.oldKey).toBe('v1.p-thread')
    expect(thread?.newKey.startsWith('v2.')).toBe(true)
  })

  test('install is idempotent on resume and rejects collisions across old keys', () => {
    seedRekeySourceGraph(db)
    planRun(db)
    const input = {
      runId: 'run-1',
      sourceGeneration: 'gen-1',
      domains: ['thread:v1'],
      toKey: ANALYTICS_KEY_V2,
      toVersion: 'v2',
      encryptionKey: GOV_KEY_V1,
      nowMs: NOW,
    } as const
    expect(installDomainMappings(input, depsOf(db)).installed).toBe(2)
    expect(installDomainMappings(input, depsOf(db)).installed).toBe(0)
    db.$client.run(`UPDATE analytics_events SET thread_key = 'v1.p-thread-alias' WHERE event_id = 'ev-extra'`)
    const colliding = buildMappingForKey({
      domain: 'thread:v1',
      oldKey: 'v1.p-thread',
      toKey: ANALYTICS_KEY_V2,
      toVersion: 'v2',
    })
    const collidingHash = createHash('sha256').update(`thread:v1|${colliding}`).digest('hex')
    db.$client.run(
      `INSERT INTO analytics_rekey_mappings (run_id, domain, old_key_hash, mapping_ciphertext, mapping_hash, state)
       VALUES ('run-1', 'thread:v1', ?, 'c', ?, 'mapped')`,
      [oldKeyHashFor('thread:v1', 'v1.p-thread-alias'), collidingHash],
    )
    expect(() => installDomainMappings(input, depsOf(db))).toThrow(/conflict/u)
  })

  test('insertMappingPairIn rejects two old keys sharing one new key', () => {
    planRun(db)
    db.transaction((tx) => {
      insertMappingPairIn(tx, {
        runId: 'run-1',
        domain: 'thread:v1',
        oldKey: 'v1.p-thread-a',
        newKey: 'v2.p-shared',
        encryptionKey: GOV_KEY_V1,
      })
      expect(() =>
        insertMappingPairIn(tx, {
          runId: 'run-1',
          domain: 'thread:v1',
          oldKey: 'v1.p-thread-b',
          newKey: 'v2.p-shared',
          encryptionKey: GOV_KEY_V1,
        }),
      ).toThrow(/collision/u)
    })
  })

  test('unknown domains are rejected', () => {
    planRun(db)
    expect(() =>
      installDomainMappings(
        {
          runId: 'run-1',
          sourceGeneration: 'gen-1',
          domains: ['native-user-id:v1'],
          toKey: ANALYTICS_KEY_V2,
          toVersion: 'v2',
          encryptionKey: GOV_KEY_V1,
          nowMs: NOW,
        },
        depsOf(db),
      ),
    ).toThrow()
  })

  test('installDomainMappingsIn commits inside the caller transaction with the subphase checkpoint', () => {
    seedRekeySourceGraph(db)
    planRun(db)
    const input = {
      runId: 'run-1',
      sourceGeneration: 'gen-1',
      domains: ['thread:v1'],
      toKey: ANALYTICS_KEY_V2,
      toVersion: 'v2',
      encryptionKey: GOV_KEY_V1,
      nowMs: NOW,
    } as const
    db.transaction((tx) => {
      expect(installDomainMappingsIn(tx, input).installed).toBe(2)
      checkpointRekeyRunIn(tx, { runId: 'run-1', phase: 'dual_write', subphase: 'dual_write.identity', nowMs: NOW })
    })
    expect(getRekeyRun('run-1', depsOf(db))?.subphase).toBe('dual_write.identity')
    expect(() =>
      db.transaction((tx) => {
        installDomainMappingsIn(tx, { ...input, domains: ['actor:v1'] })
        throw new Error('simulated crash after install before checkpoint')
      }),
    ).toThrow()
    expect(countRows(db, `SELECT COUNT(*) AS n FROM analytics_rekey_mappings WHERE domain = 'actor:v1'`)).toBe(0)
  })
})
