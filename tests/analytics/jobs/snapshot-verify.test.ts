// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSnapshotSchema } from '../../../src/analytics/jobs/snapshot-schema.js'
import { assertSnapshotOutputPath, verifySnapshotFile } from '../../../src/analytics/jobs/snapshot-verify.js'

let workDir = ''

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'papai-snapshot-verify-test-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const writeSnapshot = (snapshotId: string, generation: string): string => {
  const path = join(workDir, `${snapshotId}.db`)
  const db = new Database(path)
  createSnapshotSchema(db, 'pseudonymous')
  db.prepare(
    `INSERT INTO snapshot_meta (
       singleton_id, snapshot_id, created_at_ms, storage_generation, source_high_water,
       source_row_count, curated_row_counts_json, model_versions_json, reconciliation_status, snapshot_mode
     ) VALUES (1, ?, 1, ?, '1:1', 0, '{}', '{}', 'reconciled', 'pseudonymous')`,
  ).run(snapshotId, generation)
  db.run('VACUUM')
  db.close()
  return path
}

describe('assertSnapshotOutputPath', () => {
  test('rejects a relative output path', () => {
    expect(() => assertSnapshotOutputPath('relative/snapshot.db', null)).toThrow('absolute')
  })

  test('rejects the live writer database path', () => {
    const live = join(workDir, 'papai.db')
    expect(() => assertSnapshotOutputPath(live, live)).toThrow('live writer')
  })

  test('accepts an absolute path distinct from the live writer', () => {
    expect(() => assertSnapshotOutputPath(join(workDir, 'snapshot.db'), ':memory:')).not.toThrow()
  })
})

describe('verifySnapshotFile', () => {
  test('returns embedded provenance for a well-formed snapshot', () => {
    const path = writeSnapshot('snap-v', 'gen-1')
    const meta = verifySnapshotFile(path, { snapshotId: 'snap-v', storageGeneration: 'gen-1' })
    expect(meta.snapshotId).toBe('snap-v')
    expect(meta.storageGeneration).toBe('gen-1')
    expect(meta.snapshotMode).toBe('pseudonymous')
  })

  test('rejects a snapshot_id mismatch', () => {
    const path = writeSnapshot('snap-v', 'gen-1')
    expect(() => verifySnapshotFile(path, { snapshotId: 'snap-other' })).toThrow('id does not match')
  })

  test('rejects a storage generation mismatch', () => {
    const path = writeSnapshot('snap-v', 'gen-1')
    expect(() => verifySnapshotFile(path, { storageGeneration: 'gen-2' })).toThrow('generation does not match')
  })
})
