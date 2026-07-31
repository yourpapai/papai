// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration072AnalyticsFoundation } from '../../../src/db/migrations/072_analytics_foundation.js'
import { migration073AnalyticsGovernance } from '../../../src/db/migrations/073_analytics_governance.js'
import { migration074AnalyticsDelivery } from '../../../src/db/migrations/074_analytics_delivery.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)

const getColumnNames = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name)

const DELIVERY_TABLES = [
  'analytics_sinks',
  'analytics_deliveries',
  'analytics_aggregate_releases',
  'analytics_aggregate_deliveries',
  'analytics_delivery_deletion_receipts',
]

const insertMinimalEvent = (db: Database, eventId: string): void => {
  db.run(
    `INSERT OR IGNORE INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('epoch-1', 'open', 1700000000000)`,
  )
  db.run(
    `INSERT INTO analytics_events (
       event_id, storage_generation, process_epoch_id, source_ref_key, source_kind,
       schema_version, event_name, event_version, occurred_at_ms, ingested_at_ms,
       source, attribution_quality, app_version, deployment_key, key_version,
       platform, platform_instance_key, context_type, actor_role, task_provider,
       invocation_mode, policy_version, eligibility, max_class, props_json, expires_at_ms
     ) VALUES (
       ?, 'gen-1', 'epoch-1', ?, 'live',
       1, 'turn_started', 1, 1700000000000, 1700000000001,
       'live', 'native', '6.10.0', 'v1.p-deploy', 'v1',
       'telegram', 'v1.p-instance', 'dm', 'admin', 'none',
       'normal', 1, 'allowed', 'C0', '{}', 1700000000002
     )`,
    [eventId, `ref-${eventId}`],
  )
}

const insertSink = (
  db: Database,
  sinkVersionId: string,
  state: string,
  logicalSinkId = 'sink-a',
  version = 1,
): void => {
  db.run(
    `INSERT INTO analytics_sinks (
       sink_version_id, logical_sink_id, version, kind, state, payload_schema_version,
       egress_mode, endpoint_ciphertext, secret_ciphertext, config_fingerprint, created_at_ms
     ) VALUES (?, ?, ?, 'webhook', ?, 1, 'pseudonymous', 'ct-endpoint', 'ct-secret', 'fp', 1700000000000)`,
    [sinkVersionId, logicalSinkId, version, state],
  )
}

const insertDelivery = (db: Database, eventId: string, sinkVersionId: string, state: string): void => {
  db.run(
    `INSERT INTO analytics_deliveries (
       event_id, sink_version_id, grant_key, grant_key_version, grant_generation,
       state, next_attempt_at_ms, payload_schema_version
     ) VALUES (?, ?, 'v1.d-grant', 'v1', 1, ?, 1700000000000, 1)`,
    [eventId, sinkVersionId, state],
  )
}

const insertDeletionRequest = (db: Database, requestId: string): void => {
  db.run(
    `INSERT INTO analytics_deletion_requests (
       request_id, governance_actor_key, key_version, state, policy_version, requested_at_ms
     ) VALUES (?, 'v1.g-actor', 'v1', 'requested', 1, 1700000000000)`,
    [requestId],
  )
}

describe('migration 074_analytics_delivery', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
    migration072AnalyticsFoundation.up(db)
    migration073AnalyticsGovernance.up(db)
    migration074AnalyticsDelivery.up(db)
  })

  afterEach(() => {
    db.close()
  })

  test('exports a migration with the expected id', () => {
    expect(migration074AnalyticsDelivery.id).toBe('074_analytics_delivery')
    expect(typeof migration074AnalyticsDelivery.up).toBe('function')
  })

  test('creates every delivery-ledger table', () => {
    const tables = getTableNames(db)
    for (const table of DELIVERY_TABLES) {
      expect(tables).toContain(table)
    }
  })

  test('sinks use closed kind, state, and egress mode values with a pinned payload schema', () => {
    expect(() => insertSink(db, 'sv-bad-kind', 'pending_verification')).not.toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_sinks (
           sink_version_id, logical_sink_id, version, kind, state, payload_schema_version,
           egress_mode, endpoint_ciphertext, secret_ciphertext, config_fingerprint, created_at_ms
         ) VALUES ('sv-k', 'sink-k', 1, 'carrier-pigeon', 'pending_verification', 1, 'pseudonymous', 'c', 'c', 'f', 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_sinks (
           sink_version_id, logical_sink_id, version, kind, state, payload_schema_version,
           egress_mode, endpoint_ciphertext, secret_ciphertext, config_fingerprint, created_at_ms
         ) VALUES ('sv-s', 'sink-s', 1, 'webhook', 'half_on', 1, 'pseudonymous', 'c', 'c', 'f', 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_sinks (
           sink_version_id, logical_sink_id, version, kind, state, payload_schema_version,
           egress_mode, endpoint_ciphertext, secret_ciphertext, config_fingerprint, created_at_ms
         ) VALUES ('sv-m', 'sink-m', 1, 'webhook', 'pending_verification', 1, 'everything', 'c', 'c', 'f', 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_sinks (
           sink_version_id, logical_sink_id, version, kind, state, payload_schema_version,
           egress_mode, endpoint_ciphertext, secret_ciphertext, config_fingerprint, created_at_ms
         ) VALUES ('sv-v', 'sink-v', 1, 'webhook', 'pending_verification', 2, 'pseudonymous', 'c', 'c', 'f', 1)`,
      ),
    ).toThrow()
  })

  test('sink versions are unique per logical sink and immutable evidence', () => {
    insertSink(db, 'sv-1', 'disabled')
    expect(() => insertSink(db, 'sv-1b', 'disabled')).toThrow()
    insertSink(db, 'sv-2', 'disabled', 'sink-a', 2)
  })

  test('at most one enabled external sink is allowed in v1', () => {
    insertSink(db, 'sv-en-1', 'enabled', 'sink-a', 1)
    expect(() => insertSink(db, 'sv-en-2', 'enabled', 'sink-b', 1)).toThrow()
    insertSink(db, 'sv-pv-2', 'pending_verification', 'sink-b', 1)
    db.run(`UPDATE analytics_sinks SET state = 'disabled', disabled_at_ms = 1 WHERE sink_version_id = 'sv-en-1'`)
    db.run(`UPDATE analytics_sinks SET state = 'enabled', verified_at_ms = 2 WHERE sink_version_id = 'sv-pv-2'`)
  })

  test('deliveries use the closed nine-state machine', () => {
    for (const state of [
      'pending',
      'leased',
      'sending',
      'delivered',
      'ambiguous',
      'dead',
      'delete_pending',
      'deleted',
      'cancelled',
    ]) {
      insertMinimalEvent(db, `event-${state}`)
      insertSink(db, `sv-${state}`, 'disabled', `sink-${state}`, 1)
      insertDelivery(db, `event-${state}`, `sv-${state}`, state)
    }
    insertMinimalEvent(db, 'event-bad')
    insertSink(db, 'sv-bad', 'disabled')
    expect(() => insertDelivery(db, 'event-bad', 'sv-bad', 'vanished')).toThrow()
  })

  test('delivery rows are unique per (event_id, sink_version_id)', () => {
    insertMinimalEvent(db, 'event-1')
    insertSink(db, 'sv-1', 'disabled')
    insertDelivery(db, 'event-1', 'sv-1', 'pending')
    expect(() => insertDelivery(db, 'event-1', 'sv-1', 'pending')).toThrow()
  })

  test('a canonical event cannot disappear while delivery evidence references it', () => {
    insertMinimalEvent(db, 'event-1')
    insertSink(db, 'sv-1', 'disabled')
    insertDelivery(db, 'event-1', 'sv-1', 'pending')
    expect(() => db.run(`DELETE FROM analytics_events WHERE event_id = 'event-1'`)).toThrow()
  })

  test('a referenced sink version cannot be deleted', () => {
    insertMinimalEvent(db, 'event-1')
    insertSink(db, 'sv-1', 'disabled')
    insertDelivery(db, 'event-1', 'sv-1', 'pending')
    expect(() => db.run(`DELETE FROM analytics_sinks WHERE sink_version_id = 'sv-1'`)).toThrow()
  })

  test('delivery rows carry grant references and bounded error classes only', () => {
    expect(getColumnNames(db, 'analytics_deliveries')).toEqual([
      'event_id',
      'sink_version_id',
      'grant_key',
      'grant_key_version',
      'grant_generation',
      'state',
      'attempts',
      'next_attempt_at_ms',
      'lease_until_ms',
      'send_started_at_ms',
      'last_error_class',
      'delivered_at_ms',
      'remote_receipt_hash',
      'delete_requested_at_ms',
      'deleted_at_ms',
      'payload_schema_version',
    ])
    insertMinimalEvent(db, 'event-1')
    insertSink(db, 'sv-1', 'disabled')
    expect(() =>
      db.run(
        `INSERT INTO analytics_deliveries (
           event_id, sink_version_id, grant_key, grant_key_version, grant_generation,
           state, next_attempt_at_ms, last_error_class, payload_schema_version
         ) VALUES ('event-1', 'sv-1', 'v1.d-grant', 'v1', 1, 'pending', 1, 'econnreset exploded with a huge body', 1)`,
      ),
    ).toThrow()
  })

  test('aggregate releases store only a strict payload and deterministic release hash', () => {
    expect(getColumnNames(db, 'analytics_aggregate_releases')).toEqual([
      'release_id',
      'release_hash',
      'payload_json',
      'payload_schema_version',
      'created_at_ms',
    ])
    db.run(
      `INSERT INTO analytics_aggregate_releases (release_id, release_hash, payload_json, payload_schema_version, created_at_ms)
       VALUES ('rel-1', 'hash-1', '{"a":1}', 1, 1700000000000)`,
    )
    expect(() =>
      db.run(
        `INSERT INTO analytics_aggregate_releases (release_id, release_hash, payload_json, payload_schema_version, created_at_ms)
         VALUES ('rel-2', 'hash-1', '{"a":2}', 1, 1700000000000)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_aggregate_releases (release_id, release_hash, payload_json, payload_schema_version, created_at_ms)
         VALUES ('rel-3', 'hash-3', 'not-json', 1, 1700000000000)`,
      ),
    ).toThrow()
  })

  test('aggregate deliveries use (release_id, sink_version_id) and the same state machine without an actor grant', () => {
    const columns = getColumnNames(db, 'analytics_aggregate_deliveries')
    expect(columns).toContain('release_id')
    expect(columns).toContain('sink_version_id')
    expect(columns).not.toContain('grant_key')
    expect(columns).not.toContain('grant_key_version')
    expect(columns).not.toContain('grant_generation')
    expect(columns).not.toContain('event_id')

    insertSink(db, 'sv-1', 'disabled')
    db.run(
      `INSERT INTO analytics_aggregate_releases (release_id, release_hash, payload_json, payload_schema_version, created_at_ms)
       VALUES ('rel-1', 'hash-1', '{"a":1}', 1, 1700000000000)`,
    )
    db.run(
      `INSERT INTO analytics_aggregate_deliveries (release_id, sink_version_id, state, next_attempt_at_ms, payload_schema_version)
       VALUES ('rel-1', 'sv-1', 'pending', 1700000000000, 1)`,
    )
    expect(() =>
      db.run(
        `INSERT INTO analytics_aggregate_deliveries (release_id, sink_version_id, state, next_attempt_at_ms, payload_schema_version)
         VALUES ('rel-1', 'sv-1', 'pending', 1700000000000, 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_aggregate_deliveries (release_id, sink_version_id, state, next_attempt_at_ms, payload_schema_version)
         VALUES ('rel-1', 'sv-1', 'vanished', 1700000000000, 1)`,
      ),
    ).toThrow()
    expect(() => db.run(`DELETE FROM analytics_aggregate_releases WHERE release_id = 'rel-1'`)).toThrow()
    expect(() => db.run(`DELETE FROM analytics_sinks WHERE sink_version_id = 'sv-1'`)).toThrow()
  })

  test('deletion receipts keep only request/sink IDs, controlled state, receipt hash, and times', () => {
    expect(getColumnNames(db, 'analytics_delivery_deletion_receipts')).toEqual([
      'deletion_request_id',
      'sink_version_id',
      'state',
      'remote_receipt_hash',
      'requested_at_ms',
      'reconciled_at_ms',
    ])
    insertSink(db, 'sv-1', 'disabled')
    insertDeletionRequest(db, 'req-1')
    db.run(
      `INSERT INTO analytics_delivery_deletion_receipts (
         deletion_request_id, sink_version_id, state, requested_at_ms
       ) VALUES ('req-1', 'sv-1', 'pending', 1700000000000)`,
    )
    expect(() =>
      db.run(
        `INSERT INTO analytics_delivery_deletion_receipts (
           deletion_request_id, sink_version_id, state, requested_at_ms
         ) VALUES ('req-1', 'sv-1', 'pending', 1700000000000)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_delivery_deletion_receipts (
           deletion_request_id, sink_version_id, state, requested_at_ms
         ) VALUES ('req-1', 'sv-1', 'vanished', 1700000000000)`,
      ),
    ).toThrow()
    expect(() => db.run(`DELETE FROM analytics_sinks WHERE sink_version_id = 'sv-1'`)).toThrow()
    expect(() => db.run(`DELETE FROM analytics_deletion_requests WHERE request_id = 'req-1'`)).toThrow()
  })
})
