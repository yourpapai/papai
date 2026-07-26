// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import {
  CORE_TOOL_CAPABILITIES,
  registerMcpToolCapabilities,
  registerOfferedCoreToolCapabilities,
} from '../../src/tools/core-capabilities.js'
import { applyToolPreferences } from '../../src/tools/index.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const offered = (...names: readonly string[]): ToolSet =>
  Object.fromEntries(
    names.map((name) => [name, tool({ description: name, inputSchema: z.object({}), execute: () => undefined })]),
  )

describe('core tool capabilities', () => {
  test('publishes an immutable stable mapping', () => {
    expect(Object.isFrozen(CORE_TOOL_CAPABILITIES)).toBe(true)
  })

  test('registers the F3 builtin capability ids', () => {
    expect(CORE_TOOL_CAPABILITIES['memos.save']).toBe('save_memo')
    expect(CORE_TOOL_CAPABILITIES['memos.search']).toBe('search_memos')
    expect(CORE_TOOL_CAPABILITIES['memos.list']).toBe('list_memos')
    expect(CORE_TOOL_CAPABILITIES['memos.archive']).toBe('archive_memos')
    expect(CORE_TOOL_CAPABILITIES['memos.promote']).toBe('promote_memo')
    expect(CORE_TOOL_CAPABILITIES['memory.remember']).toBe('remember_memory')
    expect(CORE_TOOL_CAPABILITIES['memory.search']).toBe('search_memory')
    expect(CORE_TOOL_CAPABILITIES['memory.forget']).toBe('forget_memory')
    expect(CORE_TOOL_CAPABILITIES['memory.list']).toBe('list_memory')
    expect(CORE_TOOL_CAPABILITIES['instructions.save']).toBe('save_instruction')
    expect(CORE_TOOL_CAPABILITIES['instructions.list']).toBe('list_instructions')
    expect(CORE_TOOL_CAPABILITIES['instructions.delete']).toBe('delete_instruction')
    expect(CORE_TOOL_CAPABILITIES['history.lookup']).toBe('lookup_group_history')
    expect(CORE_TOOL_CAPABILITIES['history.search']).toBe('search_chat_history')
    expect(CORE_TOOL_CAPABILITIES['history.fetch']).toBe('get_message')
    expect(CORE_TOOL_CAPABILITIES['history.context']).toBe('get_message_context')
  })

  test('registers the stable core capabilities when their real wire tools are offered', () => {
    const catalog = createToolCapabilityCatalog()

    registerOfferedCoreToolCapabilities(offered(...Object.values(CORE_TOOL_CAPABILITIES)), catalog)

    expect(catalog.entries()).toEqual([
      ['tasks.create', 'create_task'],
      ['tasks.get', 'get_task'],
      ['tasks.list', 'list_tasks'],
      ['tasks.search', 'search_tasks'],
      ['meta.expand-result', 'expand_result'],
      ['tasks.update', 'update_task'],
      ['tasks.delete', 'delete_task'],
      ['tasks.count', 'count_tasks'],
      ['tasks.history', 'get_task_history'],
      ['tasks.comments.list', 'get_comments'],
      ['tasks.comments.create', 'add_comment'],
      ['tasks.comments.update', 'update_comment'],
      ['tasks.comments.delete', 'remove_comment'],
      ['tasks.labels.list', 'list_labels'],
      ['tasks.labels.create', 'create_label'],
      ['tasks.labels.update', 'update_label'],
      ['tasks.labels.delete', 'remove_label'],
      ['tasks.labels.assign', 'add_task_label'],
      ['tasks.labels.unassign', 'remove_task_label'],
      ['tasks.relations.add', 'add_task_relation'],
      ['tasks.relations.update', 'update_task_relation'],
      ['tasks.relations.remove', 'remove_task_relation'],
      ['tasks.statuses.list', 'list_statuses'],
      ['tasks.statuses.create', 'create_status'],
      ['tasks.statuses.update', 'update_status'],
      ['tasks.statuses.delete', 'delete_status'],
      ['tasks.statuses.reorder', 'reorder_statuses'],
      ['tasks.projects.get', 'get_project'],
      ['tasks.projects.list', 'list_projects'],
      ['tasks.projects.create', 'create_project'],
      ['tasks.projects.update', 'update_project'],
      ['tasks.projects.delete', 'delete_project'],
      ['tasks.projects.team.list', 'list_project_team'],
      ['tasks.projects.team.add', 'add_project_member'],
      ['tasks.projects.team.remove', 'remove_project_member'],
      ['tasks.worklog.list', 'list_work'],
      ['tasks.worklog.create', 'log_work'],
      ['tasks.worklog.update', 'update_work'],
      ['tasks.worklog.delete', 'remove_work'],
      ['tasks.agiles.list', 'list_agiles'],
      ['tasks.sprints.list', 'list_sprints'],
      ['tasks.sprints.create', 'create_sprint'],
      ['tasks.sprints.update', 'update_sprint'],
      ['tasks.sprints.assign', 'assign_task_to_sprint'],
      ['tasks.queries.saved.list', 'list_saved_queries'],
      ['tasks.queries.saved.run', 'run_saved_query'],
      ['tasks.watchers.list', 'list_watchers'],
      ['tasks.watchers.add', 'add_watcher'],
      ['tasks.watchers.remove', 'remove_watcher'],
      ['tasks.votes.add', 'add_vote'],
      ['tasks.votes.remove', 'remove_vote'],
      ['tasks.visibility.set', 'set_visibility'],
      ['tasks.identity.find', 'find_user'],
      ['tasks.identity.current', 'get_current_user'],
      ['tasks.attachments.list', 'list_attachments'],
      ['tasks.attachments.upload', 'upload_attachment'],
      ['tasks.attachments.delete', 'remove_attachment'],
      ['tasks.commands.apply', 'apply_youtrack_command'],
      ['memos.save', 'save_memo'],
      ['memos.search', 'search_memos'],
      ['memos.list', 'list_memos'],
      ['memos.archive', 'archive_memos'],
      ['memos.promote', 'promote_memo'],
      ['memory.remember', 'remember_memory'],
      ['memory.search', 'search_memory'],
      ['memory.forget', 'forget_memory'],
      ['memory.list', 'list_memory'],
      ['instructions.save', 'save_instruction'],
      ['instructions.list', 'list_instructions'],
      ['instructions.delete', 'delete_instruction'],
      ['history.lookup', 'lookup_group_history'],
      ['history.search', 'search_chat_history'],
      ['history.fetch', 'get_message'],
      ['history.context', 'get_message_context'],
      ['recurring.create', 'create_recurring_task'],
      ['recurring.list', 'list_recurring_tasks'],
      ['recurring.update', 'update_recurring_task'],
      ['recurring.pause', 'pause_recurring_task'],
      ['recurring.resume', 'resume_recurring_task'],
      ['recurring.skip', 'skip_recurring_task'],
      ['recurring.delete', 'delete_recurring_task'],
      ['deferred.create', 'create_deferred_prompt'],
      ['deferred.list', 'list_deferred_prompts'],
      ['deferred.get', 'get_deferred_prompt'],
      ['deferred.update', 'update_deferred_prompt'],
      ['deferred.cancel', 'cancel_deferred_prompt'],
      ['web.fetch', 'web_fetch'],
    ])
  })

  test('does not register a capability whose tool is absent from the offered turn surface', () => {
    const catalog = createToolCapabilityCatalog()

    registerOfferedCoreToolCapabilities(offered('get_task', 'list_tasks', 'search_tasks'), catalog)

    expect(() => catalog.resolve('tasks.create')).toThrow("Unknown tool capability id 'tasks.create'")
  })

  test('does not advertise a denied tool even when an earlier catalog knows its stable mapping', async () => {
    mockLogger()
    await setupTestDb()
    const catalog = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities(offered('create_task'), catalog)
    setToolPrefs('ctx-denied-core', {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { create_task: 'deny' },
    })

    const nextTurnTools = applyToolPreferences(offered('create_task', 'get_task'), 'ctx-denied-core', undefined)

    expect(Object.hasOwn(nextTurnTools, catalog.resolve('tasks.create'))).toBe(false)
  })

  test('maps and conditionally registers the web.fetch capability', () => {
    expect(CORE_TOOL_CAPABILITIES['web.fetch']).toBe('web_fetch')

    const catalog = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities(offered('web_fetch'), catalog)
    expect(catalog.resolve('web.fetch')).toBe('web_fetch')

    const absent = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities(offered('get_task'), absent)
    expect(() => absent.resolve('web.fetch')).toThrow("Unknown tool capability id 'web.fetch'")
  })

  test('derives every turn independently without carrying stale wire names', () => {
    const first = createToolCapabilityCatalog()
    const second = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities(offered('create_task'), first)
    registerOfferedCoreToolCapabilities(offered('get_task'), second)

    expect(first.resolve('tasks.create')).toBe('create_task')
    expect(() => second.resolve('tasks.create')).toThrow("Unknown tool capability id 'tasks.create'")
    expect(second.resolve('tasks.get')).toBe('get_task')
  })
})

describe('registerMcpToolCapabilities', () => {
  test('registers mcp_-prefixed wire names as identity capabilities', () => {
    const catalog = createToolCapabilityCatalog()
    registerMcpToolCapabilities(offered('mcp_fake__echo', 'create_task'), catalog)
    expect(catalog.resolve('mcp_fake__echo')).toBe('mcp_fake__echo')
  })

  test('does not register non-mcp tools', () => {
    const catalog = createToolCapabilityCatalog()
    registerMcpToolCapabilities(offered('create_task'), catalog)
    expect(() => catalog.resolve('create_task')).toThrow("Unknown tool capability id 'create_task'")
  })

  test('is idempotent across repeated registration', () => {
    const catalog = createToolCapabilityCatalog()
    const tools = offered('mcp_fake__echo')
    registerMcpToolCapabilities(tools, catalog)
    expect(() => registerMcpToolCapabilities(tools, catalog)).not.toThrow()
    expect(catalog.resolve('mcp_fake__echo')).toBe('mcp_fake__echo')
  })
})
