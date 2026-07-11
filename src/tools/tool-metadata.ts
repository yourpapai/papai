// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const TOOL_DOMAINS = [
  'task',
  'project',
  'comment',
  'label',
  'status',
  'attachment',
  'work',
  'sprint',
  'query',
  'collaboration',
  'memo',
  'recurring',
  'deferred',
  'instruction',
  'history',
  'web',
  'identity',
  'time',
  'mcp',
  'plugin',
  'memory',
] as const

export type ToolDomain = (typeof TOOL_DOMAINS)[number]

const TOOL_DOMAIN_SET: ReadonlySet<string> = new Set(TOOL_DOMAINS)
export function isToolDomain(value: string): value is ToolDomain {
  return TOOL_DOMAIN_SET.has(value)
}

export type ToolOperation = 'read' | 'create' | 'update' | 'delete' | 'manage'

export type ToolRisk = 'read' | 'write' | 'destructive' | 'open-world'

export type ToolClassification = {
  domain: ToolDomain
  operation: ToolOperation
  risk: ToolRisk
}

const read = (domain: ToolDomain): ToolClassification => ({
  domain,
  operation: 'read',
  risk: 'read',
})
const write = (domain: ToolDomain, operation: Exclude<ToolOperation, 'read'>): ToolClassification => ({
  domain,
  operation,
  risk: 'write',
})
const destructive = (domain: ToolDomain): ToolClassification => ({
  domain,
  operation: 'delete',
  risk: 'destructive',
})

export const TOOL_METADATA: Readonly<Record<string, ToolClassification>> = {
  create_task: write('task', 'create'),
  update_task: write('task', 'update'),
  search_tasks: read('task'),
  list_tasks: read('task'),
  get_task: read('task'),
  count_tasks: read('task'),
  delete_task: destructive('task'),

  get_current_time: read('time'),

  get_project: read('project'),
  list_projects: read('project'),
  create_project: write('project', 'create'),
  update_project: write('project', 'update'),
  delete_project: destructive('project'),
  list_project_team: read('project'),
  add_project_member: write('project', 'update'),
  remove_project_member: destructive('project'),

  get_comments: read('comment'),
  add_comment: write('comment', 'create'),
  update_comment: write('comment', 'update'),
  remove_comment: destructive('comment'),
  add_comment_reaction: write('comment', 'create'),
  remove_comment_reaction: destructive('comment'),

  list_labels: read('label'),
  create_label: write('label', 'create'),
  update_label: write('label', 'update'),
  remove_label: destructive('label'),
  add_task_label: write('label', 'update'),
  remove_task_label: write('label', 'update'),

  add_task_relation: write('task', 'create'),
  update_task_relation: write('task', 'update'),
  remove_task_relation: destructive('task'),

  list_statuses: read('status'),
  create_status: write('status', 'create'),
  update_status: write('status', 'update'),
  delete_status: destructive('status'),
  reorder_statuses: write('status', 'update'),

  list_attachments: read('attachment'),
  upload_attachment: write('attachment', 'create'),
  remove_attachment: destructive('attachment'),
  list_files: read('attachment'),
  delete_file: destructive('attachment'),
  search_staged_files: read('attachment'),
  resolve_staged_file: read('attachment'),

  list_work: read('work'),
  log_work: write('work', 'create'),
  update_work: write('work', 'update'),
  remove_work: destructive('work'),

  list_agiles: read('sprint'),
  list_sprints: read('sprint'),
  create_sprint: write('sprint', 'create'),
  update_sprint: write('sprint', 'update'),
  assign_task_to_sprint: write('sprint', 'update'),

  get_task_history: read('history'),
  list_saved_queries: read('query'),
  run_saved_query: read('query'),

  find_user: read('collaboration'),
  resolve_chat_participant: read('collaboration'),
  get_current_user: read('identity'),
  list_watchers: read('collaboration'),
  add_watcher: write('collaboration', 'create'),
  remove_watcher: destructive('collaboration'),
  add_vote: write('collaboration', 'create'),
  remove_vote: destructive('collaboration'),
  set_visibility: write('collaboration', 'update'),
  set_my_identity: write('identity', 'update'),
  clear_my_identity: destructive('identity'),

  save_memo: write('memo', 'create'),
  search_memos: read('memo'),
  list_memos: read('memo'),
  archive_memos: write('memo', 'update'),
  promote_memo: write('memo', 'create'),

  search_memory: read('memory'),
  list_memory: read('memory'),
  remember_memory: write('memory', 'create'),
  forget_memory: destructive('memory'),

  create_recurring_task: write('recurring', 'create'),
  list_recurring_tasks: read('recurring'),
  update_recurring_task: write('recurring', 'update'),
  pause_recurring_task: write('recurring', 'manage'),
  resume_recurring_task: write('recurring', 'manage'),
  skip_recurring_task: write('recurring', 'manage'),
  delete_recurring_task: destructive('recurring'),

  create_deferred_prompt: write('deferred', 'create'),
  list_deferred_prompts: read('deferred'),
  get_deferred_prompt: read('deferred'),
  update_deferred_prompt: write('deferred', 'update'),
  cancel_deferred_prompt: destructive('deferred'),

  save_instruction: write('instruction', 'create'),
  list_instructions: read('instruction'),
  delete_instruction: destructive('instruction'),

  lookup_group_history: read('history'),
  fetch_chat_link: { domain: 'history', operation: 'read', risk: 'open-world' },
  web_fetch: { domain: 'web', operation: 'read', risk: 'open-world' },
}

export function getToolMetadata(toolName: string): ToolClassification | undefined {
  const staticMeta = TOOL_METADATA[toolName]
  if (staticMeta !== undefined) return staticMeta

  // MCP tools: mcp_<server-id>__<tool_name>
  if (toolName.startsWith('mcp_')) {
    return { domain: 'mcp', operation: 'read', risk: 'open-world' }
  }

  // Plugin tools: plugin_<plugin-id>__<tool_name>
  if (toolName.startsWith('plugin_')) {
    return { domain: 'plugin', operation: 'read', risk: 'open-world' }
  }

  // Module tools: module_<module-id>__<tool_name> (trusted modules, reuse the plugin domain)
  if (toolName.startsWith('module_')) {
    return { domain: 'plugin', operation: 'read', risk: 'open-world' }
  }

  return undefined
}
