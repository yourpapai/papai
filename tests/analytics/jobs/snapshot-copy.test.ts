// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { copyCuratedRows } from '../../../src/analytics/jobs/snapshot-copy.js'
import { createSnapshotSchema } from '../../../src/analytics/jobs/snapshot-schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { insertFixtureEvent, NOW, RETIRED_GEN, SOURCE_GEN, TARGET_GEN } from '../rekey/fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const seedGraph = (db: Db): void => {
  db.$client.run(`INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('epoch-1', 'open', 0)`)
  insertFixtureEvent(db, {
    eventId: 'ev-a1',
    generation: SOURCE_GEN,
    sourceRefKey: 'src-a1',
    eventName: 'tool_completed',
    occurredAtMs: NOW,
    actorKey: 'v1.p-actor',
    conversationKey: 'v1.p-conversation',
    turnKey: 'v1.p-turn',
    sessionKey: 'v1.p-session',
    propsJson: JSON.stringify({
      execution_outcome: 'semantic_success',
      duration_ms: 750,
      secret_canary: 'CANARY-PROPS-SECRET',
    }),
  })
  insertFixtureEvent(db, {
    eventId: 'ev-a2',
    generation: SOURCE_GEN,
    sourceRefKey: 'src-a2',
    eventName: 'chat_message_accepted',
    occurredAtMs: NOW + 1000,
    actorKey: 'v1.p-actor',
    conversationKey: 'v1.p-conversation',
  })
  insertFixtureEvent(db, {
    eventId: 'ev-expired',
    generation: SOURCE_GEN,
    sourceRefKey: 'src-expired',
    eventName: 'chat_message_accepted',
    occurredAtMs: NOW - 200 * 86_400_000,
    actorKey: 'v1.p-actor',
    expiresAtMs: NOW - 1,
  })
  insertFixtureEvent(db, {
    eventId: 'ev-shadow',
    generation: TARGET_GEN,
    sourceRefKey: 'src-shadow',
    eventName: 'chat_message_accepted',
    occurredAtMs: NOW + 2000,
    actorKey: 'v2.p-actor',
  })
  insertFixtureEvent(db, {
    eventId: 'ev-retired',
    generation: RETIRED_GEN,
    sourceRefKey: 'src-retired',
    eventName: 'chat_message_accepted',
    occurredAtMs: NOW - 3000,
    actorKey: 'v0.p-actor',
  })
  db.$client.run(
    `INSERT INTO analytics_sessions (
       session_key, storage_generation, actor_key, conversation_key, start_ms, end_ms,
       duration_ms, activity_count, turn_count, first_event_id, last_event_id, sessionization_version
     ) VALUES ('v1.p-session', 'gen-1', 'v1.p-actor', 'v1.p-conversation', ?, ?, 1000, 2, 1, 'ev-a1', 'ev-a2', 1)`,
    [NOW, NOW + 1000],
  )
  db.$client.run(
    `INSERT INTO analytics_sessions (
       session_key, storage_generation, actor_key, conversation_key, start_ms, end_ms,
       duration_ms, activity_count, turn_count, first_event_id, last_event_id, sessionization_version
     ) VALUES ('v2.p-session', 'gen-2', 'v2.p-actor', 'v2.p-conversation', ?, ?, 1000, 1, 1, 'ev-shadow', 'ev-shadow', 1)`,
    [NOW + 2000, NOW + 3000],
  )
  db.$client.run(
    `INSERT INTO analytics_daily_counters (
       utc_day, definition_version, platform, context_type, actor_role, task_provider, app_version,
       metric, value, finalized, partial_day, restart_gap_detected, late_event_count,
       reconciliation_status, disclosure_scope, contributor_basis, contributor_count, threshold
     ) VALUES ('2023-11-14', 1, 'telegram', 'dm', 'admin', 'none', '6.10.0', 'messages', 2, 1, 0, 0, 0,
               'complete_epoch', 'local_only', 'not_required', NULL, NULL)`,
  )
}

const openPublishDb = (): Database => {
  const publishDb = new Database(':memory:')
  createSnapshotSchema(publishDb, 'pseudonymous')
  return publishDb
}

describe('snapshot copy', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedGraph(db)
  })

  test('copies only unexpired active-generation rows; shadow and retired rows are never input', () => {
    const publishDb = openPublishDb()
    const result = copyCuratedRows(db, publishDb, { generation: SOURCE_GEN, nowMs: NOW + 5000, mode: 'pseudonymous' })
    const eventIds = publishDb
      .query<{ event_id: string }, []>(`SELECT event_id FROM curated_events ORDER BY event_id`)
      .all()
      .map((row) => row.event_id)
    expect(eventIds).toEqual(['ev-a1', 'ev-a2'])
    const sessionKeys = publishDb
      .query<{ session_key: string }, []>(`SELECT session_key FROM curated_sessions`)
      .all()
      .map((row) => row.session_key)
    expect(sessionKeys).toEqual(['v1.p-session'])
    expect(result.rowCounts['curated_events']).toBe(2)
    expect(result.rowCounts['curated_sessions']).toBe(1)
    publishDb.close()
  })

  test('curated events carry typed props and never the raw props bytes', () => {
    const publishDb = openPublishDb()
    copyCuratedRows(db, publishDb, { generation: SOURCE_GEN, nowMs: NOW + 5000, mode: 'pseudonymous' })
    const row = publishDb
      .query<{ prop_execution_outcome: string | null; prop_duration_ms: number | null; utc_day: string }, [string]>(
        `SELECT prop_execution_outcome, prop_duration_ms, utc_day FROM curated_events WHERE event_id = ?`,
      )
      .get('ev-a1')
    expect(row).toEqual({ prop_execution_outcome: 'semantic_success', prop_duration_ms: 750, utc_day: '2023-11-14' })
    publishDb.close()
  })

  test('records the generation-scoped high-water mark and source row count', () => {
    const publishDb = openPublishDb()
    const result = copyCuratedRows(db, publishDb, { generation: SOURCE_GEN, nowMs: NOW + 5000, mode: 'pseudonymous' })
    expect(result.sourceHighWater).toBe(`3:${NOW + 1000}`)
    expect(result.sourceRowCount).toBe(3)
    publishDb.close()
  })

  test('copies the unversioned C0 aggregate store under its own contract', () => {
    const publishDb = openPublishDb()
    const result = copyCuratedRows(db, publishDb, { generation: SOURCE_GEN, nowMs: NOW + 5000, mode: 'pseudonymous' })
    expect(result.rowCounts['analytics_daily_counters']).toBe(1)
    const counter = publishDb
      .query<{ value: number }, []>(`SELECT value FROM analytics_daily_counters WHERE metric = 'messages'`)
      .get()
    expect(counter?.value).toBe(2)
    publishDb.close()
  })

  test('aggregate-only mode withholds actor-level rows entirely', () => {
    const publishDb = new Database(':memory:')
    createSnapshotSchema(publishDb, 'aggregate_only')
    const result = copyCuratedRows(db, publishDb, { generation: SOURCE_GEN, nowMs: NOW + 5000, mode: 'aggregate_only' })
    expect(result.rowCounts['analytics_daily_counters']).toBe(1)
    expect(result.rowCounts['curated_events']).toBeUndefined()
    expect(result.sourceRowCount).toBe(3)
    publishDb.close()
  })
})
