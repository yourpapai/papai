// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IntentV1 } from './fixture-contract.js'
import type { Actor, IntentSpec, ToolRisk, ToolSpec, TurnInput, TurnOutcome } from './fixture-types.js'

const taskTool = (slug: string, risk: ToolRisk, providerOperation: ToolSpec['providerOperation']): ToolSpec => ({
  slug,
  domain: 'task',
  risk,
  origin: 'core',
  providerOperation,
})

export const INTENT_SPECS = [
  { intent: 'task.create', tool: taskTool('task_create', 'write', 'create') },
  { intent: 'task.find_list', tool: taskTool('task_find_list', 'read', 'search') },
  { intent: 'task.read_detail', tool: taskTool('task_read_detail', 'read', 'read') },
  { intent: 'task.update_fields', tool: taskTool('task_update_fields', 'write', 'update') },
  { intent: 'task.change_state', tool: taskTool('task_change_state', 'write', 'update') },
  { intent: 'task.collaborate', tool: taskTool('task_collaborate', 'write', 'update') },
  { intent: 'task.delete', tool: taskTool('task_delete', 'destructive', 'delete') },
  { intent: 'project_schema.manage', tool: taskTool('project_schema_manage', 'write', 'update') },
  {
    intent: 'recurring.manage',
    tool: { slug: 'recurring_manage', domain: 'schedule', risk: 'write', origin: 'core', providerOperation: 'update' },
  },
  {
    intent: 'deferred.manage',
    tool: { slug: 'deferred_manage', domain: 'schedule', risk: 'write', origin: 'core', providerOperation: 'update' },
  },
  {
    intent: 'memory_memo.write',
    tool: { slug: 'memo_write', domain: 'memo', risk: 'write', origin: 'core', providerOperation: 'create' },
  },
  {
    intent: 'memory_memo.find',
    tool: { slug: 'memo_find', domain: 'memo', risk: 'read', origin: 'core', providerOperation: 'search' },
  },
  {
    intent: 'attachment.manage',
    tool: {
      slug: 'attachment_manage',
      domain: 'attachment',
      risk: 'write',
      origin: 'core',
      providerOperation: 'update',
    },
  },
  {
    intent: 'web.retrieve',
    tool: { slug: 'web_retrieve', domain: 'web', risk: 'open_world', origin: 'core', providerOperation: 'read' },
  },
  {
    intent: 'identity_participant.manage',
    tool: { slug: 'identity_manage', domain: 'identity', risk: 'write', origin: 'core', providerOperation: 'update' },
  },
  {
    intent: 'coding.start_review',
    tool: {
      slug: 'coding_start_review',
      domain: 'coding',
      risk: 'write',
      origin: 'first_party_plugin',
      providerOperation: 'create',
    },
  },
  {
    intent: 'coding.monitor_control',
    tool: {
      slug: 'coding_monitor_control',
      domain: 'coding',
      risk: 'read',
      origin: 'first_party_plugin',
      providerOperation: 'read',
    },
  },
  {
    intent: 'coding.continue_publish',
    tool: {
      slug: 'coding_continue_publish',
      domain: 'coding',
      risk: 'write',
      origin: 'first_party_plugin',
      providerOperation: 'update',
    },
  },
  {
    intent: 'configuration_permissions',
    tool: {
      slug: 'configuration_permissions',
      domain: 'config',
      risk: 'write',
      origin: 'core',
      providerOperation: 'update',
    },
  },
  {
    intent: 'help_context',
    tool: { slug: 'help_context', domain: 'meta', risk: 'read', origin: 'core', providerOperation: 'read' },
  },
  { intent: 'no_action', tool: null },
  { intent: 'unknown', tool: null },
  { intent: 'multi_goal', tool: taskTool('task_find_list', 'read', 'search') },
] as const satisfies readonly IntentSpec[]

export const FEATURES = [
  'recurring',
  'deferred',
  'memory_write',
  'memory_search',
  'attachment',
  'coding',
  'mcp',
  'byok',
  'guest_mode',
  'web_fetch',
  'live_status',
] as const

export function intentGoals(intent: IntentV1): readonly string[] {
  if (intent === 'multi_goal') return ['task.create', 'task.find_list']
  if (intent === 'no_action' || intent === 'unknown') return []
  return [intent]
}

export function effectiveOutcome(input: TurnInput): TurnOutcome {
  const mutatingTask = input.intent.tool?.domain === 'task' && ['write', 'destructive'].includes(input.intent.tool.risk)
  const mayMutate = input.allowMutatingSuccess && input.actor.hasFirstMutatingSuccess
  if (mutatingTask) {
    return mayMutate ? input.requestedOutcome : input.requestedOutcome === 'recovered' ? 'abandoned' : 'failure'
  }
  if (input.intent.tool === null && input.requestedOutcome === 'recovered') return 'success'
  return input.requestedOutcome
}

export function requestedOutcomeFor(actor: Actor, day: number, slot: number): TurnOutcome {
  const key = (actor.index * 31 + day * 17 + slot * 7) % 12
  if (key < 7) return 'success'
  if (key < 9) return 'failure'
  if (key < 11) return 'recovered'
  return 'abandoned'
}
