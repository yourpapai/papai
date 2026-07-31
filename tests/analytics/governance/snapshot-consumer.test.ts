// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSnapshotConsumerCoordinator } from '../../../src/analytics/governance/snapshot-consumer.js'
import type { SnapshotConsumerClient } from '../../../src/analytics/governance/snapshot-consumer.js'
import { createSnapshotInvalidator } from '../../../src/analytics/governance/snapshot-invalidator.js'
import { createSnapshotSchema } from '../../../src/analytics/jobs/snapshot-schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { NOW, SOURCE_GEN, TARGET_GEN } from '../rekey/fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

let workDir = ''

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'papai-consumer-test-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const writeSnapshotFile = (snapshotId: string, generation: string): string => {
  const path = join(workDir, `${snapshotId}.db`)
  const db = new Database(path)
  createSnapshotSchema(db, 'pseudonymous')
  db.prepare(
    `INSERT INTO snapshot_meta (
       singleton_id, snapshot_id, created_at_ms, storage_generation, source_high_water,
       source_row_count, curated_row_counts_json, model_versions_json, reconciliation_status, snapshot_mode
     ) VALUES (1, ?, ?, ?, '1:1', 1, '{}', '{}', 'reconciled', 'pseudonymous')`,
  ).run(snapshotId, NOW, generation)
  db.run('VACUUM')
  db.close()
  return path
}

const insertPublication = (
  db: Db,
  input: { snapshotId: string; generation: string; state: string; transitionRunId?: string | null },
): void => {
  db.$client.run(
    `INSERT INTO analytics_snapshot_publications (
       snapshot_id, storage_generation, transition_run_id, path_hash, source_high_water, state, published_at
     ) VALUES (?, ?, ?, 'hash', 'hw', ?, ?)`,
    [
      input.snapshotId,
      input.generation,
      input.transitionRunId ?? null,
      input.state,
      input.state === 'published' ? 1 : null,
    ],
  )
}

const publicationState = (db: Db, snapshotId: string): string | null =>
  db.$client
    .query<{ state: string }, [string]>(`SELECT state FROM analytics_snapshot_publications WHERE snapshot_id = ?`)
    .get(snapshotId)?.state ?? null

type FakeConsumer = {
  -readonly [K in keyof SnapshotConsumerClient]: SnapshotConsumerClient[K]
} & {
  openHandles: Set<string>
  servedPath: string | null
  quiesced: boolean
  servedSnapshotId: string | null
  contributions: Map<string, number>
  calls: string[]
}

const createFakeConsumer = (): FakeConsumer => {
  const state: FakeConsumer = {
    openHandles: new Set<string>(),
    servedPath: null,
    quiesced: false,
    servedSnapshotId: null,
    contributions: new Map<string, number>(),
    calls: [],
    quiesce: () => {
      state.quiesced = true
      state.calls.push('quiesce')
    },
    closeAll: () => {
      state.openHandles.clear()
      state.calls.push('close')
    },
    configure: (path) => {
      state.servedPath = path
      state.calls.push(`configure:${path}`)
    },
    reopen: () => {
      if (state.servedPath !== null) {
        state.openHandles.add(state.servedPath)
        const match = /([^/]+)\.db$/u.exec(state.servedPath)
        state.servedSnapshotId = match?.[1] ?? null
      }
      state.calls.push('reopen')
    },
    currentSnapshotId: () => state.servedSnapshotId,
    contributionOf: (marker) => state.contributions.get(marker) ?? 0,
    hasOpenHandle: (path) => state.openHandles.has(path),
    resume: () => {
      state.quiesced = false
      state.calls.push('resume')
    },
  }
  return state
}

const coordinatorFor = (db: Db, consumer: FakeConsumer): ReturnType<typeof createSnapshotConsumerCoordinator> =>
  createSnapshotConsumerCoordinator({
    getDrizzleDb: () => db,
    consumer,
    pathForSnapshot: (snapshotId) => join(workDir, `${snapshotId}.db`),
    nowMs: () => NOW,
  })

describe('snapshot consumer coordinator: subject deletion', () => {
  let db: Db
  let consumer: FakeConsumer

  beforeEach(async () => {
    db = await setupTestDb()
    consumer = createFakeConsumer()
    writeSnapshotFile('snap-old', SOURCE_GEN)
    writeSnapshotFile('snap-new', SOURCE_GEN)
    insertPublication(db, { snapshotId: 'snap-old', generation: SOURCE_GEN, state: 'published' })
    insertPublication(db, { snapshotId: 'snap-new', generation: SOURCE_GEN, state: 'staged' })
    consumer.servedPath = join(workDir, 'snap-old.db')
    consumer.openHandles.add(join(workDir, 'snap-old.db'))
    consumer.servedSnapshotId = 'snap-old'
  })

  test('only a reopened snapshot_id plus zero-contribution query permits acknowledgement and old-file cleanup', () => {
    const coordinator = coordinatorFor(db, consumer)
    const ack = coordinator.coordinateSubjectDeletion({
      newSnapshotId: 'snap-new',
      oldSnapshotId: 'snap-old',
      contributionMarker: 'v1.p-actor',
    })
    expect(ack.acknowledged).toBe(true)
    expect(consumer.calls).toEqual([
      'quiesce',
      'close',
      `configure:${join(workDir, 'snap-new.db')}`,
      'reopen',
      'resume',
    ])
    expect(publicationState(db, 'snap-new')).toBe('published')
    expect(publicationState(db, 'snap-old')).toBe('invalidated')
    expect(existsSync(join(workDir, 'snap-old.db'))).toBe(false)
    expect(existsSync(join(workDir, 'snap-new.db'))).toBe(true)
  })

  test('a pointer-only switch fails: no acknowledgement, old file retained unpublished, never resumed', () => {
    consumer.reopen = (): void => {
      consumer.calls.push('reopen')
    }
    const coordinator = coordinatorFor(db, consumer)
    expect(() =>
      coordinator.coordinateSubjectDeletion({
        newSnapshotId: 'snap-new',
        oldSnapshotId: 'snap-old',
        contributionMarker: 'v1.p-actor',
      }),
    ).toThrow('snapshot_id')
    expect(publicationState(db, 'snap-old')).toBe('invalidated')
    expect(publicationState(db, 'snap-new')).toBe('staged')
    expect(existsSync(join(workDir, 'snap-old.db'))).toBe(true)
    expect(consumer.quiesced).toBe(true)
    expect(consumer.calls).not.toContain('resume')
  })

  test('an open old inode blocks acknowledgement and removal', () => {
    consumer.hasOpenHandle = (path: string): boolean => path === join(workDir, 'snap-old.db')
    const coordinator = coordinatorFor(db, consumer)
    expect(() =>
      coordinator.coordinateSubjectDeletion({
        newSnapshotId: 'snap-new',
        oldSnapshotId: 'snap-old',
        contributionMarker: 'v1.p-actor',
      }),
    ).toThrow('open')
    expect(existsSync(join(workDir, 'snap-old.db'))).toBe(true)
    expect(publicationState(db, 'snap-new')).toBe('staged')
    expect(consumer.calls).not.toContain('resume')
  })

  test('a nonzero old contribution keeps the deletion incomplete', () => {
    consumer.contributions.set('v1.p-actor', 3)
    const coordinator = coordinatorFor(db, consumer)
    expect(() =>
      coordinator.coordinateSubjectDeletion({
        newSnapshotId: 'snap-new',
        oldSnapshotId: 'snap-old',
        contributionMarker: 'v1.p-actor',
      }),
    ).toThrow('contribution')
    expect(existsSync(join(workDir, 'snap-old.db'))).toBe(true)
    expect(consumer.calls).not.toContain('resume')
  })

  test('the invalidator stays fail-closed without a contribution marker', () => {
    const coordinator = coordinatorFor(db, consumer)
    const invalidator = createSnapshotInvalidator({
      getDrizzleDb: () => db,
      coordinator,
      rebuild: () => ({ newSnapshotId: 'snap-new' }),
    })
    const refused = invalidator({ reason: 'subject_deletion', nowMs: NOW })
    expect(refused.publishedSnapshotContainsContribution).toBe(true)
    expect(refused.unpublishedSnapshotIds).toEqual(['snap-old'])
    expect(existsSync(join(workDir, 'snap-old.db'))).toBe(true)
    expect(consumer.calls).not.toContain('resume')
  })

  test('the invalidator drives the coordinated replacement when a marker is supplied', () => {
    const coordinator = coordinatorFor(db, consumer)
    const invalidator = createSnapshotInvalidator({
      getDrizzleDb: () => db,
      coordinator,
      rebuild: () => ({ newSnapshotId: 'snap-new' }),
    })
    const accepted = invalidator({ reason: 'subject_deletion', nowMs: NOW, contributionMarker: 'v1.p-actor' })
    expect(accepted.publishedSnapshotContainsContribution).toBe(false)
    expect(publicationState(db, 'snap-new')).toBe('published')
    expect(existsSync(join(workDir, 'snap-old.db'))).toBe(false)
  })
})

describe('snapshot consumer coordinator: ordinary replacement', () => {
  let db: Db
  let consumer: FakeConsumer

  beforeEach(async () => {
    db = await setupTestDb()
    consumer = createFakeConsumer()
    writeSnapshotFile('snap-v1', SOURCE_GEN)
    writeSnapshotFile('snap-v2', SOURCE_GEN)
    insertPublication(db, { snapshotId: 'snap-v1', generation: SOURCE_GEN, state: 'published' })
    insertPublication(db, { snapshotId: 'snap-v2', generation: SOURCE_GEN, state: 'staged' })
    consumer.servedPath = join(workDir, 'snap-v1.db')
    consumer.openHandles.add(join(workDir, 'snap-v1.db'))
    consumer.servedSnapshotId = 'snap-v1'
  })

  test('quiesced remount verifies the staged file then atomically promotes before resuming', () => {
    const coordinator = coordinatorFor(db, consumer)
    coordinator.publishStagedOrdinary()
    expect(publicationState(db, 'snap-v1')).toBe('invalidated')
    expect(publicationState(db, 'snap-v2')).toBe('published')
    expect(consumer.servedSnapshotId).toBe('snap-v2')
    expect(consumer.quiesced).toBe(false)
    expect(consumer.calls).toEqual(['quiesce', 'close', `configure:${join(workDir, 'snap-v2.db')}`, 'reopen', 'resume'])
  })

  test('a generation mismatch keeps the staged row unpromoted and the prior published row intact', () => {
    db.$client.run(
      `UPDATE analytics_snapshot_publications SET storage_generation = 'gen-2' WHERE snapshot_id = 'snap-v2'`,
    )
    const coordinator = coordinatorFor(db, consumer)
    expect(() => coordinator.publishStagedOrdinary()).toThrow('generation')
    expect(publicationState(db, 'snap-v1')).toBe('published')
    expect(publicationState(db, 'snap-v2')).toBe('staged')
    expect(consumer.calls).not.toContain('resume')
  })
})

describe('snapshot consumer coordinator: startup serving and orphan reconciliation', () => {
  let db: Db
  let consumer: FakeConsumer

  beforeEach(async () => {
    db = await setupTestDb()
    consumer = createFakeConsumer()
  })

  test('normal startup rejects zero published rows', () => {
    const coordinator = coordinatorFor(db, consumer)
    const result = coordinator.startupServe()
    expect(result.serving).toBe(false)
    expect(consumer.calls).toEqual([])
  })

  test('normal startup serves exactly the one published row after reopen proof', () => {
    writeSnapshotFile('snap-pub', SOURCE_GEN)
    insertPublication(db, { snapshotId: 'snap-pub', generation: SOURCE_GEN, state: 'published' })
    const coordinator = coordinatorFor(db, consumer)
    const result = coordinator.startupServe()
    expect(result).toEqual({ serving: true, snapshotId: 'snap-pub' })
    expect(consumer.servedSnapshotId).toBe('snap-pub')
    expect(consumer.quiesced).toBe(false)
  })

  test('a file/active-generation mismatch rejects serving', () => {
    writeSnapshotFile('snap-pub', TARGET_GEN)
    insertPublication(db, { snapshotId: 'snap-pub', generation: TARGET_GEN, state: 'published' })
    const coordinator = coordinatorFor(db, consumer)
    expect(coordinator.startupServe().serving).toBe(false)
    expect(consumer.calls).not.toContain('resume')
  })

  test('a pre-promotion crash frees the staged slot, unlinks its file, and serves the old published row', () => {
    writeSnapshotFile('snap-old', SOURCE_GEN)
    writeSnapshotFile('snap-staged', SOURCE_GEN)
    insertPublication(db, { snapshotId: 'snap-old', generation: SOURCE_GEN, state: 'published' })
    insertPublication(db, { snapshotId: 'snap-staged', generation: SOURCE_GEN, state: 'staged' })
    const coordinator = coordinatorFor(db, consumer)
    const result = coordinator.startupServe()
    expect(result).toEqual({ serving: true, snapshotId: 'snap-old' })
    expect(publicationState(db, 'snap-staged')).toBe('invalidated')
    expect(publicationState(db, 'snap-old')).toBe('published')
    expect(existsSync(join(workDir, 'snap-staged.db'))).toBe(false)
    expect(existsSync(join(workDir, 'snap-old.db'))).toBe(true)
  })

  test('a crash after the staged-row insert without a file still frees the staged slot', () => {
    writeSnapshotFile('snap-old', SOURCE_GEN)
    insertPublication(db, { snapshotId: 'snap-old', generation: SOURCE_GEN, state: 'published' })
    insertPublication(db, { snapshotId: 'snap-ghost', generation: SOURCE_GEN, state: 'staged' })
    const coordinator = coordinatorFor(db, consumer)
    expect(coordinator.startupServe()).toEqual({ serving: true, snapshotId: 'snap-old' })
    expect(publicationState(db, 'snap-ghost')).toBe('invalidated')
  })

  test('a post-promotion crash serves only the new row', () => {
    writeSnapshotFile('snap-old', SOURCE_GEN)
    writeSnapshotFile('snap-new', SOURCE_GEN)
    insertPublication(db, { snapshotId: 'snap-old', generation: SOURCE_GEN, state: 'invalidated' })
    insertPublication(db, { snapshotId: 'snap-new', generation: SOURCE_GEN, state: 'published' })
    const coordinator = coordinatorFor(db, consumer)
    expect(coordinator.startupServe()).toEqual({ serving: true, snapshotId: 'snap-new' })
  })

  test('startup stays quiesced while a nonterminal rekey run holds the cutover phases', () => {
    writeSnapshotFile('snap-pub', SOURCE_GEN)
    insertPublication(db, { snapshotId: 'snap-pub', generation: SOURCE_GEN, state: 'published' })
    db.$client.run(
      `INSERT INTO analytics_rekey_runs (
         run_id, source_generation, target_generation, from_versions, to_versions,
         source_high_water, phase, subphase, plan_hash, status, created_at, updated_at
       ) VALUES ('run-1', 'gen-1', 'gen-2', '["v1"]', '["v2"]', '0:0', 'snapshot_republish', NULL, 'ph', 'running', 0, 0)`,
    )
    const coordinator = coordinatorFor(db, consumer)
    const result = coordinator.startupServe()
    expect(result.serving).toBe(false)
    expect(consumer.calls).toEqual([])
  })
})

describe('snapshot consumer coordinator: rekey snapshot_republish port', () => {
  let db: Db
  let consumer: FakeConsumer

  beforeEach(async () => {
    db = await setupTestDb()
    consumer = createFakeConsumer()
    db.$client.run(`UPDATE analytics_active_generation SET active_generation = 'gen-2', updated_at_ms = 1`)
    db.$client.run(
      `INSERT INTO analytics_rekey_runs (
         run_id, source_generation, target_generation, from_versions, to_versions,
         source_high_water, phase, subphase, plan_hash, status, created_at, updated_at
       ) VALUES ('run-1', 'gen-1', 'gen-2', '["v1"]', '["v2"]', '0:0', 'snapshot_republish', NULL, 'ph', 'running', 0, 0)`,
    )
    writeSnapshotFile('snap-target', TARGET_GEN)
    insertPublication(db, {
      snapshotId: 'snap-target',
      generation: TARGET_GEN,
      state: 'staged',
      transitionRunId: 'run-1',
    })
  })

  test('a rekey remount compares embedded id and generation against the run-owned staged row and active pointer', () => {
    const coordinator = coordinatorFor(db, consumer)
    const ok = coordinator.transitionCoordinator.remountAndVerify({
      snapshotId: 'snap-target',
      expectedGeneration: TARGET_GEN,
    })
    expect(ok).toBe(true)
    expect(consumer.servedSnapshotId).toBe('snap-target')
  })

  test('a wrong-generation remount keeps BI quiesced', () => {
    const coordinator = coordinatorFor(db, consumer)
    expect(
      coordinator.transitionCoordinator.remountAndVerify({ snapshotId: 'snap-target', expectedGeneration: SOURCE_GEN }),
    ).toBe(false)
    expect(consumer.calls).not.toContain('resume')
  })

  test('a staged row owned by another run keeps BI quiesced', () => {
    db.$client.run(
      `INSERT INTO analytics_rekey_runs (
         run_id, source_generation, target_generation, from_versions, to_versions,
         source_high_water, phase, subphase, plan_hash, status, created_at, updated_at
       ) VALUES ('run-other', 'gen-1', 'gen-2', '["v1"]', '["v2"]', '0:0', 'retire', NULL, 'ph', 'completed', 0, 0)`,
    )
    db.$client.run(
      `UPDATE analytics_snapshot_publications SET transition_run_id = 'run-other' WHERE snapshot_id = 'snap-target'`,
    )
    const coordinator = coordinatorFor(db, consumer)
    expect(
      coordinator.transitionCoordinator.remountAndVerify({ snapshotId: 'snap-target', expectedGeneration: TARGET_GEN }),
    ).toBe(false)
  })

  test('a concurrent ordinary publication is refused while the rekey run holds the cutover', () => {
    db.$client.run(`DELETE FROM analytics_snapshot_publications WHERE snapshot_id = 'snap-target'`)
    db.$client.run(`UPDATE analytics_rekey_runs SET phase = 'cutover' WHERE run_id = 'run-1'`)
    writeSnapshotFile('snap-ordinary', TARGET_GEN)
    insertPublication(db, { snapshotId: 'snap-ordinary', generation: TARGET_GEN, state: 'staged' })
    const coordinator = coordinatorFor(db, consumer)
    expect(() => coordinator.publishStagedOrdinary()).toThrow('rekey run holds the cutover')
    expect(publicationState(db, 'snap-ordinary')).toBe('staged')
    expect(consumer.calls).toEqual([])
    db.$client.run(`UPDATE analytics_rekey_runs SET phase = 'retire' WHERE run_id = 'run-1'`)
    coordinator.publishStagedOrdinary()
    expect(publicationState(db, 'snap-ordinary')).toBe('published')
    expect(consumer.servedSnapshotId).toBe('snap-ordinary')
  })

  test('source file unlink is refused while the old consumer handle is open', () => {
    writeSnapshotFile('snap-source', SOURCE_GEN)
    insertPublication(db, { snapshotId: 'snap-source', generation: SOURCE_GEN, state: 'invalidated' })
    consumer.openHandles.add(join(workDir, 'snap-source.db'))
    const coordinator = coordinatorFor(db, consumer)
    expect(() =>
      coordinator.transitionCoordinator.unlinkSourceFile({ sourceGeneration: SOURCE_GEN, nowMs: NOW }),
    ).toThrow('open')
    expect(existsSync(join(workDir, 'snap-source.db'))).toBe(true)
    consumer.openHandles.clear()
    coordinator.transitionCoordinator.unlinkSourceFile({ sourceGeneration: SOURCE_GEN, nowMs: NOW })
    expect(existsSync(join(workDir, 'snap-source.db'))).toBe(false)
  })
})
