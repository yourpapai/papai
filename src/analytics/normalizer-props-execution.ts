// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import type { AnalyticsEventV1 } from './contracts.js'
import { propsByEventName } from './event-props.js'
import {
  byteBucket,
  countBucket,
  nonNegativeInt,
  parseEnum,
  propsOk,
  propsRejected,
  readBool,
  readNonEmptyString,
  readNullableBool,
} from './normalizer-shared.js'
import type { FactKeyDeriver, PropsBuildResult, ValidatedFactRecord } from './normalizer-shared.js'

type Props = AnalyticsEventV1['props']
type Result = PropsBuildResult<Props>

const nullableInt = (value: unknown): number | null | undefined => {
  if (value === null) return null
  return nonNegativeInt(value) ?? undefined
}

type LlmIdentity = Readonly<{
  attemptKey: ReturnType<FactKeyDeriver['attemptKey']>
  modelKey: ReturnType<FactKeyDeriver['modelKey']>
  modelRole: 'main' | 'small' | 'embedding' | 'verifier'
}>

const readLlmIdentity = (
  fact: ValidatedFactRecord,
  keys: FactKeyDeriver,
  modelRoleSchema: z.ZodType<'main' | 'small' | 'embedding' | 'verifier'>,
): PropsBuildResult<LlmIdentity> => {
  const rawAttemptId = readNonEmptyString(fact['rawAttemptId'])
  const modelId = readNonEmptyString(fact['modelId'])
  const providerBinding = readNonEmptyString(fact['providerBinding'])
  const modelRole = parseEnum(modelRoleSchema, fact['modelRole'])
  if (rawAttemptId === null || modelId === null || providerBinding === null) {
    return propsRejected('invalid_value')
  }
  if (modelRole === null) return propsRejected('unknown_enum')
  return propsOk({
    attemptKey: keys.attemptKey(rawAttemptId),
    modelKey: keys.modelKey(providerBinding, modelId),
    modelRole,
  })
}

const buildLlmStarted = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  const shape = propsByEventName.llm_started.shape
  const identity = readLlmIdentity(fact, keys, shape.model_role)
  if (!identity.ok) return identity
  const phase = parseEnum(shape.phase, fact['phase'])
  if (phase === null) return propsRejected('unknown_enum')
  const messageCount = countBucket(fact['messageCount'])
  const availableToolCount = countBucket(fact['availableToolCount'])
  if (messageCount === null || availableToolCount === null) return propsRejected('invalid_value')
  return propsOk({
    attempt_key: identity.props.attemptKey,
    model_key: identity.props.modelKey,
    model_role: identity.props.modelRole,
    phase,
    message_count: messageCount,
    available_tool_count: availableToolCount,
  })
}

const buildLlmCompleted = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  const shape = propsByEventName.llm_completed.shape
  const identity = readLlmIdentity(fact, keys, shape.model_role)
  if (!identity.ok) return identity
  const finishReason = parseEnum(shape.finish_reason, fact['finishReason'])
  if (finishReason === null) return propsRejected('unknown_enum')
  const durationMs = nonNegativeInt(fact['durationMs'])
  const stepCount = nonNegativeInt(fact['stepCount'])
  const ttft = nullableInt(fact['timeToFirstTokenMs'])
  const inputTokens = nullableInt(fact['inputTokens'])
  const outputTokens = nullableInt(fact['outputTokens'])
  if (
    durationMs === null ||
    stepCount === null ||
    ttft === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined
  ) {
    return propsRejected('invalid_value')
  }
  return propsOk({
    attempt_key: identity.props.attemptKey,
    model_key: identity.props.modelKey,
    model_role: identity.props.modelRole,
    duration_ms: durationMs,
    time_to_first_token_ms: ttft,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    step_count: stepCount,
    finish_reason: finishReason,
  })
}

const buildLlmFailed = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  const shape = propsByEventName.llm_failed.shape
  const identity = readLlmIdentity(fact, keys, shape.model_role)
  if (!identity.ok) return identity
  const phase = parseEnum(shape.phase, fact['phase'])
  const errorClass = parseEnum(shape.error_class, fact['errorClass'])
  if (phase === null || errorClass === null) return propsRejected('unknown_enum')
  const retryable = readNullableBool(fact['retryable'])
  const durationMs = nonNegativeInt(fact['durationMs'])
  if (retryable === undefined || durationMs === null) return propsRejected('invalid_value')
  return propsOk({
    attempt_key: identity.props.attemptKey,
    model_key: identity.props.modelKey,
    model_role: identity.props.modelRole,
    phase,
    error_class: errorClass,
    retryable,
    duration_ms: durationMs,
  })
}

type ToolStartedProps = z.infer<(typeof propsByEventName)['tool_started']>

const buildToolIdentity = (
  fact: ValidatedFactRecord,
  keys: FactKeyDeriver,
  shape: (typeof propsByEventName)['tool_started']['shape'],
): PropsBuildResult<ToolStartedProps> => {
  const rawSlug = readNonEmptyString(fact['toolSlug'])
  const rawOrigin = readNonEmptyString(fact['toolOrigin'])
  const toolSlug = parseEnum(shape.tool_slug, fact['toolSlug'])
  const origin = parseEnum(shape.origin, fact['toolOrigin'])
  const domain = parseEnum(shape.domain, fact['toolDomain'])
  const risk = parseEnum(shape.risk, fact['risk'])
  const modelRole = parseEnum(shape.model_role, fact['modelRole'])
  if (rawSlug === null || rawOrigin === null) return propsRejected('invalid_value')
  if (toolSlug === null || origin === null || domain === null || risk === null || modelRole === null) {
    return propsRejected('unknown_enum')
  }
  const argsBytes = byteBucket(fact['argsBytes'])
  if (argsBytes === null) return propsRejected('invalid_value')
  return propsOk({
    tool_slug: toolSlug,
    tool_key: keys.toolKey(rawOrigin, rawSlug),
    origin,
    domain,
    risk,
    model_role: modelRole,
    args_bytes: argsBytes,
  })
}

const buildToolCompleted = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  const shape = propsByEventName.tool_completed.shape
  const identity = buildToolIdentity(fact, keys, shape)
  if (!identity.ok) return identity
  const executionOutcome = parseEnum(shape.execution_outcome, fact['executionOutcome'])
  const statusClass = parseEnum(shape.status_class, fact['statusClass'])
  if (executionOutcome === null || statusClass === null) return propsRejected('unknown_enum')
  const errorClass = fact['errorClass'] === null ? null : parseEnum(shape.error_class.unwrap(), fact['errorClass'])
  if (errorClass === null && fact['errorClass'] !== null) return propsRejected('unknown_enum')
  const retryable = readNullableBool(fact['retryable'])
  const recoveredSameTurn = readBool(fact['recoveredSameTurn'])
  const durationMs = nonNegativeInt(fact['durationMs'])
  const resultBytes = byteBucket(fact['resultBytes'])
  if (retryable === undefined || recoveredSameTurn === null || durationMs === null || resultBytes === null) {
    return propsRejected('invalid_value')
  }
  return propsOk({
    ...identity.props,
    duration_ms: durationMs,
    execution_outcome: executionOutcome,
    result_bytes: resultBytes,
    error_class: errorClass,
    status_class: statusClass,
    retryable,
    recovered_same_turn: recoveredSameTurn,
  })
}

const readConfirmationIdentity = <S extends z.ZodType>(
  fact: ValidatedFactRecord,
  keys: FactKeyDeriver,
  toolSlugSchema: S,
): PropsBuildResult<Readonly<{ toolSlug: z.infer<S>; toolKey: ReturnType<FactKeyDeriver['toolKey']> }>> => {
  const rawSlug = readNonEmptyString(fact['toolSlug'])
  const rawOrigin = readNonEmptyString(fact['toolOrigin'])
  const toolSlug = parseEnum(toolSlugSchema, fact['toolSlug'])
  if (rawSlug === null || rawOrigin === null) return propsRejected('invalid_value')
  if (toolSlug === null) return propsRejected('unknown_enum')
  return propsOk({ toolSlug, toolKey: keys.toolKey(rawOrigin, rawSlug) })
}

const buildConfirmationRequested = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  const shape = propsByEventName.confirmation_requested.shape
  const identity = readConfirmationIdentity(fact, keys, shape.tool_slug)
  if (!identity.ok) return identity
  const risk = parseEnum(shape.risk, fact['risk'])
  if (risk === null) return propsRejected('unknown_enum')
  if (fact['timeoutMs'] !== 300_000) return propsRejected('invalid_value')
  return propsOk({
    tool_slug: identity.props.toolSlug,
    tool_key: identity.props.toolKey,
    risk,
    timeout_ms: 300_000,
  })
}

const buildConfirmationResolved = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  const shape = propsByEventName.confirmation_resolved.shape
  const identity = readConfirmationIdentity(fact, keys, shape.tool_slug)
  if (!identity.ok) return identity
  const decision = parseEnum(shape.decision, fact['decision'])
  if (decision === null) return propsRejected('unknown_enum')
  const decisionLatencyMs = nonNegativeInt(fact['decisionLatencyMs'])
  if (decisionLatencyMs === null) return propsRejected('invalid_value')
  return propsOk({
    tool_slug: identity.props.toolSlug,
    tool_key: identity.props.toolKey,
    decision,
    decision_latency_ms: decisionLatencyMs,
  })
}

const buildFirstVisibleFeedback = (fact: ValidatedFactRecord): Result => {
  const shape = propsByEventName.first_visible_feedback.shape
  const kind = parseEnum(shape.kind, fact['kind'])
  const outcome = parseEnum(shape.outcome, fact['outcome'])
  if (kind === null || outcome === null) return propsRejected('unknown_enum')
  const capabilitySupported = readBool(fact['capabilitySupported'])
  const settingEnabled = readBool(fact['settingEnabled'])
  const latencyMs = nullableInt(fact['latencyMs'])
  if (capabilitySupported === null || settingEnabled === null || latencyMs === undefined) {
    return propsRejected('invalid_value')
  }
  return propsOk({
    kind,
    outcome,
    capability_supported: capabilitySupported,
    setting_enabled: settingEnabled,
    latency_ms: latencyMs,
  })
}

export const buildExecutionFamilyProps = (fact: ValidatedFactRecord, keys: FactKeyDeriver): Result => {
  switch (fact.type) {
    case 'llm_started':
      return buildLlmStarted(fact, keys)
    case 'llm_completed':
      return buildLlmCompleted(fact, keys)
    case 'llm_failed':
      return buildLlmFailed(fact, keys)
    case 'tool_started':
      return buildToolIdentity(fact, keys, propsByEventName.tool_started.shape)
    case 'tool_completed':
      return buildToolCompleted(fact, keys)
    case 'confirmation_requested':
      return buildConfirmationRequested(fact, keys)
    case 'confirmation_resolved':
      return buildConfirmationResolved(fact, keys)
    case 'first_visible_feedback':
      return buildFirstVisibleFeedback(fact)
    default:
      return propsRejected('unknown_event')
  }
}
