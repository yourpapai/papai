// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { createGrantSendMutex } from '../../../src/analytics/governance/grant-serialization.js'
import { createRekeyCutoverFence, MUTABLE_WRITER_CLASSES } from '../../../src/analytics/rekey/cutover-fence.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { NOW, seedRekeySourceGraph, SOURCE_GEN, TARGET_GEN } from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const RUN_ID = 'run-1'

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const planVerifiedRun = (db: Db): void => {
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
    depsOf(db),
  )
  db.$client.run(
    `UPDATE analytics_rekey_runs SET phase = 'verify', subphase = 'verify.local_graph', status = 'running' WHERE run_id = 'run-1'`,
  )
}

describe('rekey cutover fence', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    planVerifiedRun(db)
  })

  test('the mutable writer classes cover every post-high-water writer', () => {
    expect(MUTABLE_WRITER_CLASSES).toEqual(['intent', 'derive', 'backfill', 'retention', 'delivery', 'snapshot'])
  })

  test('admissions register and release per class while the fence is open', () => {
    const fence = createRekeyCutoverFence(depsOf(db))
    expect(fence.isFenceHeld()).toBe(false)
    const intent = fence.admit('intent')
    const derive = fence.admit('derive')
    expect(intent).not.toBeNull()
    expect(derive).not.toBeNull()
    expect(fence.outstanding().intent).toBe(1)
    expect(fence.outstanding().derive).toBe(1)
    expect(fence.isDrained()).toBe(false)
    intent?.release()
    derive?.release()
    expect(fence.isDrained()).toBe(true)
  })

  test('acquiring the fence durably stops new admissions in every class', () => {
    const fence = createRekeyCutoverFence(depsOf(db))
    const admitted = fence.admit('backfill')
    fence.acquireFence(RUN_ID, NOW + 10)
    expect(fence.isFenceHeld()).toBe(true)
    expect(getRekeyRun(RUN_ID, depsOf(db))?.phase).toBe('cutover')
    for (const writerClass of MUTABLE_WRITER_CLASSES) {
      expect(fence.admit(writerClass)).toBeNull()
    }
    expect(fence.isDrained()).toBe(false)
    admitted?.release()
    expect(fence.isDrained()).toBe(true)
  })

  test('a persisted in-flight send blocks the drain until settlement', () => {
    const fence = createRekeyCutoverFence(depsOf(db))
    db.$client.run(`UPDATE analytics_deliveries SET state = 'sending', send_started_at_ms = 1 WHERE event_id = 'ev-2'`)
    expect(fence.isDrained()).toBe(false)
    db.$client.run(`UPDATE analytics_deliveries SET state = 'delivered' WHERE event_id = 'ev-2'`)
    expect(fence.isDrained()).toBe(true)
  })

  test('a persisted in-flight aggregate send blocks the drain until settlement', () => {
    const fence = createRekeyCutoverFence(depsOf(db))
    db.$client.run(
      `INSERT INTO analytics_aggregate_releases (release_id, release_hash, payload_json, payload_schema_version, created_at_ms)
       VALUES ('agg-1', 'h-1', '{"utc_day":"2023-11-14","cells":[]}', 1, 0)`,
    )
    db.$client.run(
      `INSERT INTO analytics_aggregate_deliveries (release_id, sink_version_id, state, attempts, next_attempt_at_ms, send_started_at_ms, payload_schema_version)
       VALUES ('agg-1', 'sink-1', 'sending', 1, 0, 1, 1)`,
    )
    expect(fence.isDrained()).toBe(false)
    db.$client.run(`UPDATE analytics_aggregate_deliveries SET state = 'delivered' WHERE release_id = 'agg-1'`)
    expect(fence.isDrained()).toBe(true)
  })

  test('an in-flight send holding the grant mutex blocks the drain', () => {
    const grantMutex = createGrantSendMutex()
    const fence = createRekeyCutoverFence({ ...depsOf(db), grantMutex })
    const release = grantMutex.tryAcquire('v1.p-grant')
    expect(release).not.toBeNull()
    expect(fence.isDrained()).toBe(false)
    release?.()
    expect(fence.isDrained()).toBe(true)
  })

  test('a restart resumes the persisted fence and cannot skip an admitted writer', () => {
    const first = createRekeyCutoverFence(depsOf(db))
    first.acquireFence(RUN_ID, NOW + 10)
    db.$client.run(`UPDATE analytics_deliveries SET state = 'sending', send_started_at_ms = 1 WHERE event_id = 'ev-2'`)
    const restarted = createRekeyCutoverFence(depsOf(db))
    expect(restarted.isFenceHeld()).toBe(true)
    expect(restarted.admit('intent')).toBeNull()
    expect(restarted.isDrained()).toBe(false)
    db.$client.run(`UPDATE analytics_deliveries SET state = 'delivered' WHERE event_id = 'ev-2'`)
    expect(restarted.isDrained()).toBe(true)
  })

  test('the fence releases after the committed pointer swap', () => {
    const fence = createRekeyCutoverFence(depsOf(db))
    fence.acquireFence(RUN_ID, NOW + 10)
    fence.releaseFence(RUN_ID, NOW + 20)
    expect(fence.isFenceHeld()).toBe(false)
    expect(fence.admit('intent')).not.toBeNull()
  })
})
