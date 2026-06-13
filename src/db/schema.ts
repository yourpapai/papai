// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'
import { blob, sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { platformInstances } from './instance-schema.js'

export const users = sqliteTable(
  'users',
  {
    platformUserId: text('platform_user_id').notNull(),
    platformInstanceId: text('platform_instance_id')
      .notNull()
      .references(() => platformInstances.id, { onDelete: 'cascade' }),
    username: text('username'),
    addedAt: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    addedBy: text('added_by').notNull(),
    kaneoWorkspaceId: text('kaneo_workspace_id'),
  },
  (table) => [
    primaryKey({ columns: [table.platformInstanceId, table.platformUserId] }),
    index('idx_users_platform_user').on(table.platformInstanceId, table.platformUserId),
    index('idx_users_platform_username').on(table.platformInstanceId, table.username),
    uniqueIndex('idx_users_platform_username_unique')
      .on(table.platformInstanceId, table.username)
      .where(sql`${table.username} IS NOT NULL`),
  ],
)
export const userConfig = sqliteTable(
  'user_config',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.key] }),
    index('idx_user_config_user_id').on(table.userId),
    index('idx_user_config_key').on(table.key),
  ],
)

export { systemConfig } from './system-config-schema.js'
export { llmUsageEvents, type LlmUsageEventRow } from './llm-usage-events-schema.js'
export { toolCallEvents, type ToolCallEventRow } from './tool-call-events-schema.js'
export { byokLlmCredentials, type ByokLlmCredentialRow } from './byok-llm-schema.js'

export const conversationHistory = sqliteTable('conversation_history', {
  userId: text('user_id').primaryKey(),
  messages: text('messages').notNull(),
})
export const memorySummary = sqliteTable('memory_summary', {
  userId: text('user_id').primaryKey(),
  summary: text('summary').notNull(),
  updatedAt: text('updated_at').notNull(),
})
export const memoryFacts = sqliteTable(
  'memory_facts',
  {
    userId: text('user_id').notNull(),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull().default(''),
    lastSeen: text('last_seen').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.identifier] }),
    index('idx_memory_facts_user_lastseen').on(table.userId, table.lastSeen),
  ],
)
export {
  memoryProfiles,
  memoryRecords,
  type MemoryProfileRow,
  type MemoryRecordRow,
} from './long-term-memory-schema.js'
export const versionAnnouncements = sqliteTable('version_announcements', {
  version: text('version').primaryKey(),
  announcedAt: text('announced_at').notNull(),
})
export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: text('group_id').notNull(),
    userId: text('user_id').notNull(),
    addedBy: text('added_by').notNull(),
    addedAt: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('idx_group_members_group').on(table.groupId),
    index('idx_group_members_user').on(table.userId),
  ],
)
export const authorizedGroups = sqliteTable(
  'authorized_groups',
  {
    groupId: text('group_id').primaryKey(),
    addedBy: text('added_by').notNull(),
    addedAt: text('added_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_authorized_groups_added_by').on(table.addedBy)],
)
export const recurringTasks = sqliteTable(
  'recurring_tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    projectId: text('project_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    priority: text('priority'),
    status: text('status'),
    assignee: text('assignee'),
    labels: text('labels'),
    triggerType: text('trigger_type').notNull().default('cron'),
    rrule: text('rrule'),
    dtstartUtc: text('dtstart_utc'),
    timezone: text('timezone').notNull().default('UTC'),
    enabled: text('enabled').notNull().default('1'),
    catchUp: text('catch_up').notNull().default('0'),
    lastRun: text('last_run'),
    nextRun: text('next_run'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_recurring_tasks_user').on(table.userId),
    index('idx_recurring_tasks_enabled_next').on(table.enabled, table.nextRun),
  ],
)
export const recurringTaskOccurrences = sqliteTable(
  'recurring_task_occurrences',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => recurringTasks.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_recurring_occurrences_template').on(table.templateId),
    index('idx_recurring_occurrences_task').on(table.taskId),
  ],
)
export type RecurringTask = typeof recurringTasks.$inferSelect
export type RecurringTaskOccurrence = typeof recurringTaskOccurrences.$inferSelect
export { scheduledPrompts, alertPrompts, taskSnapshots } from './deferred-schema.js'
export type { ScheduledPromptRow, AlertPromptRow } from './deferred-schema.js'
export { userInstructions, type UserInstruction } from './user-instructions-schema.js'
export type GroupMember = typeof groupMembers.$inferSelect
export type AuthorizedGroup = typeof authorizedGroups.$inferSelect
export const messageMetadata = sqliteTable(
  'message_metadata',
  {
    contextId: text('context_id').notNull(),
    messageId: text('message_id').notNull(),
    authorId: text('author_id'),
    authorUsername: text('author_username'),
    text: text('text'),
    replyToMessageId: text('reply_to_message_id'),
    timestamp: integer('timestamp').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.contextId, table.messageId] }),
    index('idx_message_metadata_expires_at').on(table.expiresAt),
    index('idx_message_metadata_reply_to').on(table.contextId, table.replyToMessageId),
  ],
)

export const memos = sqliteTable(
  'memos',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    content: text('content').notNull(),
    summary: text('summary'),
    tags: text('tags').notNull().default('[]'),
    embedding: blob('embedding'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_memos_user_status_created').on(table.userId, table.status, table.createdAt)],
)

export const memoLinks = sqliteTable(
  'memo_links',
  {
    id: text('id').primaryKey(),
    sourceMemoId: text('source_memo_id').notNull(),
    targetMemoId: text('target_memo_id'),
    targetTaskId: text('target_task_id'),
    relationType: text('relation_type').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_memo_links_source').on(table.sourceMemoId),
    index('idx_memo_links_target_memo').on(table.targetMemoId),
  ],
)
export const userIdentityMappings = sqliteTable(
  'user_identity_mappings',
  {
    contextId: text('context_id').notNull(),
    providerName: text('provider_name').notNull(),
    providerUserId: text('provider_user_id'),
    providerUserLogin: text('provider_user_login'),
    displayName: text('display_name'),
    matchedAt: text('matched_at').notNull(),
    matchMethod: text('match_method'),
    confidence: integer('confidence'),
  },
  (table) => [
    primaryKey({ columns: [table.contextId, table.providerName] }),
    index('idx_identity_mappings_provider_user').on(table.providerName, table.providerUserId),
  ],
)
export const knownGroupContexts = sqliteTable(
  'known_group_contexts',
  {
    provider: text('provider').notNull(),
    contextId: text('context_id').notNull(),
    displayName: text('display_name').notNull(),
    parentName: text('parent_name'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.contextId] }),
    index('idx_known_group_contexts_provider').on(table.provider),
  ],
)
export const groupAdminObservations = sqliteTable(
  'group_admin_observations',
  {
    provider: text('provider').notNull(),
    contextId: text('context_id').notNull(),
    userId: text('user_id').notNull(),
    username: text('username'),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.contextId, table.userId] }),
    index('idx_group_admin_observations_user_admin').on(table.provider, table.userId, table.isAdmin),
  ],
)
export const groupUserObservations = sqliteTable(
  'group_user_observations',
  {
    provider: text('provider').notNull(),
    contextId: text('context_id').notNull(),
    userId: text('user_id').notNull(),
    username: text('username'),
    displayLabel: text('display_label').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.contextId, table.userId] }),
    index('idx_group_user_observations_provider_user').on(table.provider, table.userId),
  ],
)
export { webCache, webRateLimit } from './web-schema.js'
export { attachments } from './attachments-schema.js'
export { stagedFiles, type StagedFileRow } from './staged-schema.js'
export { pluginAdminState, pluginContextState, pluginKv, pluginRuntimeEvents } from './plugin-schema.js'
export { contextSettings, platformAdmins, platformInstances, superAdmins, taskInstances } from './instance-schema.js'
export {
  settingsAuthCodes,
  settingsRateLimit,
  settingsSessions,
  type SettingsAuthCodeRow,
  type SettingsRateLimitRow,
  type SettingsSessionRow,
} from './settings-auth-schema.js'
