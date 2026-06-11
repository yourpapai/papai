// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { desc } from 'drizzle-orm'
import { blob, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const memoryProfiles = sqliteTable(
  'memory_profiles',
  {
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    profile: text('profile').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    version: integer('version').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeType, table.scopeId] }),
    index('idx_memory_profiles_scope').on(table.scopeType, table.scopeId),
  ],
)

export const memoryRecords = sqliteTable(
  'memory_records',
  {
    id: text('id').primaryKey(),
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    kind: text('kind', {
      enum: [
        'preference',
        'fact',
        'decision',
        'project_context',
        'person_context',
        'procedure',
        'episode',
        'reference',
      ],
    }).notNull(),
    content: text('content').notNull(),
    summary: text('summary'),
    tags: text('tags').notNull().default('[]'),
    confidence: real('confidence').notNull(),
    status: text('status', { enum: ['active', 'stale', 'archived', 'contradicted'] }).notNull(),
    source: text('source', { enum: ['background', 'explicit', 'tool_result', 'admin_edit'] }).notNull(),
    evidence: text('evidence').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    expiresAt: text('expires_at'),
    embedding: blob('embedding'),
  },
  (table) => [
    index('idx_memory_records_scope_status_seen').on(table.scopeId, table.status, desc(table.lastSeenAt)),
    index('idx_memory_records_scope_kind_status').on(table.scopeId, table.kind, table.status),
  ],
)

export type MemoryProfileRow = typeof memoryProfiles.$inferSelect
export type MemoryRecordRow = typeof memoryRecords.$inferSelect
