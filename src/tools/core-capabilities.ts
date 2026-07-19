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
} as const)

export function registerOfferedCoreToolCapabilities(tools: ToolSet, catalog: ToolCapabilityCatalog): void {
  for (const [capabilityId, wireName] of Object.entries(CORE_TOOL_CAPABILITIES)) {
    if (tools[wireName] !== undefined) catalog.register(capabilityId, wireName)
  }
}
