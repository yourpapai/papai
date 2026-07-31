// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LlmUsageEventRow } from '../../db/llm-usage-events-schema.js'
import type { ToolCallEventRow } from '../../db/tool-call-events-schema.js'
import type { AggregateIncrement } from '../aggregate.js'
import type { AnalyticsEventV1 } from '../contracts.js'
import type { CollectionEligibilityRef, EligibilityDecision } from '../governance/eligibility.js'
import { createPseudonym } from '../identity/pseudonym.js'
import type { NormalizationReason } from '../normalizer-shared.js'
import { nonNegativeInt } from '../normalizer-shared.js'

export type NormalizationRejectionReason = NormalizationReason
export type EligibilityDenialReason = Extract<EligibilityDecision, { allowed: false }>['reason']

export type BackfillDecision =
  | {
      kind: 'canonical'
      event: AnalyticsEventV1
      collectionRef: CollectionEligibilityRef
    }
  | { kind: 'aggregate_only'; increments: readonly AggregateIncrement[] }
  | { kind: 'ineligible'; reason: EligibilityDenialReason }
  | { kind: 'rejected'; reason: NormalizationRejectionReason }

export const LLM_SOURCE_TABLE = 'llm_usage_events'
export const TOOL_SOURCE_TABLE = 'tool_call_events'

export type BackfillSourceTable = typeof LLM_SOURCE_TABLE | typeof TOOL_SOURCE_TABLE

export const sourceEventTypeForTable = (table: string): string =>
  table === LLM_SOURCE_TABLE ? 'llm_usage_event' : 'tool_call_event'

export const BACKFILL_SOURCE_REF_DOMAIN = 'backfill-source-ref:v1'

export const deriveBackfillSourceRef = (input: {
  key: Buffer
  keyVersion: string
  sourceTable: string
  sourceEventId: string
  decisionName: string
}): string =>
  createPseudonym({
    key: input.key,
    keyVersion: input.keyVersion,
    domain: BACKFILL_SOURCE_REF_DOMAIN,
    components: [input.sourceTable, input.sourceEventId, input.decisionName],
  })

export const decisionNameOf = (decision: BackfillDecision): string => {
  if (decision.kind === 'canonical') return `canonical:${decision.event.event.name}`
  if (decision.kind === 'aggregate_only') {
    const first = decision.increments[0]
    return first === undefined ? 'aggregate_only:none' : first.metric
  }
  if (decision.kind === 'ineligible') return `ineligible:${decision.reason}`
  return `rejected:${decision.reason}`
}

const MODEL_ROLES = new Set(['main', 'small', 'embedding'])
const CONTEXT_TYPES = new Set(['dm', 'group'])

export const controlledModelRoleOf = (modelRole: string): 'main' | 'small' | 'embedding' | null =>
  modelRole === 'main' || modelRole === 'small' || modelRole === 'embedding' ? modelRole : null

export type BackfillAggregateDimensions = Readonly<{
  platform: 'all'
  context_type: string
  actor_role: 'all'
  task_provider: 'all'
  app_version: 'all'
}>

export const backfillAggregateDimensions = (contextType: string): BackfillAggregateDimensions => ({
  platform: 'all',
  context_type: contextType,
  actor_role: 'all',
  task_provider: 'all',
  app_version: 'all',
})

export const backfillAggregateCellKey = (
  utcDay: string,
  dimensions: BackfillAggregateDimensions,
  metric: string,
): string => `${utcDay}|${JSON.stringify(dimensions)}|${metric}`

const counter = (
  metric: 'llm_completed' | 'llm_failed' | 'tool_semantic_success' | 'tool_failed',
): BackfillDecision => ({
  kind: 'aggregate_only',
  increments: [{ kind: 'counter', metric, delta: 1 }],
})

const rejected = (reason: NormalizationRejectionReason): BackfillDecision => ({ kind: 'rejected', reason })

const nullableNonNegative = (value: number | null): boolean => value === null || nonNegativeInt(value) !== null

const allNonNegative = (values: readonly number[]): boolean => values.every((value) => nonNegativeInt(value) !== null)

export const decideLlmBackfillRow = (row: LlmUsageEventRow): BackfillDecision => {
  if (row.eventId.length === 0 || row.storageContextId.length === 0 || row.chatUserId.length === 0) {
    return rejected('missing_context')
  }
  if (
    nonNegativeInt(row.occurredAt) === null ||
    nonNegativeInt(row.durationMs) === null ||
    !nullableNonNegative(row.inputTokens) ||
    !nullableNonNegative(row.outputTokens) ||
    !allNonNegative([row.stepCount, row.toolCallCount, row.messageCount])
  ) {
    return rejected('invalid_value')
  }
  if (!MODEL_ROLES.has(row.modelRole) || !CONTEXT_TYPES.has(row.contextType)) {
    return rejected('unknown_enum')
  }
  return counter(row.error === null ? 'llm_completed' : 'llm_failed')
}

const nullableBooleanInt = (value: number | null): boolean => value === null || value === 0 || value === 1

export const decideToolBackfillRow = (row: ToolCallEventRow): BackfillDecision => {
  if (
    row.eventId.length === 0 ||
    row.turnId.length === 0 ||
    row.storageContextId.length === 0 ||
    row.chatUserId.length === 0 ||
    row.toolName.length === 0 ||
    row.toolCallId.length === 0
  ) {
    return rejected('missing_context')
  }
  if (
    nonNegativeInt(row.occurredAt) === null ||
    !nullableNonNegative(row.durationMs) ||
    (row.success !== 0 && row.success !== 1) ||
    !nullableBooleanInt(row.retryable) ||
    !nullableBooleanInt(row.recovered)
  ) {
    return rejected('invalid_value')
  }
  if (!MODEL_ROLES.has(row.modelRole) || !CONTEXT_TYPES.has(row.contextType)) {
    return rejected('unknown_enum')
  }
  return counter(row.success === 1 ? 'tool_semantic_success' : 'tool_failed')
}
