// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import type { EventNameV1 } from './controlled-types.js'
import type { ByteBucket, CountBucket, LengthBucket, Pseudonym } from './controlled-types.js'
import { createPseudonym } from './identity/pseudonym.js'
import type { AnalyticsSourceContext } from './source-facts.js'

export type NormalizationReason =
  | 'unknown_event'
  | 'unknown_version'
  | 'unknown_property'
  | 'unknown_enum'
  | 'invalid_value'
  | 'missing_context'

export type PropsBuildResult<T> =
  | Readonly<{ ok: true; props: T }>
  | Readonly<{ ok: false; reason: NormalizationReason }>

export type ValidatedFactRecord = Readonly<{
  version: number
  type: string
  sourceEventId: string
  occurredAtMs: number
  source: AnalyticsSourceContext
}> &
  Readonly<Record<string, unknown>>

export const propsOk = <T>(props: T): PropsBuildResult<T> => ({ ok: true, props })

export const propsRejected = <T>(reason: NormalizationReason): PropsBuildResult<T> => ({ ok: false, reason })

export const nonNegativeInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

export const readBool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)

export const readNullableBool = (value: unknown): boolean | null | undefined => {
  if (value === null) return null
  if (typeof value !== 'boolean') return undefined
  return value
}

export const readNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

export const readStringArray = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null
  return value.every((entry) => typeof entry === 'string') ? value : null
}

export const countBucket = (value: unknown): CountBucket | null => {
  const parsed = nonNegativeInt(value)
  if (parsed === null) return null
  if (parsed === 0) return '0'
  if (parsed === 1) return '1'
  if (parsed === 2) return '2'
  if (parsed <= 5) return '3_5'
  if (parsed <= 10) return '6_10'
  if (parsed <= 20) return '11_20'
  return '21_plus'
}

export const lengthBucket = (value: unknown): LengthBucket | null => {
  const parsed = nonNegativeInt(value)
  if (parsed === null) return null
  if (parsed === 0) return '0'
  if (parsed <= 32) return '1_32'
  if (parsed <= 128) return '33_128'
  if (parsed <= 512) return '129_512'
  if (parsed <= 2048) return '513_2048'
  return '2049_plus'
}

export const byteBucket = (value: unknown): ByteBucket | null => {
  const parsed = nonNegativeInt(value)
  if (parsed === null) return null
  if (parsed === 0) return '0'
  if (parsed <= 256) return '1_256'
  if (parsed <= 1024) return '257_1024'
  if (parsed <= 8192) return '1025_8192'
  if (parsed <= 65536) return '8193_65536'
  return '65537_plus'
}

export const parseEnum = <S extends z.ZodType>(schema: S, value: unknown): z.infer<S> | null => {
  const result = schema.safeParse(value)
  return result.success ? result.data : null
}

export type FactKeyDeriver = Readonly<{
  attemptKey(rawAttemptId: string): Pseudonym
  modelKey(providerBinding: string, modelId: string): Pseudonym
  toolKey(origin: string, slug: string): Pseudonym
  serverKey(rawServerId: string): Pseudonym
  codingProjectKey(platformInstanceId: string, rawId: string): Pseudonym
  codingSessionKey(platformInstanceId: string, rawId: string): Pseudonym
}>

export const createFactKeyDeriver = (input: { key: Buffer; keyVersion: string }): FactKeyDeriver => {
  const derive = (domain: string, components: readonly string[]): Pseudonym =>
    createPseudonym({ key: input.key, keyVersion: input.keyVersion, domain, components })
  return {
    attemptKey: (rawAttemptId) => derive('llm-attempt:v1', [rawAttemptId]),
    modelKey: (providerBinding, modelId) => derive('model:v1', [providerBinding, modelId]),
    toolKey: (origin, slug) => derive('tool:v1', [origin, slug]),
    serverKey: (rawServerId) => derive('mcp-server:v1', [rawServerId]),
    codingProjectKey: (platformInstanceId, rawId) => derive('coding-project:v1', [platformInstanceId, rawId]),
    codingSessionKey: (platformInstanceId, rawId) => derive('coding-session:v1', [platformInstanceId, rawId]),
  }
}

const FACT_BASE_KEYS: readonly string[] = ['version', 'type', 'sourceEventId', 'occurredAtMs', 'source']

export const FACT_VARIANT_KEYS: Readonly<Record<EventNameV1, readonly string[]>> = {
  chat_message_accepted: ['inputCount', 'inputLengthChars', 'attachmentCount', 'isCommand', 'command'],
  auth_checked: ['outcome', 'reason'],
  turn_started: ['incomingMessageCount', 'attachmentCount', 'queueWaitMs'],
  turn_completed: [
    'outcome',
    'durationMs',
    'stepCount',
    'toolCallCount',
    'replyCount',
    'finishReason',
    'clarification',
    'liveStatusUsed',
  ],
  reply_sent: ['latencyMs', 'partCount', 'totalLengthChars', 'delivery'],
  llm_started: [
    'rawAttemptId',
    'modelId',
    'providerBinding',
    'modelRole',
    'phase',
    'messageCount',
    'availableToolCount',
  ],
  llm_completed: [
    'rawAttemptId',
    'modelId',
    'providerBinding',
    'modelRole',
    'durationMs',
    'timeToFirstTokenMs',
    'inputTokens',
    'outputTokens',
    'stepCount',
    'finishReason',
  ],
  llm_failed: [
    'rawAttemptId',
    'modelId',
    'providerBinding',
    'modelRole',
    'phase',
    'errorClass',
    'retryable',
    'durationMs',
  ],
  tool_started: ['toolSlug', 'toolOrigin', 'toolDomain', 'risk', 'modelRole', 'argsBytes'],
  tool_completed: [
    'toolSlug',
    'toolOrigin',
    'toolDomain',
    'risk',
    'modelRole',
    'argsBytes',
    'durationMs',
    'executionOutcome',
    'resultBytes',
    'errorClass',
    'statusClass',
    'retryable',
    'recoveredSameTurn',
  ],
  confirmation_requested: ['toolSlug', 'toolOrigin', 'risk', 'timeoutMs'],
  confirmation_resolved: ['toolSlug', 'toolOrigin', 'decision', 'decisionLatencyMs'],
  turn_steered: ['ordinal', 'steerLengthChars', 'ackSent'],
  turn_stop_requested: ['stage'],
  clarification_requested: ['reason'],
  rephrase_detected: ['detector', 'similarity', 'priorOutcome', 'gap'],
  clarification_abandoned: ['observationHours'],
  disclosure_fallback: ['reason', 'stepCount'],
  config_link_issued: ['result'],
  settings_opened: ['entry', 'result'],
  task_instance_assigned: ['change', 'fromProvider', 'toProvider'],
  intent_classified: ['taxonomy', 'primary', 'goals', 'confidence', 'strategy', 'abstained'],
  feature_opportunity: ['feature', 'available', 'reason', 'sampling'],
  feature_used: ['feature', 'operation', 'outcome', 'codingProjectRawId', 'codingSessionRawId'],
  first_visible_feedback: ['kind', 'outcome', 'capabilitySupported', 'settingEnabled', 'latencyMs'],
  live_status_opportunity: ['eligible', 'reason'],
  live_status_lifecycle: ['stage', 'outcome', 'latencyFromTurnStartMs', 'ordinal'],
  provider_request_completed: ['provider', 'operation', 'durationMs', 'outcome', 'statusClass', 'retryable'],
  rate_limit_blocked: ['limit'],
  unconfigured_reply: ['missing', 'surface'],
  mcp_availability: ['origin', 'serverRawId', 'outcome'],
  guest_turn_aggregate: ['utcDay', 'turns', 'successfulTurns', 'failedTurns', 'contextCount'],
}

export const factHasOnlyAllowedKeys = (fact: ValidatedFactRecord, name: EventNameV1): boolean => {
  const allowed = new Set<string>([...FACT_BASE_KEYS, ...FACT_VARIANT_KEYS[name]])
  return Object.keys(fact).every((key) => allowed.has(key))
}
