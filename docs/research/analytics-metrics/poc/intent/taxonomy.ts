// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const CORE_INTENTS = [
  'task.create',
  'task.find_list',
  'task.read_detail',
  'task.update_fields',
  'task.change_state',
  'task.collaborate',
  'task.delete',
  'project_schema.manage',
  'recurring.manage',
  'deferred.manage',
  'memory_memo.write',
  'memory_memo.find',
  'attachment.manage',
  'web.retrieve',
  'identity_participant.manage',
  'coding.start_review',
  'coding.monitor_control',
  'coding.continue_publish',
  'configuration_permissions',
  'help_context',
] as const

export const INTENT_LABELS = [...CORE_INTENTS, 'no_action', 'unknown', 'multi_goal'] as const

export type CoreIntent = (typeof CORE_INTENTS)[number]
export type IntentLabel = (typeof INTENT_LABELS)[number]
export type IntentGoal = CoreIntent | 'no_action'

export const INTENT_IDS: Readonly<Record<IntentLabel, string>> = {
  'task.create': 'I01',
  'task.find_list': 'I02',
  'task.read_detail': 'I03',
  'task.update_fields': 'I04',
  'task.change_state': 'I05',
  'task.collaborate': 'I06',
  'task.delete': 'I07',
  'project_schema.manage': 'I08',
  'recurring.manage': 'I09',
  'deferred.manage': 'I10',
  'memory_memo.write': 'I11',
  'memory_memo.find': 'I12',
  'attachment.manage': 'I13',
  'web.retrieve': 'I14',
  'identity_participant.manage': 'I15',
  'coding.start_review': 'I16',
  'coding.monitor_control': 'I17',
  'coding.continue_publish': 'I18',
  configuration_permissions: 'I19',
  help_context: 'I20',
  no_action: 'I21',
  unknown: 'I22',
  multi_goal: 'I23',
}

export const TAXONOMY_VERSION = 'intent.v1' as const

const ALL_GOALS: readonly IntentGoal[] = [...CORE_INTENTS, 'no_action']
const goalOrder = new Map<IntentGoal, number>(ALL_GOALS.map((label, index) => [label, index] as const))

export function isCoreIntent(value: unknown): value is CoreIntent {
  return typeof value === 'string' && (CORE_INTENTS as readonly string[]).includes(value)
}

export function isIntentLabel(value: unknown): value is IntentLabel {
  return typeof value === 'string' && (INTENT_LABELS as readonly string[]).includes(value)
}

export function isIntentGoal(value: unknown): value is IntentGoal {
  return isCoreIntent(value) || value === 'no_action'
}

export function sortGoals(goals: readonly IntentGoal[]): IntentGoal[] {
  return [...new Set(goals)].sort((left, right) => {
    const leftOrder = goalOrder.get(left)
    const rightOrder = goalOrder.get(right)
    if (leftOrder === undefined || rightOrder === undefined) throw new Error('Unregistered intent goal')
    return leftOrder - rightOrder
  })
}
