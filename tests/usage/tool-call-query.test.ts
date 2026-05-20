// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { listToolCallsForTurn, summarizeToolCallsBySubject } from '../../src/usage/query.js'
import { recordToolCall, type ToolCallEvent } from '../../src/usage/tool-call-recorder.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const validEvent = (overrides: Partial<ToolCallEvent> = {}): ToolCallEvent => ({
  turnId: 'turn-1',
  occurredAt: 1_700_000_000_000,
  storageContextId: 'ctx-1',
  contextType: 'dm',
  chatUserId: 'user-1',
  model: 'main-model',
  modelRole: 'main',
  toolName: 'create_task',
  toolCallId: 'call-1',
  success: true,
  durationMs: 42,
  argsBytes: 100,
  resultBytes: 200,
  responseId: null,
  ...overrides,
})

describe('listToolCallsForTurn', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty when no rows recorded', () => {
    expect(listToolCallsForTurn('turn-missing')).toEqual([])
  })

  test('returns only rows for the requested turn', () => {
    recordToolCall(validEvent({ turnId: 'turn-A', toolCallId: 'call-1', occurredAt: 1000 }))
    recordToolCall(validEvent({ turnId: 'turn-A', toolCallId: 'call-2', occurredAt: 2000 }))
    recordToolCall(validEvent({ turnId: 'turn-B', toolCallId: 'call-3', occurredAt: 3000 }))

    const rows = listToolCallsForTurn('turn-A')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.toolCallId).sort()).toEqual(['call-1', 'call-2'])
  })

  test('orders rows by occurred_at ascending', () => {
    recordToolCall(validEvent({ turnId: 'turn-O', toolCallId: 'late', occurredAt: 3000 }))
    recordToolCall(validEvent({ turnId: 'turn-O', toolCallId: 'early', occurredAt: 1000 }))
    recordToolCall(validEvent({ turnId: 'turn-O', toolCallId: 'mid', occurredAt: 2000 }))

    const rows = listToolCallsForTurn('turn-O')
    expect(rows.map((r) => r.toolCallId)).toEqual(['early', 'mid', 'late'])
  })

  test('decodes success integers to booleans', () => {
    recordToolCall(validEvent({ turnId: 'turn-bool', toolCallId: 'win', success: true }))
    recordToolCall(validEvent({ turnId: 'turn-bool', toolCallId: 'lose', success: false, resultBytes: null }))

    const rows = listToolCallsForTurn('turn-bool')
    const win = rows.find((r) => r.toolCallId === 'win')
    const lose = rows.find((r) => r.toolCallId === 'lose')
    expect(win?.success).toBe(true)
    expect(lose?.success).toBe(false)
  })

  test('decodes retryable/recovered NULLs as null booleans', () => {
    recordToolCall(validEvent({ turnId: 'turn-r', toolCallId: 'call-r', success: false, resultBytes: null }))

    const row = listToolCallsForTurn('turn-r')[0]
    expect(row?.retryable).toBeNull()
    expect(row?.recovered).toBeNull()
  })
})

describe('summarizeToolCallsBySubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty when no rows recorded', () => {
    expect(summarizeToolCallsBySubject(null)).toEqual([])
  })

  test('aggregates per storage_context_id', () => {
    recordToolCall(
      validEvent({
        turnId: 't1',
        toolCallId: 'c1',
        storageContextId: 'ctx-A',
        success: true,
        durationMs: 100,
        argsBytes: 10,
        resultBytes: 50,
      }),
    )
    recordToolCall(
      validEvent({
        turnId: 't2',
        toolCallId: 'c2',
        storageContextId: 'ctx-A',
        success: false,
        durationMs: 200,
        argsBytes: 20,
        resultBytes: null,
      }),
    )
    recordToolCall(
      validEvent({
        turnId: 't3',
        toolCallId: 'c3',
        storageContextId: 'ctx-B',
        success: true,
        durationMs: 50,
        argsBytes: 5,
        resultBytes: 25,
      }),
    )

    const result = summarizeToolCallsBySubject(null)
    expect(result).toHaveLength(2)

    const a = result.find((s) => s.storageContextId === 'ctx-A')
    expect(a?.totalCalls).toBe(2)
    expect(a?.successCalls).toBe(1)
    expect(a?.failureCalls).toBe(1)
    expect(a?.durationMsTotal).toBe(300)
    expect(a?.argsBytesTotal).toBe(30)
    expect(a?.resultBytesTotal).toBe(50)

    const b = result.find((s) => s.storageContextId === 'ctx-B')
    expect(b?.totalCalls).toBe(1)
    expect(b?.successCalls).toBe(1)
    expect(b?.failureCalls).toBe(0)
  })

  test('filters by windowMs against now', () => {
    const now = Date.now()
    recordToolCall(
      validEvent({
        turnId: 't-old',
        toolCallId: 'c-old',
        storageContextId: 'ctx-W',
        occurredAt: now - 10 * 24 * 3600 * 1000,
      }),
    )
    recordToolCall(
      validEvent({
        turnId: 't-new',
        toolCallId: 'c-new',
        storageContextId: 'ctx-W',
        occurredAt: now - 1000,
      }),
    )

    const recent = summarizeToolCallsBySubject(24 * 3600 * 1000)
    const subject = recent.find((s) => s.storageContextId === 'ctx-W')
    expect(subject?.totalCalls).toBe(1)
  })

  test('NULL byte sizes contribute 0 to the totals', () => {
    recordToolCall(
      validEvent({
        turnId: 't-null',
        toolCallId: 'c-null',
        storageContextId: 'ctx-N',
        argsBytes: null,
        resultBytes: null,
      }),
    )

    const subject = summarizeToolCallsBySubject(null).find((s) => s.storageContextId === 'ctx-N')
    expect(subject?.argsBytesTotal).toBe(0)
    expect(subject?.resultBytesTotal).toBe(0)
  })
})
