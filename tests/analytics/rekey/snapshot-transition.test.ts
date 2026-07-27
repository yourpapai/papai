// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { planRekeyRun, setActiveGeneration } from '../../../src/analytics/governance/generation-store.js'
import type { GenerationTransitionCoordinator } from '../../../src/analytics/governance/snapshot-invalidator.js'
import { stageSnapshotPublication } from '../../../src/analytics/governance/snapshot-publication-store.js'
import { getRekeyRun } from '../../../src/analytics/rekey/run-store.js'
import { runSnapshotRepublish } from '../../../src/analytics/rekey/snapshot-transition.js'
import type { AnalyticsRekeyRunRow } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { NOW, seedRekeySourceGraph, SOURCE_GEN, TARGET_GEN } from './fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const RUN_ID = 'run-1'

const depsOf = (db: Db): Readonly<{ getDrizzleDb: () => Db }> => ({ getDrizzleDb: (): Db => db })

const mustRun = (db: Db): AnalyticsRekeyRunRow => {
  const run = getRekeyRun(RUN_ID, depsOf(db))
  if (run === null) throw new Error('run missing')
  return run
}

type FakeCoordinator = GenerationTransitionCoordinator & { calls: readonly string[] }

const createFakeCoordinator = (options?: { remountOk?: boolean }): FakeCoordinator => {
  const calls: string[] = []
  let builds = 0
  return {
    calls,
    quiesceQueries: () => {
      calls.push('quiesce')
    },
    closeSourceConnections: () => {
      calls.push('close')
    },
    buildTargetSnapshot: ({ targetGeneration }) => {
      builds += 1
      calls.push(`build:${targetGeneration}:${builds}`)
      return { snapshotId: `snap-${targetGeneration}-${builds}`, pathHash: 'path-hash', sourceHighWater: 'hw-1' }
    },
    remountAndVerify: ({ snapshotId, expectedGeneration }) => {
      calls.push(`remount:${snapshotId}:${expectedGeneration}`)
      return options?.remountOk ?? true
    },
    resumeQueries: () => {
      calls.push('resume')
    },
    unlinkSourceFile: ({ sourceGeneration }) => {
      calls.push(`unlink:${sourceGeneration}`)
    },
  }
}

/** Post-swap state: pointer on target, source publication invalidated, run in swap phase. */
const seedPostSwapState = (db: Db): void => {
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
    `UPDATE analytics_rekey_runs SET phase = 'swap', subphase = 'swap.active_generation', status = 'running' WHERE run_id = 'run-1'`,
  )
  setActiveGeneration({ generation: TARGET_GEN, nowMs: NOW + 100 }, depsOf(db))
  db.$client.run(
    `INSERT INTO analytics_snapshot_publications (snapshot_id, storage_generation, path_hash, source_high_water, state, published_at, invalidated_at)
     VALUES ('snap-old', 'gen-1', 'old-path', 'hw-0', 'invalidated', 1, 2)`,
  )
}

describe('rekey snapshot republish', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    seedPostSwapState(db)
  })

  test('builds, stages, verifies, promotes, resumes, and unlinks with the rekey-owned token', () => {
    const coordinator = createFakeCoordinator()
    const run = mustRun(db)
    runSnapshotRepublish(run, coordinator, { ...depsOf(db), nowMs: NOW + 200 })
    expect(coordinator.calls).toEqual(['build:gen-2:1', `remount:snap-gen-2-1:gen-2`, 'resume', 'unlink:gen-1'])
    const publications = db.$client
      .query<{ snapshot_id: string; state: string; storage_generation: string; transition_run_id: string | null }, []>(
        `SELECT snapshot_id, state, storage_generation, transition_run_id FROM analytics_snapshot_publications ORDER BY snapshot_id`,
      )
      .all()
    const published = publications.filter((row) => row.state === 'published')
    expect(published).toHaveLength(1)
    expect(published[0]?.snapshot_id).toBe('snap-gen-2-1')
    expect(published[0]?.storage_generation).toBe(TARGET_GEN)
    expect(published[0]?.transition_run_id).toBe(RUN_ID)
    const staged = publications.filter((row) => row.state === 'staged')
    expect(staged).toHaveLength(0)
    const sourcePublished = publications
      .filter((row) => row.state === 'published')
      .filter((row) => row.storage_generation === SOURCE_GEN)
    expect(sourcePublished).toHaveLength(0)
  })

  test('a remount verification failure keeps BI down, the staged row, and the run resumable', () => {
    const coordinator = createFakeCoordinator({ remountOk: false })
    const run = mustRun(db)
    expect(() => runSnapshotRepublish(run, coordinator, { ...depsOf(db), nowMs: NOW + 200 })).toThrow()
    expect(coordinator.calls).not.toContain('resume')
    const staged = db.$client
      .query<{ state: string; transition_run_id: string | null }, []>(
        `SELECT state, transition_run_id FROM analytics_snapshot_publications WHERE state = 'staged'`,
      )
      .all()
    expect(staged).toHaveLength(1)
    expect(staged[0]?.transition_run_id).toBe(RUN_ID)
    const publishedCount = db.$client
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM analytics_snapshot_publications WHERE state = 'published'`)
      .get()
    expect(publishedCount?.n).toBe(0)
  })

  test('a restart in snapshot_republish reuses the staged row without rebuilding or double-promoting', () => {
    const failing = createFakeCoordinator({ remountOk: false })
    const run = mustRun(db)
    expect(() => runSnapshotRepublish(run, failing, { ...depsOf(db), nowMs: NOW + 200 })).toThrow()
    const coordinator = createFakeCoordinator()
    runSnapshotRepublish(run, coordinator, { ...depsOf(db), nowMs: NOW + 300 })
    expect(coordinator.calls).not.toContain('build:gen-2:1')
    expect(coordinator.calls).toEqual(['remount:snap-gen-2-1:gen-2', 'resume', 'unlink:gen-1'])
    const published = db.$client
      .query<{ snapshot_id: string }, []>(
        `SELECT snapshot_id FROM analytics_snapshot_publications WHERE state = 'published'`,
      )
      .all()
    expect(published).toHaveLength(1)
    expect(published[0]?.snapshot_id).toBe('snap-gen-2-1')
  })

  test('ordinary snapshot staging cannot bypass the rekey-owned cutover token', () => {
    db.$client.run(`UPDATE analytics_rekey_runs SET phase = 'snapshot_republish' WHERE run_id = 'run-1'`)
    expect(() =>
      stageSnapshotPublication(
        {
          snapshotId: 'snap-ordinary',
          storageGeneration: TARGET_GEN,
          pathHash: 'p',
          sourceHighWater: 'hw',
          nowMs: NOW + 400,
        },
        depsOf(db),
      ),
    ).toThrow()
  })
})
