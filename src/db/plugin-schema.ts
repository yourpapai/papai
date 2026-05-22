// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const pluginAdminState = sqliteTable('plugin_admin_state', {
  pluginId: text('plugin_id').primaryKey(),
  state: text('state').notNull().default('discovered'),
  approvedBy: text('approved_by'),
  approvedManifestHash: text('approved_manifest_hash'),
  lastSeenManifestHash: text('last_seen_manifest_hash'),
  compatibilityReason: text('compatibility_reason'),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const pluginContextState = sqliteTable(
  'plugin_context_state',
  {
    pluginId: text('plugin_id').notNull(),
    contextId: text('context_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.pluginId, table.contextId] }),
    index('idx_plugin_context_state_context').on(table.contextId),
  ],
)

export const pluginKv = sqliteTable(
  'plugin_kv',
  {
    pluginId: text('plugin_id').notNull(),
    contextId: text('context_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.pluginId, table.contextId, table.key] }),
    index('idx_plugin_kv_plugin_context').on(table.pluginId, table.contextId),
    index('idx_plugin_kv_context').on(table.contextId),
  ],
)

export const pluginRuntimeEvents = sqliteTable(
  'plugin_runtime_events',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    eventType: text('event_type').notNull(),
    message: text('message'),
    occurredAt: text('occurred_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_plugin_runtime_events_plugin').on(table.pluginId),
    index('idx_plugin_runtime_events_occurred').on(table.pluginId, table.occurredAt),
  ],
)

export type PluginAdminStateRow = typeof pluginAdminState.$inferSelect
export type PluginContextStateRow = typeof pluginContextState.$inferSelect
export type PluginKvRow = typeof pluginKv.$inferSelect
export type PluginRuntimeEventRow = typeof pluginRuntimeEvents.$inferSelect
