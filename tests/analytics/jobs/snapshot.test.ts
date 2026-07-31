// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import { getPublication } from '../../../src/analytics/governance/snapshot-publication-store.js'
import {
  assertSnapshotOutputPath,
  publishAnalyticsSnapshot,
  verifySnapshotFile,
} from '../../../src/analytics/jobs/snapshot.js'
import type { SnapshotPublishDeps, SnapshotFailurePoint } from '../../../src/analytics/jobs/snapshot.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import type { RekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { insertFixtureEvent, NOW, RETIRED_GEN, SOURCE_GEN, TARGET_GEN } from '../rekey/fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

let workDir = ''

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'papai-snapshot-test-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const depsFor = (db: Db, inject?: (point: SnapshotFailurePoint) => void): SnapshotPublishDeps => ({
  getDrizzleDb: (): Db => db,
  fence: createRekeyCutoverFence({ getDrizzleDb: (): Db => db }),
  nowMs: (): number => NOW + 10_000,
  snapshotId: (): string => 'snap-test-1',
  injectFailure: inject,
})

const seedGraph = (db: Db): void => {
  db.$client.run(
    `INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms, closed_at_ms) VALUES ('epoch-1', 'closed', 0, 1)`,
  )
  db.$client.run(
    `INSERT INTO analytics_epoch_source_counters (epoch_id, utc_day, source_family, disposition, value)
     VALUES ('epoch-1', '2023-11-14', 'chat', 'opportunity', 1), ('epoch-1', '2023-11-14', 'chat', 'canonical', 1)`,
  )
  insertFixtureEvent(db, {
    eventId: 'ev-active',
    generation: SOURCE_GEN,
    sourceRefKey: 'src-active',
    eventName: 'chat_message_accepted',
    occurredAtMs: NOW,
    actorKey: 'v1.p-actor',
    conversationKey: 'v1.p-conversation',
  })
  insertFixtureEvent(db, {
    eventId: 'ev-shadow',
    generation: TARGET_GEN,
    sourceRefKey: 'src-shadow',
    eventName: 'chat_message_accepted',
    occurredAtMs: NOW + 1000,
    actorKey: 'v2.p-actor',
  })
  insertFixtureEvent(db, {
    eventId: 'ev-retired',
    generation: RETIRED_GEN,
    sourceRefKey: 'src-retired',
    eventName: 'chat_message_accepted',
    occurredAtMs: NOW - 1000,
    actorKey: 'v0.p-actor',
  })
}

const seedRekeyRun = (db: Db, phase: string, targetGeneration: string): void => {
  db.$client.run(
    `INSERT INTO analytics_rekey_runs (
       run_id, source_generation, target_generation, from_versions, to_versions,
       source_high_water, phase, subphase, plan_hash, status, created_at, updated_at
     ) VALUES ('run-1', ?, ?, '["v1"]', '["v2"]', '0:0', ?, NULL, 'ph', 'running', 0, 0)`,
    [SOURCE_GEN, targetGeneration, phase],
  )
}

const outputEventIds = (path: string): readonly string[] => {
  const out = new Database(path, { readonly: true })
  const ids = out
    .query<{ event_id: string }, []>(`SELECT event_id FROM curated_events ORDER BY event_id`)
    .all()
    .map((row) => row.event_id)
  out.close()
  return ids
}

const stagingFilesLeft = (): readonly string[] => readdirSync(workDir).filter((name) => name.includes('.staging-'))

describe('snapshot output path safety', () => {
  test('rejects a relative output path and the live writer path', () => {
    const livePath = join(workDir, 'papai.db')
    writeFileSync(livePath, '', { mode: 0o600 })
    expect(() => assertSnapshotOutputPath('relative/snapshot.db', livePath)).toThrow('absolute')
    expect(() => assertSnapshotOutputPath(livePath, livePath)).toThrow('live')
    expect(() => assertSnapshotOutputPath(join(workDir, 'snapshot.db'), livePath)).not.toThrow()
    expect((statSync(livePath).mode & 0o777).toString(8)).toBe('600')
  })
})

describe('snapshot publisher', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedGraph(db)
  })

  test('publishes only the admitted active generation and records provenance in file and staged row', () => {
    const outputPath = join(workDir, 'snapshot.db')
    const result = publishAnalyticsSnapshot({ outputPath }, depsFor(db))
    expect(result.storageGeneration).toBe(SOURCE_GEN)
    expect(outputEventIds(outputPath)).toEqual(['ev-active'])
    const meta = verifySnapshotFile(outputPath)
    expect(meta.snapshotId).toBe(result.snapshotId)
    expect(meta.storageGeneration).toBe(SOURCE_GEN)
    expect(meta.sourceHighWater).toBe(`1:${NOW}`)
    expect(meta.reconciliationStatus).toBe('reconciled')
    const staged = getPublication(result.snapshotId, { getDrizzleDb: () => db })
    expect(staged?.state).toBe('staged')
    expect(staged?.transitionRunId).toBeNull()
    expect(staged?.sourceHighWater).toBe(`1:${NOW}`)
    expect(staged?.pathHash).toBe(result.pathHash)
    expect((statSync(outputPath).mode & 0o777).toString(8)).toBe('444')
    expect(stagingFilesLeft()).toEqual([])
  })

  test('a held cutover fence refuses ordinary staging instead of producing a cross-generation snapshot', () => {
    seedRekeyRun(db, 'cutover', TARGET_GEN)
    const outputPath = join(workDir, 'snapshot.db')
    expect(() => publishAnalyticsSnapshot({ outputPath }, depsFor(db))).toThrow('fence')
    expect(readdirSync(workDir)).toEqual([])
    expect(
      db.$client.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM analytics_snapshot_publications`).get()?.n,
    ).toBe(0)
  })

  test('a pointer swap landing between fence admission and generation resolution stages only the post-swap generation', () => {
    const inner = createRekeyCutoverFence({ getDrizzleDb: () => db })
    const swappingFence: RekeyCutoverFence = {
      ...inner,
      admit: (writerClass) => {
        const admission = inner.admit(writerClass)
        db.$client.run(`UPDATE analytics_active_generation SET active_generation = 'gen-2', updated_at_ms = 1`)
        return admission
      },
    }
    const outputPath = join(workDir, 'snapshot.db')
    const result = publishAnalyticsSnapshot({ outputPath }, { ...depsFor(db), fence: swappingFence })
    expect(result.storageGeneration).toBe(TARGET_GEN)
    expect(outputEventIds(outputPath)).toEqual(['ev-shadow'])
    expect(verifySnapshotFile(outputPath).storageGeneration).toBe(TARGET_GEN)
  })

  test('an admitted snapshot reader blocks the cutover drain until released', async () => {
    const fenceDb = await setupTestDb()
    const fence = createRekeyCutoverFence({ getDrizzleDb: () => fenceDb })
    const admission = fence.admit('snapshot')
    expect(admission).not.toBeNull()
    expect(fence.isDrained()).toBe(false)
    admission?.release()
    expect(fence.isDrained()).toBe(true)
  })

  test.each(['after_source_read', 'after_schema', 'during_insert'] as const)(
    'an injected failure at %s leaves neither staging file nor pointer',
    (point) => {
      const outputPath = join(workDir, 'snapshot.db')
      const deps = depsFor(db, (injected) => {
        const hooks: Partial<Record<SnapshotFailurePoint, () => void>> = {
          [point]: () => {
            throw new Error(`injected at ${point}`)
          },
        }
        hooks[injected]?.()
      })
      expect(() => publishAnalyticsSnapshot({ outputPath }, deps)).toThrow(`injected at ${point}`)
      expect(stagingFilesLeft()).toEqual([])
      expect(readdirSync(workDir)).toEqual([])
      expect(
        db.$client.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM analytics_snapshot_publications`).get()?.n,
      ).toBe(0)
    },
  )

  test('refuses to overwrite a previously valid snapshot without replace; replace swaps only after verify', () => {
    const outputPath = join(workDir, 'snapshot.db')
    publishAnalyticsSnapshot({ outputPath }, depsFor(db))
    const firstBytes = readFileSync(outputPath)
    expect(() => publishAnalyticsSnapshot({ outputPath }, depsFor(db))).toThrow('replace')
    expect(readFileSync(outputPath)).toEqual(firstBytes)
    expect(stagingFilesLeft()).toEqual([])
    const second = publishAnalyticsSnapshot(
      { outputPath, replace: true },
      { ...depsFor(db), snapshotId: () => 'snap-test-2' },
    )
    expect(second.snapshotId).toBe('snap-test-2')
    expect(verifySnapshotFile(outputPath).snapshotId).toBe('snap-test-2')
  })

  test('the rekey-owned token stages for the target generation only after the swap', () => {
    seedRekeyRun(db, 'snapshot_republish', TARGET_GEN)
    const outputPath = join(workDir, 'snapshot.db')
    expect(() => publishAnalyticsSnapshot({ outputPath, transitionRunId: 'run-1' }, depsFor(db))).toThrow(
      'active generation',
    )
    db.$client.run(`UPDATE analytics_active_generation SET active_generation = 'gen-2', updated_at_ms = 1`)
    const result = publishAnalyticsSnapshot({ outputPath, transitionRunId: 'run-1' }, depsFor(db))
    expect(result.storageGeneration).toBe(TARGET_GEN)
    expect(outputEventIds(outputPath)).toEqual(['ev-shadow'])
    const staged = getPublication(result.snapshotId, { getDrizzleDb: () => db })
    expect(staged?.transitionRunId).toBe('run-1')
  })
})

describe('snapshot staging consistency under an open writer', () => {
  const createFileBackedDb = (): { path: string; db: Db } => {
    const path = join(workDir, 'live.db')
    const template = new Database(':memory:')
    template.run('PRAGMA foreign_keys=ON')
    runMigrations(template, MIGRATIONS)
    writeFileSync(path, template.serialize())
    template.close()
    const sqlite = new Database(path)
    sqlite.run('PRAGMA journal_mode=WAL')
    sqlite.run('PRAGMA foreign_keys=ON')
    const db: Db = drizzle(sqlite, { schema })
    return { path, db }
  }

  test('an open writer transaction yields either pre- or post-commit rows, never a mix', () => {
    const { path, db } = createFileBackedDb()
    seedGraph(db)
    const writer = new Database(path)
    writer.run('PRAGMA journal_mode=WAL')
    writer.run('BEGIN IMMEDIATE')
    writer.run(
      `INSERT INTO analytics_events (
         event_id, storage_generation, process_epoch_id, source_ref_key, source_kind,
         schema_version, event_name, event_version, occurred_at_ms, ingested_at_ms, source,
         attribution_quality, app_version, deployment_key, key_version, platform,
         platform_instance_key, actor_key, context_key, thread_key, conversation_key,
         task_instance_key, context_type, actor_role, task_provider, invocation_mode,
         turn_key, session_key, policy_version, eligibility, max_class, props_json, expires_at_ms
       ) VALUES (
         'ev-uncommitted', 'gen-1', 'epoch-1', 'src-uncommitted', 'live', 1,
         'chat_message_accepted', 1, ${NOW + 50}, ${NOW + 51}, 'live', 'native', '6.10.0',
         'v1.p-deploy', 'v1', 'telegram', 'v1.p-platform', 'v1.p-actor', NULL, NULL,
         'v1.p-conversation', NULL, 'dm', 'admin', 'none', 'normal', NULL, 'v1.p-uncommitted-session',
         1, 'allowed', 'C0', '{}', ${NOW + 90 * 86_400_000}
       )`,
    )
    writer.run(
      `INSERT INTO analytics_sessions (
         session_key, storage_generation, actor_key, conversation_key, start_ms, end_ms,
         duration_ms, activity_count, turn_count, first_event_id, last_event_id, sessionization_version
       ) VALUES ('v1.p-uncommitted-session', 'gen-1', 'v1.p-actor', 'v1.p-conversation', ${NOW}, ${NOW + 50},
                 50, 1, 0, 'ev-uncommitted', 'ev-uncommitted', 1)`,
    )
    const outputPath = join(workDir, 'snapshot.db')
    publishAnalyticsSnapshot(
      { outputPath },
      depsFor(db, (point) => {
        const hooks: Partial<Record<SnapshotFailurePoint, () => void>> = {
          after_source_read: () => {
            writer.run('COMMIT')
            writer.close()
          },
        }
        hooks[point]?.()
      }),
    )
    const eventIds = outputEventIds(outputPath)
    const out = new Database(outputPath, { readonly: true })
    const sessions = out
      .query<{ session_key: string }, []>(`SELECT session_key FROM curated_sessions`)
      .all()
      .map((row) => row.session_key)
    out.close()
    expect(eventIds.includes('ev-uncommitted')).toBe(false)
    expect(sessions.includes('v1.p-uncommitted-session')).toBe(false)
    const secondPath = join(workDir, 'snapshot-after.db')
    publishAnalyticsSnapshot({ outputPath: secondPath }, { ...depsFor(db), snapshotId: () => 'snap-after-commit' })
    expect(outputEventIds(secondPath)).toContain('ev-uncommitted')
    db.$client.close()
  })
})
