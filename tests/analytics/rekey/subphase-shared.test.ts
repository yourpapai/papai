// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import { runCheckpointedSubphase } from '../../../src/analytics/rekey/subphase-shared.js'
import type { RekeySubphaseContext } from '../../../src/analytics/rekey/subphase-shared.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { NOW, seedRekeySourceGraph, SOURCE_GEN, TARGET_GEN } from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const RUN_ID = 'run-shared'

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const contextOf = (db: Db): RekeySubphaseContext => ({
  getDrizzleDb: (): Db => db,
  coordinator: {
    quiesceQueries: (): void => undefined,
    closeSourceConnections: (): void => undefined,
    buildTargetSnapshot: (): Readonly<{ snapshotId: string; pathHash: string; sourceHighWater: string }> => ({
      snapshotId: 'snap-1',
      pathHash: 'p',
      sourceHighWater: 'hw',
    }),
    remountAndVerify: (): boolean => true,
    resumeQueries: (): void => undefined,
    unlinkSourceFile: (): void => undefined,
  },
  egress: {
    pauseEgress: (): void => undefined,
    requestActorDeletion: (): null => null,
    resumeEgress: (): void => undefined,
  },
  fence: createRekeyCutoverFence({ getDrizzleDb: (): Db => db }),
  retainedEventHorizonDays: 30,
  nowMs: (): number => NOW,
})

const mustRun = (db: Db): NonNullable<ReturnType<typeof getRekeyRun>> => {
  const run = getRekeyRun(RUN_ID, depsOf(db))
  if (run === null) throw new Error('run missing')
  return run
}

describe('rekey subphase shared helpers', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
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
  })

  test('runCheckpointedSubphase persists work counts and the checkpoint in one transaction', () => {
    const run = mustRun(db)
    runCheckpointedSubphase('verify.local_graph', run, contextOf(db), () => ({ verifiedCount: run.verifiedCount + 1 }))
    const after = mustRun(db)
    expect(after.phase).toBe('verify')
    expect(after.subphase).toBe('verify.local_graph')
    expect(after.status).toBe('running')
    expect(after.verifiedCount).toBe(run.verifiedCount + 1)
  })

  test('runCheckpointedSubphase rolls the checkpoint back when the work throws', () => {
    const run = mustRun(db)
    expect(() =>
      runCheckpointedSubphase('verify.local_graph', run, contextOf(db), () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    const after = mustRun(db)
    expect(after.phase).toBe('plan')
    expect(after.subphase).toBeNull()
  })
})
