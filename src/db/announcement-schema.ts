// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { text, primaryKey, sqliteTable } from 'drizzle-orm/sqlite-core'

export const versionAnnouncements = sqliteTable('version_announcements', {
  version: text('version').primaryKey(),
  announcedAt: text('announced_at').notNull(),
  rawBody: text('raw_body'),
  humanizedBody: text('humanized_body'),
  broadcastAt: text('broadcast_at'),
})

export const announcementDeliveries = sqliteTable(
  'announcement_deliveries',
  {
    version: text('version')
      .notNull()
      .references(() => versionAnnouncements.version),
    contextId: text('context_id').notNull(),
    contextType: text('context_type').notNull(),
    status: text('status').notNull(),
    deliveredAt: text('delivered_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.version, table.contextId] })],
)
