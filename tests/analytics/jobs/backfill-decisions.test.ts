// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  backfillAggregateCellKey,
  backfillAggregateDimensions,
  decisionNameOf,
  decideLlmBackfillRow,
  decideToolBackfillRow,
  deriveBackfillSourceRef,
  sourceEventTypeForTable,
} from '../../../src/analytics/jobs/backfill-decisions.js'
import type { LlmUsageEventRow } from '../../../src/db/llm-usage-events-schema.js'
import type { ToolCallEventRow } from '../../../src/db/tool-call-events-schema.js'

const KEY = Buffer.alloc(32, 3)

const llmRow = (over: Partial<LlmUsageEventRow>): LlmUsageEventRow => ({
  eventId: 'e-1',
  occurredAt: 1000,
  turnId: null,
  storageContextId: 'sc',
  contextType: 'dm',
  chatUserId: 'u',
  model: 'm',
  modelRole: 'main',
  inputTokens: 1,
  outputTokens: 1,
  stepCount: 0,
  toolCallCount: 0,
  messageCount: 0,
  finishReason: null,
  durationMs: 1,
  responseId: null,
  error: null,
  forwardedAt: null,
  forwardAttempts: 0,
  forwardError: null,
  ...over,
})

const toolRow = (over: Partial<ToolCallEventRow>): ToolCallEventRow => ({
  eventId: 'e-1',
  turnId: 't',
  occurredAt: 1000,
  storageContextId: 'sc',
  contextType: 'dm',
  chatUserId: 'u',
  model: 'm',
  modelRole: 'main',
  toolName: 'create_task',
  toolCallId: 'c',
  success: 1,
  durationMs: 1,
  errorType: null,
  errorCode: null,
  retryable: null,
  recovered: null,
  argsBytes: null,
  resultBytes: null,
  responseId: null,
  forwardedAt: null,
  forwardAttempts: 0,
  forwardError: null,
  ...over,
})

describe('backfill decision helpers', () => {
  test('source event types map to durable tables', () => {
    expect(sourceEventTypeForTable('llm_usage_events')).toBe('llm_usage_event')
    expect(sourceEventTypeForTable('tool_call_events')).toBe('tool_call_event')
  })

  test('decision names are stable and bounded', () => {
    const decision = decideLlmBackfillRow(llmRow({}))
    expect(decisionNameOf(decision)).toBe('llm_completed')
    expect(decisionNameOf(decideLlmBackfillRow(llmRow({ error: 'x' })))).toBe('llm_failed')
    expect(decisionNameOf(decideLlmBackfillRow(llmRow({ modelRole: 'huge' })))).toBe('rejected:unknown_enum')
    expect(decisionNameOf(decideToolBackfillRow(toolRow({})))).toBe('tool_semantic_success')
  })

  test('source refs are deterministic HMAC pseudonyms', () => {
    const input = {
      key: KEY,
      keyVersion: 'v1',
      sourceTable: 'llm_usage_events',
      sourceEventId: 'e-1',
      decisionName: 'llm_completed',
    }
    expect(deriveBackfillSourceRef(input)).toBe(deriveBackfillSourceRef(input))
    expect(deriveBackfillSourceRef({ ...input, sourceTable: 'tool_call_events' })).not.toBe(
      deriveBackfillSourceRef(input),
    )
  })

  test('aggregate cell keys use all-dimensions for absent envelope facts', () => {
    const dims = backfillAggregateDimensions('dm')
    expect(dims).toEqual({
      platform: 'all',
      context_type: 'dm',
      actor_role: 'all',
      task_provider: 'all',
      app_version: 'all',
    })
    expect(backfillAggregateCellKey('2023-11-14', dims, 'llm_completed')).toContain('2023-11-14|')
  })
})
