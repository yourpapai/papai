// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Runtime deterministic A+B intent classifiers promoted from the frozen PoC
 * `docs/research/analytics-metrics/poc/intent/classifiers.ts`. Pure functions
 * over controlled tool traces, feature signals, and command family; they never
 * see message text and never invoke a model. The runtime-slug adapter maps the
 * controlled v1 tool-slug vocabulary onto the classifier's rule vocabulary;
 * unmapped slugs fail closed to abstention exactly like the PoC.
 */

import { CORE_INTENTS, sortGoals } from './taxonomy.js'
import type { CoreIntent, IntentGoal, IntentLabel } from './taxonomy.js'

export type DeterministicStrategy = 'tool_trace_v1' | 'metadata_v1' | 'hybrid_v1'

export type IntentCommandFamily = 'config' | 'help' | 'none' | 'stop'

export type IntentClassifierInput = Readonly<{
  tool_trace: readonly Readonly<{ tool_slug: string }>[]
  feature_events: readonly string[]
  command_family: IntentCommandFamily
}>

export interface IntentPrediction {
  readonly strategy: DeterministicStrategy
  readonly primary: IntentLabel
  readonly goals: readonly IntentGoal[]
  readonly confidence: number
  readonly abstained: boolean
  readonly tool_evidence_conflict: boolean
}

export const TOOL_BY_INTENT: Readonly<Record<CoreIntent, string>> = {
  'task.create': 'create_task',
  'task.find_list': 'find_tasks',
  'task.read_detail': 'get_task',
  'task.update_fields': 'update_task_fields',
  'task.change_state': 'change_task_state',
  'task.collaborate': 'comment_or_assign_task',
  'task.delete': 'delete_task',
  'project_schema.manage': 'manage_project_schema',
  'recurring.manage': 'manage_recurring_task',
  'deferred.manage': 'manage_deferred_prompt',
  'memory_memo.write': 'write_memo',
  'memory_memo.find': 'find_memo',
  'attachment.manage': 'manage_attachment',
  'web.retrieve': 'fetch_public_web_page',
  'identity_participant.manage': 'resolve_participant_identity',
  'coding.start_review': 'start_coding_or_review',
  'coding.monitor_control': 'control_coding_session',
  'coding.continue_publish': 'continue_or_publish_coding_session',
  configuration_permissions: 'configure_tool_permissions',
  help_context: 'show_help_or_context',
}

export const STRUCTURED_SIGNAL_BY_INTENT: Readonly<Record<CoreIntent, string>> = {
  'task.create': 'provider:task:create',
  'task.find_list': 'provider:task:search',
  'task.read_detail': 'provider:task:read_detail',
  'task.update_fields': 'provider:task:update_fields',
  'task.change_state': 'provider:task:change_state',
  'task.collaborate': 'provider:task:collaborate',
  'task.delete': 'provider:task:delete',
  'project_schema.manage': 'feature:project_schema:manage',
  'recurring.manage': 'feature:recurring:manage',
  'deferred.manage': 'feature:deferred:manage',
  'memory_memo.write': 'feature:memory:write',
  'memory_memo.find': 'feature:memory:find',
  'attachment.manage': 'feature:attachment:manage',
  'web.retrieve': 'feature:web:retrieve',
  'identity_participant.manage': 'feature:identity:manage',
  'coding.start_review': 'feature:coding:start_review',
  'coding.monitor_control': 'feature:coding:monitor_control',
  'coding.continue_publish': 'feature:coding:continue_publish',
  configuration_permissions: 'feature:configuration:permissions',
  help_context: 'command:help_context',
}

const TOOL_TO_INTENT = new Map<string, CoreIntent>(CORE_INTENTS.map((intent) => [TOOL_BY_INTENT[intent], intent]))

const SIGNAL_TO_INTENT = new Map<string, CoreIntent>(
  CORE_INTENTS.map((intent) => [STRUCTURED_SIGNAL_BY_INTENT[intent], intent]),
)

const META_TOOLS = new Set(['search_tools', 'load_tool', 'expand_result'])

const RUNTIME_SLUGS_BY_INTENT: Readonly<Record<CoreIntent, readonly string[]>> = {
  'task.create': ['create_task'],
  'task.find_list': ['list_tasks', 'search_tasks', 'count_tasks'],
  'task.read_detail': ['get_task', 'get_task_history'],
  'task.update_fields': ['update_task', 'add_task_label', 'remove_task_label'],
  'task.change_state': [],
  'task.collaborate': [
    'add_comment',
    'update_comment',
    'remove_comment',
    'add_comment_reaction',
    'remove_comment_reaction',
    'get_comments',
    'add_task_relation',
    'remove_task_relation',
    'add_vote',
    'remove_vote',
    'add_watcher',
    'remove_watcher',
    'list_watchers',
    'log_work',
    'update_work',
    'remove_work',
    'list_work',
    'assign_task_to_sprint',
  ],
  'task.delete': ['delete_task'],
  'project_schema.manage': [
    'create_project',
    'update_project',
    'delete_project',
    'get_project',
    'list_projects',
    'create_label',
    'update_label',
    'remove_label',
    'list_labels',
    'create_status',
    'update_status',
    'delete_status',
    'list_statuses',
    'reorder_statuses',
    'create_sprint',
    'update_sprint',
    'list_sprints',
    'list_agiles',
    'add_project_member',
    'remove_project_member',
    'list_project_team',
    'list_saved_queries',
  ],
  'recurring.manage': [
    'create_recurring_task',
    'update_recurring_task',
    'delete_recurring_task',
    'list_recurring_tasks',
    'pause_recurring_task',
    'resume_recurring_task',
    'skip_recurring_task',
  ],
  'deferred.manage': [
    'create_deferred_prompt',
    'update_deferred_prompt',
    'cancel_deferred_prompt',
    'get_deferred_prompt',
    'list_deferred_prompts',
  ],
  'memory_memo.write': ['save_memo', 'archive_memos', 'promote_memo', 'remember_memory', 'forget_memory'],
  'memory_memo.find': ['list_memos', 'search_memos', 'list_memory', 'search_memory'],
  'attachment.manage': [
    'list_attachments',
    'upload_attachment',
    'remove_attachment',
    'delete_file',
    'list_files',
    'resolve_staged_file',
    'search_staged_files',
    'fetch_chat_link',
  ],
  'web.retrieve': ['web_fetch', 'plugin_synthetic_web_search__search'],
  'identity_participant.manage': [
    'find_user',
    'resolve_chat_participant',
    'set_my_identity',
    'clear_my_identity',
    'get_current_user',
  ],
  'coding.start_review': ['plugin_acp__start_session', 'plugin_acp__list_projects', 'plugin_acp__list_agents'],
  'coding.monitor_control': [
    'plugin_acp__session_status',
    'plugin_acp__list_sessions',
    'plugin_acp__cancel_session',
    'plugin_acp__answer_permission',
  ],
  'coding.continue_publish': ['plugin_acp__continue_session', 'plugin_acp__finish_session'],
  configuration_permissions: ['set_visibility'],
  help_context: [],
}

const CLASSIFIER_SLUG_BY_RUNTIME_SLUG = new Map<string, string>(
  CORE_INTENTS.flatMap((intent) =>
    RUNTIME_SLUGS_BY_INTENT[intent].map((runtimeSlug) => [runtimeSlug, TOOL_BY_INTENT[intent]] as const),
  ),
)

/** Maps a controlled runtime tool slug to the classifier rule vocabulary; unmapped slugs pass through unchanged. */
export const toClassifierToolSlug = (runtimeSlug: string): string =>
  CLASSIFIER_SLUG_BY_RUNTIME_SLUG.get(runtimeSlug) ?? runtimeSlug

function abstention(strategy: DeterministicStrategy, toolEvidenceConflict = false): IntentPrediction {
  return {
    strategy,
    primary: 'unknown',
    goals: [],
    confidence: 0.5,
    abstained: true,
    tool_evidence_conflict: toolEvidenceConflict,
  }
}

function predictionFromGoals(
  strategy: DeterministicStrategy,
  goals: readonly CoreIntent[],
  confidence: number,
): IntentPrediction {
  const ordered = sortGoals(goals)
  if (ordered.length === 0 || ordered.length > 3) return abstention(strategy)
  return {
    strategy,
    primary: ordered.length === 1 ? ordered[0]! : 'multi_goal',
    goals: ordered,
    confidence,
    abstained: false,
    tool_evidence_conflict: false,
  }
}

export function classifyToolTrace(input: IntentClassifierInput): IntentPrediction {
  const goals: CoreIntent[] = []
  let sawUnmappedGoalTool = false
  for (const tool of input.tool_trace) {
    if (META_TOOLS.has(tool.tool_slug)) continue
    const mapped = TOOL_TO_INTENT.get(tool.tool_slug)
    if (mapped === undefined) {
      sawUnmappedGoalTool = true
      continue
    }
    goals.push(mapped)
  }
  if (sawUnmappedGoalTool) return abstention('tool_trace_v1', goals.length > 0)
  return goals.length === 0 ? abstention('tool_trace_v1') : predictionFromGoals('tool_trace_v1', goals, 0.99)
}

function metadataGoals(input: IntentClassifierInput): CoreIntent[] {
  return input.feature_events.flatMap((event) => {
    const intent = SIGNAL_TO_INTENT.get(event)
    return intent === undefined ? [] : [intent]
  })
}

export function classifyMetadata(input: IntentClassifierInput): IntentPrediction {
  const goals = metadataGoals(input)
  if (goals.length > 0) return predictionFromGoals('metadata_v1', goals, 0.97)
  if (input.command_family === 'help') {
    return predictionFromGoals('metadata_v1', ['help_context'], 0.99)
  }
  if (input.command_family === 'config') {
    return predictionFromGoals('metadata_v1', ['configuration_permissions'], 0.99)
  }
  if (input.command_family === 'stop') {
    return {
      strategy: 'metadata_v1',
      primary: 'no_action',
      goals: ['no_action'],
      confidence: 0.99,
      abstained: false,
      tool_evidence_conflict: false,
    }
  }
  if (input.feature_events.includes('turn:unsupported_goal')) {
    return {
      strategy: 'metadata_v1',
      primary: 'unknown',
      goals: [],
      confidence: 0.95,
      abstained: false,
      tool_evidence_conflict: false,
    }
  }
  return abstention('metadata_v1')
}

export function classifyHybrid(input: IntentClassifierInput): IntentPrediction {
  const toolPrediction = classifyToolTrace(input)
  if (!toolPrediction.abstained) return { ...toolPrediction, strategy: 'hybrid_v1' }
  const metadataPrediction = classifyMetadata(input)
  return {
    ...metadataPrediction,
    strategy: 'hybrid_v1',
    tool_evidence_conflict: toolPrediction.tool_evidence_conflict || metadataPrediction.tool_evidence_conflict,
  }
}
