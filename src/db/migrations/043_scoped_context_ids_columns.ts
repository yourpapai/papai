// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ContextOwnedColumn = Readonly<{
  table: string
  column: string
  conflictColumns: readonly string[] | null
  threadScoped: boolean
}>

export const CONTEXT_OWNED_COLUMNS: readonly ContextOwnedColumn[] = [
  { table: 'context_settings', column: 'context_id', conflictColumns: [], threadScoped: false },
  { table: 'user_config', column: 'user_id', conflictColumns: ['key'], threadScoped: false },
  { table: 'conversation_history', column: 'user_id', conflictColumns: [], threadScoped: true },
  { table: 'memory_summary', column: 'user_id', conflictColumns: [], threadScoped: true },
  { table: 'memory_facts', column: 'user_id', conflictColumns: ['identifier'], threadScoped: true },
  { table: 'authorized_groups', column: 'group_id', conflictColumns: [], threadScoped: false },
  { table: 'group_members', column: 'group_id', conflictColumns: ['user_id'], threadScoped: false },
  { table: 'recurring_tasks', column: 'user_id', conflictColumns: null, threadScoped: true },
  { table: 'scheduled_prompts', column: 'created_by_user_id', conflictColumns: null, threadScoped: true },
  { table: 'scheduled_prompts', column: 'delivery_context_id', conflictColumns: null, threadScoped: true },
  { table: 'alert_prompts', column: 'created_by_user_id', conflictColumns: null, threadScoped: true },
  { table: 'alert_prompts', column: 'delivery_context_id', conflictColumns: null, threadScoped: true },
  { table: 'task_snapshots', column: 'user_id', conflictColumns: ['task_id', 'field'], threadScoped: true },
  { table: 'message_metadata', column: 'context_id', conflictColumns: ['message_id'], threadScoped: true },
  { table: 'user_instructions', column: 'context_id', conflictColumns: null, threadScoped: true },
  { table: 'memos', column: 'user_id', conflictColumns: null, threadScoped: true },
  { table: 'user_identity_mappings', column: 'context_id', conflictColumns: ['provider_name'], threadScoped: true },
  { table: 'known_group_contexts', column: 'context_id', conflictColumns: ['provider'], threadScoped: false },
  {
    table: 'group_admin_observations',
    column: 'context_id',
    conflictColumns: ['provider', 'user_id'],
    threadScoped: false,
  },
  {
    table: 'group_user_observations',
    column: 'context_id',
    conflictColumns: ['provider', 'user_id'],
    threadScoped: false,
  },
  { table: 'attachments', column: 'context_id', conflictColumns: null, threadScoped: true },
  { table: 'staged_files', column: 'context_id', conflictColumns: ['platform_file_id'], threadScoped: true },
  { table: 'llm_usage_events', column: 'storage_context_id', conflictColumns: null, threadScoped: true },
  { table: 'tool_call_events', column: 'storage_context_id', conflictColumns: null, threadScoped: true },
  { table: 'plugin_context_state', column: 'context_id', conflictColumns: ['plugin_id'], threadScoped: true },
  { table: 'plugin_kv', column: 'context_id', conflictColumns: ['plugin_id', 'key'], threadScoped: true },
  { table: 'web_rate_limit', column: 'actor_id', conflictColumns: ['window_start'], threadScoped: true },
]
