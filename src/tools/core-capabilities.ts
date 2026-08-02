// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import type { ToolCapabilityCatalog } from '../runtime/capability-catalog.js'

export const CORE_TOOL_CAPABILITIES = Object.freeze({
  'tasks.create': 'create_task',
  'tasks.get': 'get_task',
  'tasks.list': 'list_tasks',
  'tasks.search': 'search_tasks',
  'meta.expand-result': 'expand_result',
  'tasks.update': 'update_task',
  'tasks.delete': 'delete_task',
  'tasks.count': 'count_tasks',
  'tasks.history': 'get_task_history',
  'tasks.comments.list': 'get_comments',
  'tasks.comments.create': 'add_comment',
  'tasks.comments.update': 'update_comment',
  'tasks.comments.delete': 'remove_comment',
  'tasks.labels.list': 'list_labels',
  'tasks.labels.create': 'create_label',
  'tasks.labels.update': 'update_label',
  'tasks.labels.delete': 'remove_label',
  'tasks.labels.assign': 'add_task_label',
  'tasks.labels.unassign': 'remove_task_label',
  'tasks.relations.add': 'add_task_relation',
  'tasks.relations.update': 'update_task_relation',
  'tasks.relations.remove': 'remove_task_relation',
  'tasks.statuses.list': 'list_statuses',
  'tasks.statuses.create': 'create_status',
  'tasks.statuses.update': 'update_status',
  'tasks.statuses.delete': 'delete_status',
  'tasks.statuses.reorder': 'reorder_statuses',
  'tasks.projects.get': 'get_project',
  'tasks.projects.list': 'list_projects',
  'tasks.projects.create': 'create_project',
  'tasks.projects.update': 'update_project',
  'tasks.projects.delete': 'delete_project',
  'tasks.projects.team.list': 'list_project_team',
  'tasks.projects.team.add': 'add_project_member',
  'tasks.projects.team.remove': 'remove_project_member',
  'tasks.worklog.list': 'list_work',
  'tasks.worklog.create': 'log_work',
  'tasks.worklog.update': 'update_work',
  'tasks.worklog.delete': 'remove_work',
  'tasks.agiles.list': 'list_agiles',
  'tasks.sprints.list': 'list_sprints',
  'tasks.sprints.create': 'create_sprint',
  'tasks.sprints.update': 'update_sprint',
  'tasks.sprints.assign': 'assign_task_to_sprint',
  'tasks.queries.saved.list': 'list_saved_queries',
  'tasks.queries.saved.run': 'run_saved_query',
  'tasks.watchers.list': 'list_watchers',
  'tasks.watchers.add': 'add_watcher',
  'tasks.watchers.remove': 'remove_watcher',
  'tasks.votes.add': 'add_vote',
  'tasks.votes.remove': 'remove_vote',
  'tasks.visibility.set': 'set_visibility',
  'tasks.identity.find': 'find_user',
  'tasks.identity.current': 'get_current_user',
  'tasks.attachments.list': 'list_attachments',
  'tasks.attachments.upload': 'upload_attachment',
  'tasks.attachments.delete': 'remove_attachment',
  'tasks.commands.apply': 'apply_youtrack_command',
  'memos.save': 'save_memo',
  'memos.search': 'search_memos',
  'memos.list': 'list_memos',
  'memos.archive': 'archive_memos',
  'memos.promote': 'promote_memo',
  'memory.remember': 'remember_memory',
  'memory.search': 'search_memory',
  'memory.forget': 'forget_memory',
  'memory.list': 'list_memory',
  'instructions.save': 'save_instruction',
  'instructions.list': 'list_instructions',
  'instructions.delete': 'delete_instruction',
  'history.lookup': 'lookup_group_history',
  'history.search': 'search_chat_history',
  'history.fetch': 'get_message',
  'history.context': 'get_message_context',
  'recurring.create': 'create_recurring_task',
  'recurring.list': 'list_recurring_tasks',
  'recurring.update': 'update_recurring_task',
  'recurring.pause': 'pause_recurring_task',
  'recurring.resume': 'resume_recurring_task',
  'recurring.skip': 'skip_recurring_task',
  'recurring.delete': 'delete_recurring_task',
  'deferred.create': 'create_reminder',
  'deferred.create_alert': 'create_alert',
  'deferred.list': 'list_reminders',
  'deferred.get': 'get_reminder',
  'deferred.update': 'update_reminder',
  'deferred.cancel': 'cancel_reminder',
  'web.fetch': 'web_fetch',
} as const)

export function registerOfferedCoreToolCapabilities(tools: ToolSet, catalog: ToolCapabilityCatalog): void {
  for (const [capabilityId, wireName] of Object.entries(CORE_TOOL_CAPABILITIES)) {
    if (tools[wireName] !== undefined) catalog.register(capabilityId, wireName)
  }
}

/**
 * Registers MCP-sourced tools (user endpoints, wire prefix `mcp_`) as identity capabilities so
 * the scripted story model can address them by `callCapability(wireName, input)`. MCP wire names
 * are dynamic per configured server, so — unlike the static core map — the id is the wire name
 * itself. Idempotent: the catalog rejects only a duplicate id mapping to a different wire name.
 */
export function registerMcpToolCapabilities(tools: ToolSet, catalog: ToolCapabilityCatalog): void {
  for (const wireName of Object.keys(tools)) {
    if (wireName.startsWith('mcp_')) catalog.register(wireName, wireName)
  }
}
