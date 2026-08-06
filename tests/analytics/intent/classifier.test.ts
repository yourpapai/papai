// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  classifyHybrid,
  classifyMetadata,
  classifyToolTrace,
  toClassifierToolSlug,
  type IntentClassifierInput,
} from '../../../src/analytics/intent/classifier.js'
import type { CoreIntent } from '../../../src/analytics/intent/taxonomy.js'

const inputOf = (partial: Partial<IntentClassifierInput>): IntentClassifierInput => ({
  tool_trace: [],
  feature_events: [],
  command_family: 'none',
  ...partial,
})

describe('deterministic A+B classifiers', () => {
  test('tool trace maps an unambiguous registered tool to its intent', () => {
    const prediction = classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'create_task' }] }))
    expect(prediction.primary).toBe('task.create')
    expect(prediction.goals).toEqual(['task.create'])
    expect(prediction.abstained).toBe(false)
    expect(prediction.confidence).toBe(0.99)
  })

  test('meta-tool-only traces abstain without conflict', () => {
    const prediction = classifyToolTrace(
      inputOf({
        tool_trace: [{ tool_slug: 'search_tools' }, { tool_slug: 'load_tool' }, { tool_slug: 'expand_result' }],
      }),
    )
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(true)
    expect(prediction.tool_evidence_conflict).toBe(false)
  })

  test('an unmapped goal tool with no mapped evidence abstains without conflict', () => {
    const prediction = classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'external_other' }] }))
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(true)
    expect(prediction.tool_evidence_conflict).toBe(false)
  })

  test('an unmapped goal tool alongside mapped evidence abstains with conflict', () => {
    const prediction = classifyToolTrace(
      inputOf({ tool_trace: [{ tool_slug: 'create_task' }, { tool_slug: 'apply_youtrack_command' }] }),
    )
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(true)
    expect(prediction.tool_evidence_conflict).toBe(true)
  })

  test('more than three goals fails closed to unknown', () => {
    const prediction = classifyToolTrace(
      inputOf({
        tool_trace: [
          { tool_slug: 'create_task' },
          { tool_slug: 'find_tasks' },
          { tool_slug: 'get_task' },
          { tool_slug: 'delete_task' },
        ],
      }),
    )
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(true)
  })

  test('two or three goals become a taxonomy-ordered multi_goal', () => {
    const two = classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'find_tasks' }, { tool_slug: 'create_task' }] }))
    expect(two.primary).toBe('multi_goal')
    expect(two.goals).toEqual(['task.create', 'task.find_list'])
    const three = classifyToolTrace(
      inputOf({
        tool_trace: [{ tool_slug: 'delete_task' }, { tool_slug: 'find_tasks' }, { tool_slug: 'create_task' }],
      }),
    )
    expect(three.primary).toBe('multi_goal')
    expect(three.goals).toEqual(['task.create', 'task.find_list', 'task.delete'])
  })

  test('no evidence abstains everywhere', () => {
    const tool = classifyToolTrace(inputOf({}))
    const metadata = classifyMetadata(inputOf({}))
    const hybrid = classifyHybrid(inputOf({}))
    expect(tool.abstained).toBe(true)
    expect(metadata.abstained).toBe(true)
    expect(hybrid.abstained).toBe(true)
    expect(hybrid.primary).toBe('unknown')
  })

  test('stop command family yields a deterministic no_action', () => {
    const prediction = classifyMetadata(inputOf({ command_family: 'stop' }))
    expect(prediction.primary).toBe('no_action')
    expect(prediction.goals).toEqual(['no_action'])
    expect(prediction.abstained).toBe(false)
    expect(prediction.confidence).toBe(0.99)
  })

  test('help and config command families map to their intents', () => {
    expect(classifyMetadata(inputOf({ command_family: 'help' })).primary).toBe('help_context')
    expect(classifyMetadata(inputOf({ command_family: 'config' })).primary).toBe('configuration_permissions')
  })

  test('the unsupported-goal signal yields a non-abstained unknown', () => {
    const prediction = classifyMetadata(inputOf({ feature_events: ['turn:unsupported_goal'] }))
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(false)
    expect(prediction.confidence).toBe(0.95)
  })

  test('structured feature signals map to their intents', () => {
    const prediction = classifyMetadata(inputOf({ feature_events: ['provider:task:create'] }))
    expect(prediction.primary).toBe('task.create')
    expect(prediction.abstained).toBe(false)
  })

  test('hybrid accepts decisive tool evidence before metadata', () => {
    const prediction = classifyHybrid(inputOf({ tool_trace: [{ tool_slug: 'create_task' }], command_family: 'help' }))
    expect(prediction.strategy).toBe('hybrid_v1')
    expect(prediction.primary).toBe('task.create')
  })

  test('hybrid falls back to metadata after tool abstention and ORs conflict flags', () => {
    const fallback = classifyHybrid(inputOf({ command_family: 'stop' }))
    expect(fallback.strategy).toBe('hybrid_v1')
    expect(fallback.primary).toBe('no_action')
    const conflicted = classifyHybrid(inputOf({ tool_trace: [{ tool_slug: 'create_task' }, { tool_slug: 'zzz' }] }))
    expect(conflicted.tool_evidence_conflict).toBe(true)
    expect(conflicted.abstained).toBe(true)
  })

  test('runtime tool slugs translate into classifier vocabulary or stay unmapped', () => {
    expect(toClassifierToolSlug('create_task')).toBe('create_task')
    expect(toClassifierToolSlug('list_tasks')).toBe('find_tasks')
    expect(toClassifierToolSlug('search_tasks')).toBe('find_tasks')
    expect(toClassifierToolSlug('web_fetch')).toBe('fetch_public_web_page')
    expect(toClassifierToolSlug('load_tool')).toBe('load_tool')
    expect(toClassifierToolSlug('external_other')).toBe('external_other')
    expect(toClassifierToolSlug('apply_youtrack_command')).toBe('apply_youtrack_command')
  })

  test('structured feature signals map each intent signal to its primary', () => {
    const assertSignal = (intent: CoreIntent, signal: string): void => {
      const prediction = classifyMetadata(inputOf({ feature_events: [signal] }))
      expect(prediction.primary).toBe(intent)
      expect(prediction.abstained).toBe(false)
      expect(prediction.strategy).toBe('metadata_v1')
    }
    assertSignal('task.create', 'provider:task:create')
    assertSignal('task.find_list', 'provider:task:search')
    assertSignal('task.read_detail', 'provider:task:read_detail')
    assertSignal('task.update_fields', 'provider:task:update_fields')
    assertSignal('task.change_state', 'provider:task:change_state')
    assertSignal('task.collaborate', 'provider:task:collaborate')
    assertSignal('task.delete', 'provider:task:delete')
    assertSignal('project_schema.manage', 'feature:project_schema:manage')
    assertSignal('recurring.manage', 'feature:recurring:manage')
    assertSignal('deferred.manage', 'feature:deferred:manage')
    assertSignal('memory_memo.write', 'feature:memory:write')
    assertSignal('memory_memo.find', 'feature:memory:find')
    assertSignal('attachment.manage', 'feature:attachment:manage')
    assertSignal('web.retrieve', 'feature:web:retrieve')
    assertSignal('identity_participant.manage', 'feature:identity:manage')
    assertSignal('coding.start_review', 'feature:coding:start_review')
    assertSignal('coding.monitor_control', 'feature:coding:monitor_control')
    assertSignal('coding.continue_publish', 'feature:coding:continue_publish')
    assertSignal('configuration_permissions', 'feature:configuration:permissions')
    assertSignal('help_context', 'command:help_context')
  })

  test('a meta-tool alongside a mapped goal tool does not mask the goal', () => {
    for (const metaSlug of ['search_tools', 'load_tool', 'expand_result']) {
      const prediction = classifyToolTrace(
        inputOf({ tool_trace: [{ tool_slug: metaSlug }, { tool_slug: 'create_task' }] }),
      )
      expect(prediction.primary).toBe('task.create')
      expect(prediction.abstained).toBe(false)
      expect(prediction.tool_evidence_conflict).toBe(false)
      expect(prediction.strategy).toBe('tool_trace_v1')
    }
  })

  test('runtime tool slugs translate exhaustively to classifier vocabulary', () => {
    const expected: Record<string, string> = {
      create_task: 'create_task',
      list_tasks: 'find_tasks',
      search_tasks: 'find_tasks',
      count_tasks: 'find_tasks',
      get_task: 'get_task',
      get_task_history: 'get_task',
      update_task: 'update_task_fields',
      add_task_label: 'update_task_fields',
      remove_task_label: 'update_task_fields',
      add_comment: 'comment_or_assign_task',
      update_comment: 'comment_or_assign_task',
      remove_comment: 'comment_or_assign_task',
      add_comment_reaction: 'comment_or_assign_task',
      remove_comment_reaction: 'comment_or_assign_task',
      get_comments: 'comment_or_assign_task',
      add_task_relation: 'comment_or_assign_task',
      remove_task_relation: 'comment_or_assign_task',
      add_vote: 'comment_or_assign_task',
      remove_vote: 'comment_or_assign_task',
      add_watcher: 'comment_or_assign_task',
      remove_watcher: 'comment_or_assign_task',
      list_watchers: 'comment_or_assign_task',
      log_work: 'comment_or_assign_task',
      update_work: 'comment_or_assign_task',
      remove_work: 'comment_or_assign_task',
      list_work: 'comment_or_assign_task',
      assign_task_to_sprint: 'comment_or_assign_task',
      delete_task: 'delete_task',
      create_project: 'manage_project_schema',
      update_project: 'manage_project_schema',
      delete_project: 'manage_project_schema',
      get_project: 'manage_project_schema',
      list_projects: 'manage_project_schema',
      create_label: 'manage_project_schema',
      update_label: 'manage_project_schema',
      remove_label: 'manage_project_schema',
      list_labels: 'manage_project_schema',
      create_status: 'manage_project_schema',
      update_status: 'manage_project_schema',
      delete_status: 'manage_project_schema',
      list_statuses: 'manage_project_schema',
      reorder_statuses: 'manage_project_schema',
      create_sprint: 'manage_project_schema',
      update_sprint: 'manage_project_schema',
      list_sprints: 'manage_project_schema',
      list_agiles: 'manage_project_schema',
      add_project_member: 'manage_project_schema',
      remove_project_member: 'manage_project_schema',
      list_project_team: 'manage_project_schema',
      list_saved_queries: 'manage_project_schema',
      create_recurring_task: 'manage_recurring_task',
      update_recurring_task: 'manage_recurring_task',
      delete_recurring_task: 'manage_recurring_task',
      list_recurring_tasks: 'manage_recurring_task',
      pause_recurring_task: 'manage_recurring_task',
      resume_recurring_task: 'manage_recurring_task',
      skip_recurring_task: 'manage_recurring_task',
      create_reminder: 'manage_deferred_prompt',
      create_alert: 'manage_deferred_prompt',
      update_reminder: 'manage_deferred_prompt',
      cancel_reminder: 'manage_deferred_prompt',
      get_reminder: 'manage_deferred_prompt',
      list_reminders: 'manage_deferred_prompt',
      save_memo: 'write_memo',
      archive_memos: 'write_memo',
      promote_memo: 'write_memo',
      remember_memory: 'write_memo',
      forget_memory: 'write_memo',
      list_memos: 'find_memo',
      search_memos: 'find_memo',
      list_memory: 'find_memo',
      search_memory: 'find_memo',
      list_attachments: 'manage_attachment',
      upload_attachment: 'manage_attachment',
      remove_attachment: 'manage_attachment',
      delete_file: 'manage_attachment',
      list_files: 'manage_attachment',
      resolve_staged_file: 'manage_attachment',
      search_staged_files: 'manage_attachment',
      fetch_chat_link: 'manage_attachment',
      web_fetch: 'fetch_public_web_page',
      plugin_synthetic_web_search__search: 'fetch_public_web_page',
      find_user: 'resolve_participant_identity',
      resolve_chat_participant: 'resolve_participant_identity',
      set_my_identity: 'resolve_participant_identity',
      clear_my_identity: 'resolve_participant_identity',
      get_current_user: 'resolve_participant_identity',
      plugin_acp__start_session: 'start_coding_or_review',
      plugin_acp__list_projects: 'start_coding_or_review',
      plugin_acp__list_agents: 'start_coding_or_review',
      plugin_acp__session_status: 'control_coding_session',
      plugin_acp__list_sessions: 'control_coding_session',
      plugin_acp__cancel_session: 'control_coding_session',
      plugin_acp__answer_permission: 'control_coding_session',
      plugin_acp__continue_session: 'continue_or_publish_coding_session',
      plugin_acp__finish_session: 'continue_or_publish_coding_session',
      set_visibility: 'configure_tool_permissions',
    }
    expect(Object.keys(expected).length).toBe(97)
    for (const [runtimeSlug, classifierSlug] of Object.entries(expected)) {
      expect(toClassifierToolSlug(runtimeSlug)).toBe(classifierSlug)
    }
    expect(toClassifierToolSlug('external_other')).toBe('external_other')
    expect(toClassifierToolSlug('apply_youtrack_command')).toBe('apply_youtrack_command')
  })

  test('abstention predictions carry an empty goal list', () => {
    expect(classifyToolTrace(inputOf({})).goals).toEqual([])
    expect(classifyMetadata(inputOf({})).goals).toEqual([])
  })

  test('prediction-from-goals marks tool_evidence_conflict false', () => {
    const prediction = classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'create_task' }] }))
    expect(prediction.tool_evidence_conflict).toBe(false)
    expect(prediction.abstained).toBe(false)
  })

  test('every classifier path reports its deterministic strategy', () => {
    expect(classifyToolTrace(inputOf({})).strategy).toBe('tool_trace_v1')
    expect(classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'create_task' }] })).strategy).toBe('tool_trace_v1')
    expect(classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'external_other' }] })).strategy).toBe('tool_trace_v1')
    expect(classifyMetadata(inputOf({ feature_events: ['provider:task:create'] })).strategy).toBe('metadata_v1')
    expect(classifyMetadata(inputOf({ command_family: 'help' })).strategy).toBe('metadata_v1')
    expect(classifyMetadata(inputOf({ command_family: 'config' })).strategy).toBe('metadata_v1')
    expect(classifyMetadata(inputOf({ command_family: 'stop' })).strategy).toBe('metadata_v1')
    expect(classifyMetadata(inputOf({ feature_events: ['turn:unsupported_goal'] })).strategy).toBe('metadata_v1')
    expect(classifyMetadata(inputOf({})).strategy).toBe('metadata_v1')
  })

  test('stop and unsupported-goal paths report no conflict and empty goals', () => {
    const stop = classifyMetadata(inputOf({ command_family: 'stop' }))
    expect(stop.tool_evidence_conflict).toBe(false)
    expect(stop.goals).toEqual(['no_action'])
    const unsupported = classifyMetadata(inputOf({ feature_events: ['turn:unsupported_goal'] }))
    expect(unsupported.tool_evidence_conflict).toBe(false)
    expect(unsupported.goals).toEqual([])
  })

  test('hybrid with no evidence reports no tool evidence conflict', () => {
    const prediction = classifyHybrid(inputOf({}))
    expect(prediction.tool_evidence_conflict).toBe(false)
    expect(prediction.abstained).toBe(true)
    expect(prediction.strategy).toBe('hybrid_v1')
  })
})
