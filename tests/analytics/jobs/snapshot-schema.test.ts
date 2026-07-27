// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import {
  createSnapshotSchema,
  CURATED_EVENT_PROP_COLUMNS,
  CURATED_TABLES_AGGREGATE_ONLY,
  CURATED_TABLES_PSEUDONYMOUS,
  extractTypedProps,
  SNAPSHOT_MODEL_VERSIONS,
} from '../../../src/analytics/jobs/snapshot-schema.js'

const tableNames = (db: Database): readonly string[] =>
  db
    .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((row) => row.name)

describe('snapshot schema', () => {
  test('creates a fresh empty publish database with only allowlisted pseudonymous tables', () => {
    const db = new Database(':memory:')
    createSnapshotSchema(db, 'pseudonymous')
    expect(tableNames(db)).toEqual([...CURATED_TABLES_PSEUDONYMOUS].sort())
    db.close()
  })

  test('aggregate-only mode keeps actor-level shells empty so models label them unavailable', () => {
    const db = new Database(':memory:')
    createSnapshotSchema(db, 'aggregate_only')
    expect(tableNames(db)).toEqual([...CURATED_TABLES_AGGREGATE_ONLY].sort())
    for (const table of ['curated_events', 'curated_sessions', 'curated_turn_friction']) {
      const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM "${table}"`).get()
      expect(row?.n).toBe(0)
    }
    db.close()
  })

  test('never copies live-only columns such as props_json into the curated event schema', () => {
    const db = new Database(':memory:')
    createSnapshotSchema(db, 'pseudonymous')
    const columns = db
      .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('curated_events')`)
      .all()
      .map((row) => row.name)
    expect(columns).not.toContain('props_json')
    expect(columns).not.toContain('source_ref_key')
    expect(columns).not.toContain('storage_generation')
    expect(columns).not.toContain('expires_at_ms')
    for (const propColumn of CURATED_EVENT_PROP_COLUMNS) {
      expect(columns).toContain(propColumn)
    }
    db.close()
  })

  test('snapshot_meta records provenance and model versions', () => {
    const db = new Database(':memory:')
    createSnapshotSchema(db, 'pseudonymous')
    const columns = db
      .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('snapshot_meta')`)
      .all()
      .map((row) => row.name)
    for (const expected of [
      'snapshot_id',
      'created_at_ms',
      'storage_generation',
      'source_high_water',
      'source_row_count',
      'curated_row_counts_json',
      'model_versions_json',
      'reconciliation_status',
      'snapshot_mode',
    ]) {
      expect(columns).toContain(expected)
    }
    expect(SNAPSHOT_MODEL_VERSIONS['00-data-health']).toBe(1)
    expect(SNAPSHOT_MODEL_VERSIONS['01-activation']).toBe(1)
    expect(SNAPSHOT_MODEL_VERSIONS['02-retention-engagement']).toBe(1)
    expect(SNAPSHOT_MODEL_VERSIONS['03-intents-features']).toBe(1)
    expect(SNAPSHOT_MODEL_VERSIONS['04-reliability-friction-performance']).toBe(1)
    db.close()
  })

  test('extracts only allowlisted typed props and coerces numeric kinds', () => {
    const extracted = extractTypedProps({
      outcome: 'granted',
      execution_outcome: 'semantic_success',
      recovered_same_turn: 1,
      duration_ms: 1234,
      primary: 'task_done',
      goals: ['G1', 'G2'],
      native_user_id: 'RAW-NATIVE-ID',
      content: 'RAW-CONTENT',
    })
    expect(extracted['prop_outcome']).toBe('granted')
    expect(extracted['prop_execution_outcome']).toBe('semantic_success')
    expect(extracted['prop_recovered_same_turn']).toBe(1)
    expect(extracted['prop_duration_ms']).toBe(1234)
    expect(extracted['prop_primary_intent']).toBe('task_done')
    expect(extracted['prop_goals_json']).toBe('["G1","G2"]')
    expect(Object.values(extracted)).not.toContain('RAW-NATIVE-ID')
    expect(Object.values(extracted)).not.toContain('RAW-CONTENT')
  })

  test('drops allowlisted props whose value kind does not match the column kind', () => {
    const extracted = extractTypedProps({
      outcome: 42,
      duration_ms: 'not-a-number',
      goals: 'not-an-array',
      abstained: true,
    })
    expect(extracted['prop_outcome']).toBeUndefined()
    expect(extracted['prop_duration_ms']).toBeUndefined()
    expect(extracted['prop_goals_json']).toBeUndefined()
    expect(extracted['prop_abstained']).toBe(1)
  })
})
