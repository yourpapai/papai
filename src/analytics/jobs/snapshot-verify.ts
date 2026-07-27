// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { isAbsolute, resolve } from 'node:path'

import type { SnapshotMode } from './snapshot-schema.js'

export type SnapshotMeta = Readonly<{
  snapshotId: string
  createdAtMs: number
  storageGeneration: string
  sourceHighWater: string
  sourceRowCount: number
  curatedRowCounts: Readonly<Record<string, number>>
  modelVersions: Readonly<Record<string, number>>
  reconciliationStatus: string
  snapshotMode: SnapshotMode
}>

/** The snapshot path must be absolute and never the live papai writer file. */
export const assertSnapshotOutputPath = (outputPath: string, liveDbPath: string | null): void => {
  if (!isAbsolute(outputPath)) throw new Error('snapshot output path must be absolute')
  if (liveDbPath !== null && liveDbPath !== ':memory:' && resolve(outputPath) === resolve(liveDbPath)) {
    throw new Error('snapshot output path must never be the live writer database')
  }
}

type MetaRow = {
  snapshot_id: string
  created_at_ms: number
  storage_generation: string
  source_high_water: string
  source_row_count: number
  curated_row_counts_json: string
  model_versions_json: string
  reconciliation_status: string
  snapshot_mode: string
}

const readMeta = (db: Database): SnapshotMeta => {
  const row = db.query<MetaRow, []>(`SELECT * FROM snapshot_meta WHERE singleton_id = 1`).get()
  if (row === null || row === undefined) throw new Error('snapshot_meta singleton row is missing')
  const counts: unknown = JSON.parse(row.curated_row_counts_json)
  const versions: unknown = JSON.parse(row.model_versions_json)
  if (typeof counts !== 'object' || counts === null || typeof versions !== 'object' || versions === null) {
    throw new Error('snapshot_meta provenance JSON is invalid')
  }
  return {
    snapshotId: row.snapshot_id,
    createdAtMs: row.created_at_ms,
    storageGeneration: row.storage_generation,
    sourceHighWater: row.source_high_water,
    sourceRowCount: row.source_row_count,
    curatedRowCounts: Object.fromEntries(Object.entries(counts)),
    modelVersions: Object.fromEntries(Object.entries(versions)),
    reconciliationStatus: row.reconciliation_status,
    snapshotMode: row.snapshot_mode === 'aggregate_only' ? 'aggregate_only' : 'pseudonymous',
  }
}

/** Reopens a published file read-only and verifies its embedded provenance. */
export const verifySnapshotFile = (
  path: string,
  expected?: Readonly<{ snapshotId?: string; storageGeneration?: string }>,
): SnapshotMeta => {
  const db = new Database(path, { readonly: true })
  try {
    const meta = readMeta(db)
    if (expected?.snapshotId !== undefined && meta.snapshotId !== expected.snapshotId) {
      throw new Error('snapshot file id does not match the expected publication')
    }
    if (expected?.storageGeneration !== undefined && meta.storageGeneration !== expected.storageGeneration) {
      throw new Error('snapshot file generation does not match the expected generation')
    }
    for (const [table, count] of Object.entries(meta.curatedRowCounts)) {
      const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM "${table}"`).get()
      if ((row?.n ?? -1) !== count) throw new Error(`curated row count mismatch for ${table}`)
    }
    return meta
  } finally {
    db.close()
  }
}
