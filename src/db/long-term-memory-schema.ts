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
    injectRecords: integer('inject_records', { mode: 'boolean' }).notNull().default(false),
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
    status: text('status', { enum: ['active', 'stale', 'archived', 'contradicted', 'provisional'] }).notNull(),
    threadContextId: text('thread_context_id'),
    source: text('source', { enum: ['background', 'explicit', 'tool_result', 'admin_edit'] }).notNull(),
    evidence: text('evidence').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    expiresAt: text('expires_at'),
    embedding: blob('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingDimension: integer('embedding_dimension'),
    embeddingVersion: text('embedding_version'),
    embeddedAt: text('embedded_at'),
  },
  (table) => [
    index('idx_memory_records_scope_status_seen').on(table.scopeId, table.status, desc(table.lastSeenAt)),
    index('idx_memory_records_scope_kind_status').on(table.scopeId, table.kind, table.status),
  ],
)

export const memoryTombstones = sqliteTable(
  'memory_tombstones',
  {
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    contentHash: text('content_hash').notNull(),
    forgottenAt: text('forgotten_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeType, table.scopeId, table.contentHash] }),
    index('idx_memory_tombstones_scope').on(table.scopeType, table.scopeId),
  ],
)

export const memoryRecallShadowLog = sqliteTable(
  'memory_recall_shadow_log',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    scopeHash: text('scope_hash').notNull(),
    contextHash: text('context_hash').notNull(),
    turnRef: text('turn_ref').notNull(),
    readerModelId: text('reader_model_id').notNull(),
    activeRecordCount: integer('active_record_count').notNull(),
    shadowQueryHash: text('shadow_query_hash').notNull(),
    shadowQueryLenBucket: text('shadow_query_len_bucket', { enum: ['short', 'medium', 'long'] }).notNull(),
    shadowHitCount: integer('shadow_hit_count').notNull(),
    shadowTopScore: real('shadow_top_score'),
    shadowTopProvenance: text('shadow_top_provenance', { enum: ['current', 'group', 'other-thread'] }),
    shadowTopRecordHash: text('shadow_top_record_hash'),
    modelPulled: integer('model_pulled', { mode: 'boolean' }).notNull(),
    pullCount: integer('pull_count').notNull(),
    pullQueryHash: text('pull_query_hash'),
    pullResultCount: integer('pull_result_count').notNull(),
    shadowPullOverlap: integer('shadow_pull_overlap').notNull(),
    skippedReason: text('skipped_reason', { enum: ['no-active-records'] }),
  },
  (table) => [index('idx_memory_recall_shadow_log_reader_model_created').on(table.readerModelId, table.createdAt)],
)

export type MemoryProfileRow = typeof memoryProfiles.$inferSelect
export type MemoryRecordRow = typeof memoryRecords.$inferSelect
export type MemoryTombstoneRow = typeof memoryTombstones.$inferSelect
export type MemoryRecallShadowLogRow = typeof memoryRecallShadowLog.$inferSelect

export const memoryExtractionState = sqliteTable('memory_extraction_state', {
  contextId: text('context_id').primaryKey(),
  contextType: text('context_type', { enum: ['dm', 'group'] }).notNull(),
  configContextId: text('config_context_id').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
  lastExtractedAt: text('last_extracted_at'),
  lastHistoryLen: integer('last_history_len').notNull().default(0),
})

export type MemoryExtractionStateRow = typeof memoryExtractionState.$inferSelect
