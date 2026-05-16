// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'

export const webCache = sqliteTable(
  'web_cache',
  {
    urlHash: text('url_hash').primaryKey(),
    url: text('url').notNull(),
    finalUrl: text('final_url').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    excerpt: text('excerpt').notNull(),
    truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
    contentType: text('content_type').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('idx_web_cache_expires').on(table.expiresAt)],
)

export const webRateLimit = sqliteTable(
  'web_rate_limit',
  {
    actorId: text('actor_id').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.windowStart] })],
)
