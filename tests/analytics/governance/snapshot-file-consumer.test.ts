// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileBoundConsumer } from '../../../src/analytics/governance/snapshot-file-consumer.js'
import { createSnapshotSchema } from '../../../src/analytics/jobs/snapshot-schema.js'

let workDir = ''

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'papai-file-consumer-test-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const writeSnapshotFile = (snapshotId: string, actorKeys: readonly string[]): string => {
  const path = join(workDir, `${snapshotId}.db`)
  const db = new Database(path)
  createSnapshotSchema(db, 'pseudonymous')
  db.prepare(
    `INSERT INTO snapshot_meta (
       singleton_id, snapshot_id, created_at_ms, storage_generation, source_high_water,
       source_row_count, curated_row_counts_json, model_versions_json, reconciliation_status, snapshot_mode
     ) VALUES (1, ?, 1, 'gen-1', '1:1', 1, '{}', '{}', 'reconciled', 'pseudonymous')`,
  ).run(snapshotId)
  for (const [index, actorKey] of actorKeys.entries()) {
    db.prepare(
      `INSERT INTO curated_events (
         event_id, event_name, occurred_at_ms, utc_day, platform, platform_instance_key, context_type,
         actor_role, task_provider, app_version, invocation_mode, eligibility, actor_key
       ) VALUES (?, 'chat_message_accepted', ?, '2023-11-14', 'telegram', 'v1.p-platform', 'dm',
                 'member', 'none', '6.10.0', 'normal', 'allowed', ?)`,
    ).run(`ev-${index}`, index + 1, actorKey)
  }
  db.run('VACUUM')
  db.close()
  return path
}

describe('file-bound snapshot consumer', () => {
  test('pooled connections report the served snapshot_id and contributions', () => {
    const oldPath = writeSnapshotFile('snap-old', ['v1.p-actor'])
    const newPath = writeSnapshotFile('snap-new', [])
    const consumer = createFileBoundConsumer()
    consumer.configure(oldPath)
    consumer.reopen()
    expect(consumer.currentSnapshotId()).toBe('snap-old')
    expect(consumer.contributionOf('v1.p-actor')).toBe(1)
    expect(consumer.hasOpenHandle(oldPath)).toBe(true)
    consumer.quiesce()
    consumer.closeAll()
    expect(consumer.hasOpenHandle(oldPath)).toBe(false)
    consumer.configure(newPath)
    consumer.reopen()
    expect(consumer.currentSnapshotId()).toBe('snap-new')
    expect(consumer.contributionOf('v1.p-actor')).toBe(0)
    consumer.closeAll()
  })

  test('a pointer-only configure without close keeps the old handle open', () => {
    const oldPath = writeSnapshotFile('snap-old', [])
    const newPath = writeSnapshotFile('snap-new', [])
    const consumer = createFileBoundConsumer()
    consumer.configure(oldPath)
    consumer.reopen()
    consumer.configure(newPath)
    expect(consumer.hasOpenHandle(oldPath)).toBe(true)
    consumer.closeAll()
  })

  test('quiesced state blocks resume semantics explicitly', () => {
    const consumer = createFileBoundConsumer()
    consumer.quiesce()
    expect(consumer.currentSnapshotId()).toBeNull()
    consumer.resume()
    consumer.closeAll()
  })
})
