// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { analyticsDeletionRequests } from './analytics-governance-schema.js'
import { analyticsEvents } from './analytics-schema.js'

export const analyticsSinks = sqliteTable(
  'analytics_sinks',
  {
    sinkVersionId: text('sink_version_id').primaryKey(),
    logicalSinkId: text('logical_sink_id').notNull(),
    version: integer('version').notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    payloadSchemaVersion: integer('payload_schema_version').notNull(),
    egressMode: text('egress_mode').notNull(),
    endpointCiphertext: text('endpoint_ciphertext').notNull(),
    secretCiphertext: text('secret_ciphertext').notNull(),
    configFingerprint: text('config_fingerprint').notNull(),
    verifiedAtMs: integer('verified_at_ms'),
    createdAtMs: integer('created_at_ms').notNull(),
    disabledAtMs: integer('disabled_at_ms'),
  },
  (table) => [uniqueIndex('analytics_sinks_logical_version_uniq').on(table.logicalSinkId, table.version)],
)

export const analyticsDeliveries = sqliteTable(
  'analytics_deliveries',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => analyticsEvents.eventId, { onDelete: 'restrict' }),
    sinkVersionId: text('sink_version_id')
      .notNull()
      .references(() => analyticsSinks.sinkVersionId, { onDelete: 'restrict' }),
    grantKey: text('grant_key').notNull(),
    grantKeyVersion: text('grant_key_version').notNull(),
    grantGeneration: integer('grant_generation').notNull(),
    state: text('state').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAtMs: integer('next_attempt_at_ms').notNull(),
    leaseUntilMs: integer('lease_until_ms'),
    sendStartedAtMs: integer('send_started_at_ms'),
    lastErrorClass: text('last_error_class'),
    deliveredAtMs: integer('delivered_at_ms'),
    remoteReceiptHash: text('remote_receipt_hash'),
    deleteRequestedAtMs: integer('delete_requested_at_ms'),
    deletedAtMs: integer('deleted_at_ms'),
    payloadSchemaVersion: integer('payload_schema_version').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.sinkVersionId] }),
    index('idx_analytics_deliveries_ready').on(table.state, table.nextAttemptAtMs),
    index('idx_analytics_deliveries_lease').on(table.state, table.leaseUntilMs),
  ],
)

export const analyticsAggregateReleases = sqliteTable('analytics_aggregate_releases', {
  releaseId: text('release_id').primaryKey(),
  releaseHash: text('release_hash').notNull(),
  payloadJson: text('payload_json').notNull(),
  payloadSchemaVersion: integer('payload_schema_version').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
})

export const analyticsAggregateDeliveries = sqliteTable(
  'analytics_aggregate_deliveries',
  {
    releaseId: text('release_id')
      .notNull()
      .references(() => analyticsAggregateReleases.releaseId, { onDelete: 'restrict' }),
    sinkVersionId: text('sink_version_id')
      .notNull()
      .references(() => analyticsSinks.sinkVersionId, { onDelete: 'restrict' }),
    state: text('state').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAtMs: integer('next_attempt_at_ms').notNull(),
    leaseUntilMs: integer('lease_until_ms'),
    sendStartedAtMs: integer('send_started_at_ms'),
    lastErrorClass: text('last_error_class'),
    deliveredAtMs: integer('delivered_at_ms'),
    remoteReceiptHash: text('remote_receipt_hash'),
    payloadSchemaVersion: integer('payload_schema_version').notNull(),
  },
  (table) => [primaryKey({ columns: [table.releaseId, table.sinkVersionId] })],
)

export const analyticsDeliveryDeletionReceipts = sqliteTable(
  'analytics_delivery_deletion_receipts',
  {
    deletionRequestId: text('deletion_request_id')
      .notNull()
      .references(() => analyticsDeletionRequests.requestId, { onDelete: 'restrict' }),
    sinkVersionId: text('sink_version_id')
      .notNull()
      .references(() => analyticsSinks.sinkVersionId, { onDelete: 'restrict' }),
    state: text('state').notNull(),
    remoteReceiptHash: text('remote_receipt_hash'),
    requestedAtMs: integer('requested_at_ms').notNull(),
    reconciledAtMs: integer('reconciled_at_ms'),
  },
  (table) => [primaryKey({ columns: [table.deletionRequestId, table.sinkVersionId] })],
)

export type AnalyticsSinkRow = typeof analyticsSinks.$inferSelect
export type AnalyticsDeliveryRow = typeof analyticsDeliveries.$inferSelect
export type AnalyticsAggregateReleaseRow = typeof analyticsAggregateReleases.$inferSelect
export type AnalyticsAggregateDeliveryRow = typeof analyticsAggregateDeliveries.$inferSelect
export type AnalyticsDeliveryDeletionReceiptRow = typeof analyticsDeliveryDeletionReceipts.$inferSelect
