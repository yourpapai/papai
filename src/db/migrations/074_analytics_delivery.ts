// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const DELIVERY_STATES = [
  'pending',
  'leased',
  'sending',
  'delivered',
  'ambiguous',
  'dead',
  'delete_pending',
  'deleted',
  'cancelled',
] as const

const DELIVERY_ERROR_CLASSES = ['network', 'timeout', 'http_4xx', 'http_5xx', 'auth', 'policy', 'unknown'] as const

const SINK_KINDS = ['webhook', 'openpanel'] as const

const sqlList = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(',')

const createSinksTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_sinks (
      sink_version_id TEXT PRIMARY KEY,
      logical_sink_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      kind TEXT NOT NULL CHECK(kind IN (${sqlList(SINK_KINDS)})),
      state TEXT NOT NULL CHECK(state IN ('pending_verification','enabled','disabled')),
      payload_schema_version INTEGER NOT NULL CHECK(payload_schema_version = 1),
      egress_mode TEXT NOT NULL CHECK(egress_mode IN ('aggregate','pseudonymous')),
      endpoint_ciphertext TEXT NOT NULL,
      secret_ciphertext TEXT NOT NULL,
      config_fingerprint TEXT NOT NULL,
      verified_at_ms INTEGER CHECK(verified_at_ms IS NULL OR verified_at_ms >= 0),
      created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
      disabled_at_ms INTEGER CHECK(disabled_at_ms IS NULL OR disabled_at_ms >= 0),
      UNIQUE(logical_sink_id, version)
    )
  `)
}

const createSingleEnabledSinkIndex = (db: Database): void => {
  db.run(`
    CREATE UNIQUE INDEX idx_analytics_sinks_single_enabled
      ON analytics_sinks((1))
      WHERE state = 'enabled'
  `)
}

const createDeliveriesTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_deliveries (
      event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE RESTRICT,
      sink_version_id TEXT NOT NULL
        REFERENCES analytics_sinks(sink_version_id) ON DELETE RESTRICT,
      grant_key TEXT NOT NULL,
      grant_key_version TEXT NOT NULL,
      grant_generation INTEGER NOT NULL CHECK(grant_generation > 0),
      state TEXT NOT NULL CHECK(state IN (${sqlList(DELIVERY_STATES)})),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      next_attempt_at_ms INTEGER NOT NULL CHECK(next_attempt_at_ms >= 0),
      lease_until_ms INTEGER CHECK(lease_until_ms IS NULL OR lease_until_ms >= 0),
      send_started_at_ms INTEGER CHECK(send_started_at_ms IS NULL OR send_started_at_ms >= 0),
      last_error_class TEXT CHECK(last_error_class IS NULL OR last_error_class IN (${sqlList(DELIVERY_ERROR_CLASSES)})),
      delivered_at_ms INTEGER CHECK(delivered_at_ms IS NULL OR delivered_at_ms >= 0),
      remote_receipt_hash TEXT,
      delete_requested_at_ms INTEGER CHECK(delete_requested_at_ms IS NULL OR delete_requested_at_ms >= 0),
      deleted_at_ms INTEGER CHECK(deleted_at_ms IS NULL OR deleted_at_ms >= 0),
      payload_schema_version INTEGER NOT NULL CHECK(payload_schema_version = 1),
      PRIMARY KEY(event_id, sink_version_id)
    )
  `)
  db.run(`
    CREATE INDEX idx_analytics_deliveries_ready
      ON analytics_deliveries(state, next_attempt_at_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_deliveries_lease
      ON analytics_deliveries(state, lease_until_ms)
  `)
}

const createAggregateReleasesTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_aggregate_releases (
      release_id TEXT PRIMARY KEY,
      release_hash TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      payload_schema_version INTEGER NOT NULL CHECK(payload_schema_version = 1),
      created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0)
    )
  `)
}

const createAggregateDeliveriesTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_aggregate_deliveries (
      release_id TEXT NOT NULL
        REFERENCES analytics_aggregate_releases(release_id) ON DELETE RESTRICT,
      sink_version_id TEXT NOT NULL
        REFERENCES analytics_sinks(sink_version_id) ON DELETE RESTRICT,
      state TEXT NOT NULL CHECK(state IN (${sqlList(DELIVERY_STATES)})),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      next_attempt_at_ms INTEGER NOT NULL CHECK(next_attempt_at_ms >= 0),
      lease_until_ms INTEGER CHECK(lease_until_ms IS NULL OR lease_until_ms >= 0),
      send_started_at_ms INTEGER CHECK(send_started_at_ms IS NULL OR send_started_at_ms >= 0),
      last_error_class TEXT CHECK(last_error_class IS NULL OR last_error_class IN (${sqlList(DELIVERY_ERROR_CLASSES)})),
      delivered_at_ms INTEGER CHECK(delivered_at_ms IS NULL OR delivered_at_ms >= 0),
      remote_receipt_hash TEXT,
      payload_schema_version INTEGER NOT NULL CHECK(payload_schema_version = 1),
      PRIMARY KEY(release_id, sink_version_id)
    )
  `)
}

const createDeletionReceiptsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_delivery_deletion_receipts (
      deletion_request_id TEXT NOT NULL
        REFERENCES analytics_deletion_requests(request_id) ON DELETE RESTRICT,
      sink_version_id TEXT NOT NULL
        REFERENCES analytics_sinks(sink_version_id) ON DELETE RESTRICT,
      state TEXT NOT NULL CHECK(state IN ('pending','reconciled','failed')),
      remote_receipt_hash TEXT,
      requested_at_ms INTEGER NOT NULL CHECK(requested_at_ms >= 0),
      reconciled_at_ms INTEGER CHECK(reconciled_at_ms IS NULL OR reconciled_at_ms >= 0),
      PRIMARY KEY(deletion_request_id, sink_version_id)
    )
  `)
}

const up = (db: Database): void => {
  createSinksTable(db)
  createSingleEnabledSinkIndex(db)
  createDeliveriesTable(db)
  createAggregateReleasesTable(db)
  createAggregateDeliveriesTable(db)
  createDeletionReceiptsTable(db)
}

export const migration074AnalyticsDelivery: Migration = {
  id: '074_analytics_delivery',
  up,
}

export default migration074AnalyticsDelivery
