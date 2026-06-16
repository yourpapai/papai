// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from './scoped-context.js'

export type EffectiveScope = 'thread' | 'group' | 'group+threadOverride' | 'user'

export type EntityScope = Readonly<{
  table: string
  column: string
  scope: EffectiveScope
  rawThreadScoped: boolean
}>

export type ScopeKeyContext = Readonly<{
  storageContextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
}>

export function getScopeKey(scope: EffectiveScope, ctx: ScopeKeyContext): string {
  switch (scope) {
    case 'thread':
      return ctx.storageContextId
    case 'group':
    case 'group+threadOverride':
      return getConfigContextIdFromStorageContextId(ctx.storageContextId)
    case 'user':
      return ctx.chatUserId
    default:
      throw new Error(`Unhandled scope: ${String(scope)}`)
  }
}

/** @public -- declarative source of truth; validated by the context-scope consistency test. */
export const ENTITY_SCOPES: readonly EntityScope[] = [
  { table: 'conversation_history', column: 'user_id', scope: 'thread', rawThreadScoped: true },
  { table: 'memory_summary', column: 'user_id', scope: 'thread', rawThreadScoped: true },
  { table: 'memory_facts', column: 'user_id', scope: 'thread', rawThreadScoped: true },
  { table: 'task_snapshots', column: 'user_id', scope: 'thread', rawThreadScoped: true },
  { table: 'message_metadata', column: 'context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'attachments', column: 'context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'staged_files', column: 'context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'llm_usage_events', column: 'storage_context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'tool_call_events', column: 'storage_context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'scheduled_prompts', column: 'delivery_context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'alert_prompts', column: 'delivery_context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'user_identity_mappings', column: 'context_id', scope: 'user', rawThreadScoped: true },
  { table: 'web_rate_limit', column: 'actor_id', scope: 'user', rawThreadScoped: false },
  { table: 'memos', column: 'user_id', scope: 'group', rawThreadScoped: true },
  { table: 'recurring_tasks', column: 'user_id', scope: 'group', rawThreadScoped: true },
  { table: 'user_instructions', column: 'context_id', scope: 'group+threadOverride', rawThreadScoped: true },
  { table: 'scheduled_prompts', column: 'created_by_user_id', scope: 'group', rawThreadScoped: true },
  { table: 'alert_prompts', column: 'created_by_user_id', scope: 'group', rawThreadScoped: true },
  { table: 'context_settings', column: 'context_id', scope: 'group', rawThreadScoped: false },
  { table: 'user_config', column: 'user_id', scope: 'group', rawThreadScoped: false },
  { table: 'authorized_groups', column: 'group_id', scope: 'group', rawThreadScoped: false },
  { table: 'group_members', column: 'group_id', scope: 'group', rawThreadScoped: false },
  { table: 'known_group_contexts', column: 'context_id', scope: 'group', rawThreadScoped: false },
  { table: 'group_admin_observations', column: 'context_id', scope: 'group', rawThreadScoped: false },
  { table: 'group_user_observations', column: 'context_id', scope: 'group', rawThreadScoped: false },
  { table: 'plugin_context_state', column: 'context_id', scope: 'group', rawThreadScoped: true },
  { table: 'plugin_kv', column: 'context_id', scope: 'group', rawThreadScoped: true },
]
