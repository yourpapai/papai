// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  isCoreIntent,
  isIntentGoal,
  isIntentLabel,
  sortGoals,
  type CoreIntent,
  type IntentGoal,
  type IntentLabel,
} from './taxonomy.js'

const REQUEST_KEYS = ['eligible', 'message', 'metadata', 'schema', 'taxonomy'] as const
const METADATA_KEYS = [
  'actor_role',
  'command_family',
  'context_type',
  'feature_events',
  'finish_reason',
  'language_hint',
  'task_provider',
  'tool_goals',
] as const
const RESULT_KEYS = ['abstained', 'confidence', 'goals', 'primary', 'schema', 'taxonomy'] as const

const LANGUAGES = ['en', 'ru', 'mixed', 'unknown'] as const
const CONTEXT_TYPES = ['dm', 'group'] as const
const ACTOR_ROLES = ['admin', 'member'] as const
const TASK_PROVIDERS = ['kaneo', 'youtrack', 'none', 'other'] as const
const FINISH_REASONS = ['stop', 'length', 'tool_calls', 'content_filter', 'error', 'other', 'unknown'] as const
const COMMAND_FAMILIES = [
  'none',
  'start',
  'config',
  'help',
  'context',
  'dashboard',
  'clear',
  'stop',
  'acp',
  'other',
] as const
const FEATURE_EVENTS = [
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

export interface SmallModelRequest {
  readonly schema: 'papai.intent.small_model.request.v1'
  readonly taxonomy: 'intent.v1'
  readonly eligible: true
  readonly message: string
  readonly metadata: {
    readonly language_hint: (typeof LANGUAGES)[number]
    readonly context_type: (typeof CONTEXT_TYPES)[number]
    readonly actor_role: (typeof ACTOR_ROLES)[number]
    readonly task_provider: (typeof TASK_PROVIDERS)[number]
    readonly tool_goals: readonly CoreIntent[]
    readonly finish_reason: (typeof FINISH_REASONS)[number]
    readonly command_family: (typeof COMMAND_FAMILIES)[number]
    readonly feature_events: readonly (typeof FEATURE_EVENTS)[number][]
  }
}

export interface SmallModelResult {
  readonly schema: 'papai.intent.small_model.result.v1'
  readonly taxonomy: 'intent.v1'
  readonly primary: IntentLabel
  readonly goals: readonly IntentGoal[]
  readonly confidence: number
  readonly abstained: boolean
}

type ParseResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isEnumValue<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function isUniqueArray<T>(value: unknown, guard: (item: unknown) => item is T, max: number): value is T[] {
  return Array.isArray(value) && value.length <= max && value.every(guard) && new Set(value).size === value.length
}

export function parseSmallModelRequest(value: unknown): ParseResult<SmallModelRequest> {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) return { ok: false }
  const metadata = value['metadata']
  if (!isRecord(metadata) || !hasExactKeys(metadata, METADATA_KEYS)) return { ok: false }
  if (
    value['schema'] !== 'papai.intent.small_model.request.v1' ||
    value['taxonomy'] !== 'intent.v1' ||
    value['eligible'] !== true ||
    typeof value['message'] !== 'string' ||
    value['message'].length < 1 ||
    value['message'].length > 8_192 ||
    !isEnumValue(LANGUAGES, metadata['language_hint']) ||
    !isEnumValue(CONTEXT_TYPES, metadata['context_type']) ||
    !isEnumValue(ACTOR_ROLES, metadata['actor_role']) ||
    !isEnumValue(TASK_PROVIDERS, metadata['task_provider']) ||
    !isUniqueArray(metadata['tool_goals'], isCoreIntent, 3) ||
    !isEnumValue(FINISH_REASONS, metadata['finish_reason']) ||
    !isEnumValue(COMMAND_FAMILIES, metadata['command_family']) ||
    !isUniqueArray(
      metadata['feature_events'],
      (item): item is (typeof FEATURE_EVENTS)[number] => isEnumValue(FEATURE_EVENTS, item),
      16,
    )
  ) {
    return { ok: false }
  }
  return {
    ok: true,
    value: {
      schema: 'papai.intent.small_model.request.v1',
      taxonomy: 'intent.v1',
      eligible: true,
      message: value['message'],
      metadata: {
        language_hint: metadata['language_hint'],
        context_type: metadata['context_type'],
        actor_role: metadata['actor_role'],
        task_provider: metadata['task_provider'],
        tool_goals: metadata['tool_goals'],
        finish_reason: metadata['finish_reason'],
        command_family: metadata['command_family'],
        feature_events: metadata['feature_events'],
      },
    },
  }
}

function goalsMatchPrimary(primary: IntentLabel, goals: readonly IntentGoal[], abstained: boolean): boolean {
  if (primary === 'unknown') return abstained && goals.length === 0
  if (primary === 'no_action') return !abstained && goals.length === 1 && goals[0] === 'no_action'
  if (primary === 'multi_goal') {
    return (
      !abstained &&
      goals.length >= 2 &&
      goals.length <= 3 &&
      goals.every(isCoreIntent) &&
      JSON.stringify(goals) === JSON.stringify(sortGoals(goals))
    )
  }
  return !abstained && goals.length === 1 && goals[0] === primary
}

export function parseSmallModelResult(value: unknown): ParseResult<SmallModelResult> {
  if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) return { ok: false }
  const primary = value['primary']
  const goals = value['goals']
  const confidence = value['confidence']
  const abstained = value['abstained']
  if (
    value['schema'] !== 'papai.intent.small_model.result.v1' ||
    value['taxonomy'] !== 'intent.v1' ||
    !isIntentLabel(primary) ||
    !isUniqueArray(goals, isIntentGoal, 3) ||
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    (primary !== 'unknown' && confidence < 0.85) ||
    typeof abstained !== 'boolean' ||
    !goalsMatchPrimary(primary, goals, abstained)
  ) {
    return { ok: false }
  }
  return {
    ok: true,
    value: {
      schema: 'papai.intent.small_model.result.v1',
      taxonomy: 'intent.v1',
      primary,
      goals,
      confidence,
      abstained,
    },
  }
}
