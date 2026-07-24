// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun } from '../../../src/analytics/governance/generation-store.js'
import {
  getPublication,
  promoteStagedSnapshot,
  stageRekeySnapshotPublication,
  stageSnapshotPublication,
} from '../../../src/analytics/governance/snapshot-publication-store.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

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

describe('analytics snapshot publication store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('ordinary staging requires no transition run and stores the generation', () => {
    const staged = stageSnapshotPublication(
      {
        snapshotId: 'snap-1',
        storageGeneration: 'gen-1',
        pathHash: 'ph',
        sourceHighWater: 'hw',
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    expect(staged.state).toBe('staged')
    const row = getPublication('snap-1', { getDrizzleDb: () => db })
    expect(row?.storageGeneration).toBe('gen-1')
    expect(row?.transitionRunId).toBeNull()
  })

  test('rekey staging requires the current nonterminal run target generation', () => {
    planRun(db, 'run-1')
    expect(() =>
      stageRekeySnapshotPublication(
        {
          snapshotId: 'snap-wrong',
          storageGeneration: 'gen-3',
          transitionRunId: 'run-1',
          pathHash: 'ph',
          sourceHighWater: 'hw',
          nowMs: 1700000000000,
        },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()

    const staged = stageRekeySnapshotPublication(
      {
        snapshotId: 'snap-ok',
        storageGeneration: 'gen-2',
        transitionRunId: 'run-1',
        pathHash: 'ph',
        sourceHighWater: 'hw',
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    expect(staged.state).toBe('staged')
  })

  test('rekey staging rejects a missing or terminal run', () => {
    expect(() =>
      stageRekeySnapshotPublication(
        {
          snapshotId: 'snap-missing',
          storageGeneration: 'gen-2',
          transitionRunId: 'no-such-run',
          pathHash: 'ph',
          sourceHighWater: 'hw',
          nowMs: 1700000000000,
        },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })

  test('restart reuses the run’s one staged row idempotently', () => {
    planRun(db, 'run-1')
    const first = stageRekeySnapshotPublication(
      {
        snapshotId: 'snap-a',
        storageGeneration: 'gen-2',
        transitionRunId: 'run-1',
        pathHash: 'ph',
        sourceHighWater: 'hw',
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    const second = stageRekeySnapshotPublication(
      {
        snapshotId: 'snap-b',
        storageGeneration: 'gen-2',
        transitionRunId: 'run-1',
        pathHash: 'ph2',
        sourceHighWater: 'hw',
        nowMs: 1700000001000,
      },
      { getDrizzleDb: () => db },
    )
    expect(second.snapshotId).toBe(first.snapshotId)
    const stagedRows = db.$client
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM analytics_snapshot_publications WHERE state = 'staged'`)
      .get()
    expect(stagedRows?.n).toBe(1)
  })

  test('promote transitions staged to published and invalidates the prior published row atomically', () => {
    stageSnapshotPublication(
      {
        snapshotId: 'snap-old',
        storageGeneration: 'gen-1',
        pathHash: 'ph',
        sourceHighWater: 'hw',
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    promoteStagedSnapshot({ snapshotId: 'snap-old', nowMs: 1700000000500 }, { getDrizzleDb: () => db })

    stageSnapshotPublication(
      {
        snapshotId: 'snap-new',
        storageGeneration: 'gen-1',
        pathHash: 'ph2',
        sourceHighWater: 'hw',
        nowMs: 1700000001000,
      },
      { getDrizzleDb: () => db },
    )
    promoteStagedSnapshot({ snapshotId: 'snap-new', nowMs: 1700000001500 }, { getDrizzleDb: () => db })

    expect(getPublication('snap-old', { getDrizzleDb: () => db })?.state).toBe('invalidated')
    expect(getPublication('snap-new', { getDrizzleDb: () => db })?.state).toBe('published')
  })
})
