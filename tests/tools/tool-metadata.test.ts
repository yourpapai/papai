// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getToolMetadata, isToolDomain, TOOL_METADATA } from '../../src/tools/tool-metadata.js'
import type { ToolClassification } from '../../src/tools/tool-metadata.js'

const getToolRisk = (toolName: string): string | undefined => {
  const metadata = getToolMetadata(toolName)
  if (metadata === undefined) return undefined
  return metadata.risk
}

describe('tool metadata', () => {
  test('tags core tools with domain, operation, and risk', () => {
    expect(getToolMetadata('create_task')).toEqual({
      domain: 'task',
      operation: 'create',
      risk: 'write',
    })
    expect(getToolMetadata('get_task')).toEqual({
      domain: 'task',
      operation: 'read',
      risk: 'read',
    })
  })

  test('tags destructive and open-world tools distinctly', () => {
    expect(getToolRisk('delete_task')).toBe('destructive')
    expect(getToolMetadata('web_fetch')).toEqual({
      domain: 'web',
      operation: 'read',
      risk: 'open-world',
    })
  })

  test('identifies read-only tools', () => {
    expect(getToolRisk('list_tasks')).toBe('read')
    expect(getToolRisk('create_task')).toBe('write')
    expect(getToolRisk('web_fetch')).toBe('open-world')
  })

  test('covers representative high-pollution tool clusters', () => {
    for (const name of [
      'create_reminder',
      'pause_recurring_task',
      'add_comment_reaction',
      'assign_task_to_sprint',
      'run_saved_query',
    ]) {
      expect(TOOL_METADATA[name]).toBeDefined()
    }
  })

  test('includes delete_file with destructive attachment classification', () => {
    expect(getToolMetadata('delete_file')).toEqual({
      domain: 'attachment',
      operation: 'delete',
      risk: 'destructive',
    })
  })

  test('includes list_files, search_staged_files, resolve_staged_file as read attachment', () => {
    for (const name of ['list_files', 'search_staged_files', 'resolve_staged_file']) {
      expect(getToolMetadata(name)).toEqual({
        domain: 'attachment',
        operation: 'read',
        risk: 'read',
      })
    }
  })

  test('classifies memory tools by read/write/destructive risk', () => {
    expect(getToolMetadata('search_memory')).toEqual({
      domain: 'memory',
      operation: 'read',
      risk: 'read',
    })
    expect(getToolMetadata('list_memory')).toEqual({
      domain: 'memory',
      operation: 'read',
      risk: 'read',
    })
    expect(getToolMetadata('remember_memory')).toEqual({
      domain: 'memory',
      operation: 'create',
      risk: 'write',
    })
    expect(getToolMetadata('forget_memory')).toEqual({
      domain: 'memory',
      operation: 'delete',
      risk: 'destructive',
    })
  })
})

// Gap class A: the `isToolDomain` discriminator is never invoked by the suite above, so its
// body has NoCoverage (Stryker mutant 0).
describe('isToolDomain', () => {
  test('narrows exactly to the declared tool domains', () => {
    expect(isToolDomain('task')).toBe(true)
    expect(isToolDomain('memory')).toBe(true)
    expect(isToolDomain('nope')).toBe(false)
    expect(isToolDomain('')).toBe(false)
  })
})

// Gap class B: the per-tool domain/operation literals in the static table are only
// spot-checked above; each can flip to '' undetected. Pin every entry's exact classification.
const EXPECTED_STATIC: Readonly<Record<string, ToolClassification>> = {
  create_task: { domain: 'task', operation: 'create', risk: 'write' },
  update_task: { domain: 'task', operation: 'update', risk: 'write' },
  search_tasks: { domain: 'task', operation: 'read', risk: 'read' },
  list_tasks: { domain: 'task', operation: 'read', risk: 'read' },
  get_task: { domain: 'task', operation: 'read', risk: 'read' },
  count_tasks: { domain: 'task', operation: 'read', risk: 'read' },
  delete_task: { domain: 'task', operation: 'delete', risk: 'destructive' },
  apply_youtrack_command: { domain: 'task', operation: 'update', risk: 'write' },
  get_current_time: { domain: 'time', operation: 'read', risk: 'read' },
  get_project: { domain: 'project', operation: 'read', risk: 'read' },
  list_projects: { domain: 'project', operation: 'read', risk: 'read' },
  create_project: { domain: 'project', operation: 'create', risk: 'write' },
  update_project: { domain: 'project', operation: 'update', risk: 'write' },
  delete_project: { domain: 'project', operation: 'delete', risk: 'destructive' },
  list_project_team: { domain: 'project', operation: 'read', risk: 'read' },
  add_project_member: { domain: 'project', operation: 'update', risk: 'write' },
  remove_project_member: { domain: 'project', operation: 'delete', risk: 'destructive' },
  get_comments: { domain: 'comment', operation: 'read', risk: 'read' },
  add_comment: { domain: 'comment', operation: 'create', risk: 'write' },
  update_comment: { domain: 'comment', operation: 'update', risk: 'write' },
  remove_comment: { domain: 'comment', operation: 'delete', risk: 'destructive' },
  add_comment_reaction: { domain: 'comment', operation: 'create', risk: 'write' },
  remove_comment_reaction: { domain: 'comment', operation: 'delete', risk: 'destructive' },
  list_labels: { domain: 'label', operation: 'read', risk: 'read' },
  create_label: { domain: 'label', operation: 'create', risk: 'write' },
  update_label: { domain: 'label', operation: 'update', risk: 'write' },
  remove_label: { domain: 'label', operation: 'delete', risk: 'destructive' },
  add_task_label: { domain: 'label', operation: 'update', risk: 'write' },
  remove_task_label: { domain: 'label', operation: 'update', risk: 'write' },
  add_task_relation: { domain: 'task', operation: 'create', risk: 'write' },
  update_task_relation: { domain: 'task', operation: 'update', risk: 'write' },
  remove_task_relation: { domain: 'task', operation: 'delete', risk: 'destructive' },
  list_statuses: { domain: 'status', operation: 'read', risk: 'read' },
  create_status: { domain: 'status', operation: 'create', risk: 'write' },
  update_status: { domain: 'status', operation: 'update', risk: 'write' },
  delete_status: { domain: 'status', operation: 'delete', risk: 'destructive' },
  reorder_statuses: { domain: 'status', operation: 'update', risk: 'write' },
  list_attachments: { domain: 'attachment', operation: 'read', risk: 'read' },
  upload_attachment: { domain: 'attachment', operation: 'create', risk: 'write' },
  remove_attachment: { domain: 'attachment', operation: 'delete', risk: 'destructive' },
  list_files: { domain: 'attachment', operation: 'read', risk: 'read' },
  delete_file: { domain: 'attachment', operation: 'delete', risk: 'destructive' },
  search_staged_files: { domain: 'attachment', operation: 'read', risk: 'read' },
  resolve_staged_file: { domain: 'attachment', operation: 'read', risk: 'read' },
  list_work: { domain: 'work', operation: 'read', risk: 'read' },
  log_work: { domain: 'work', operation: 'create', risk: 'write' },
  update_work: { domain: 'work', operation: 'update', risk: 'write' },
  remove_work: { domain: 'work', operation: 'delete', risk: 'destructive' },
  list_agiles: { domain: 'sprint', operation: 'read', risk: 'read' },
  list_sprints: { domain: 'sprint', operation: 'read', risk: 'read' },
  create_sprint: { domain: 'sprint', operation: 'create', risk: 'write' },
  update_sprint: { domain: 'sprint', operation: 'update', risk: 'write' },
  assign_task_to_sprint: { domain: 'sprint', operation: 'update', risk: 'write' },
  get_task_history: { domain: 'history', operation: 'read', risk: 'read' },
  list_saved_queries: { domain: 'query', operation: 'read', risk: 'read' },
  run_saved_query: { domain: 'query', operation: 'read', risk: 'read' },
  find_user: { domain: 'collaboration', operation: 'read', risk: 'read' },
  resolve_chat_participant: { domain: 'collaboration', operation: 'read', risk: 'read' },
  get_current_user: { domain: 'identity', operation: 'read', risk: 'read' },
  list_watchers: { domain: 'collaboration', operation: 'read', risk: 'read' },
  add_watcher: { domain: 'collaboration', operation: 'create', risk: 'write' },
  remove_watcher: { domain: 'collaboration', operation: 'delete', risk: 'destructive' },
  add_vote: { domain: 'collaboration', operation: 'create', risk: 'write' },
  remove_vote: { domain: 'collaboration', operation: 'delete', risk: 'destructive' },
  set_visibility: { domain: 'collaboration', operation: 'update', risk: 'write' },
  set_my_identity: { domain: 'identity', operation: 'update', risk: 'write' },
  clear_my_identity: { domain: 'identity', operation: 'delete', risk: 'destructive' },
  save_memo: { domain: 'memo', operation: 'create', risk: 'write' },
  search_memos: { domain: 'memo', operation: 'read', risk: 'read' },
  list_memos: { domain: 'memo', operation: 'read', risk: 'read' },
  archive_memos: { domain: 'memo', operation: 'update', risk: 'write' },
  promote_memo: { domain: 'memo', operation: 'create', risk: 'write' },
  search_memory: { domain: 'memory', operation: 'read', risk: 'read' },
  list_memory: { domain: 'memory', operation: 'read', risk: 'read' },
  remember_memory: { domain: 'memory', operation: 'create', risk: 'write' },
  forget_memory: { domain: 'memory', operation: 'delete', risk: 'destructive' },
  create_recurring_task: { domain: 'recurring', operation: 'create', risk: 'write' },
  list_recurring_tasks: { domain: 'recurring', operation: 'read', risk: 'read' },
  update_recurring_task: { domain: 'recurring', operation: 'update', risk: 'write' },
  pause_recurring_task: { domain: 'recurring', operation: 'manage', risk: 'write' },
  resume_recurring_task: { domain: 'recurring', operation: 'manage', risk: 'write' },
  skip_recurring_task: { domain: 'recurring', operation: 'manage', risk: 'write' },
  delete_recurring_task: { domain: 'recurring', operation: 'delete', risk: 'destructive' },
  create_reminder: { domain: 'deferred', operation: 'create', risk: 'write' },
  create_alert: { domain: 'deferred', operation: 'create', risk: 'write' },
  list_reminders: { domain: 'deferred', operation: 'read', risk: 'read' },
  get_reminder: { domain: 'deferred', operation: 'read', risk: 'read' },
  update_reminder: { domain: 'deferred', operation: 'update', risk: 'write' },
  cancel_reminder: { domain: 'deferred', operation: 'delete', risk: 'destructive' },
  save_instruction: { domain: 'instruction', operation: 'create', risk: 'write' },
  list_instructions: { domain: 'instruction', operation: 'read', risk: 'read' },
  delete_instruction: { domain: 'instruction', operation: 'delete', risk: 'destructive' },
  lookup_group_history: { domain: 'history', operation: 'read', risk: 'read' },
  search_chat_history: { domain: 'history', operation: 'read', risk: 'read' },
  get_message: { domain: 'history', operation: 'read', risk: 'read' },
  get_message_context: { domain: 'history', operation: 'read', risk: 'read' },
  fetch_chat_link: { domain: 'history', operation: 'read', risk: 'open-world' },
  web_fetch: { domain: 'web', operation: 'read', risk: 'open-world' },
}

describe('static tool classification table', () => {
  test('every TOOL_METADATA entry maps to its exact domain, operation, and risk', () => {
    expect(Object.keys(EXPECTED_STATIC).length).toBe(Object.keys(TOOL_METADATA).length)
    for (const name of Object.keys(TOOL_METADATA)) {
      expect(getToolMetadata(name)).toEqual(EXPECTED_STATIC[name])
    }
  })
})

// Gap class C: the dynamic `mcp_` branch's fixed classification is not pinned exactly.
describe('dynamic prefix classification', () => {
  test('mcp_-prefixed tools classify as the open-world mcp object', () => {
    expect(getToolMetadata('mcp_my-server__do_thing')).toEqual({
      domain: 'mcp',
      operation: 'read',
      risk: 'open-world',
    })
  })

  // Gap class D: nothing asserts the fallback that a name matching no static entry and no
  // dynamic prefix resolves to undefined, so the plugin guard can weaken to always-true.
  test('an unrecognized, non-prefixed name resolves to undefined', () => {
    expect(getToolMetadata('totally_unknown_tool')).toBe(undefined)
  })
})
