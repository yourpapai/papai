// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getSubjectDetail, listSubjects } from '../../src/usage/query.js'
import { recordUsage, type UsageEvent } from '../../src/usage/recorder.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const seed = (overrides: Partial<UsageEvent>): void => {
  recordUsage({
    occurredAt: 1_700_000_000_000,
    turnId: 'turn',
    storageContextId: 'ctx',
    contextType: 'dm',
    chatUserId: 'user',
    model: 'm',
    modelRole: 'main',
    inputTokens: 10,
    outputTokens: 20,
    stepCount: 1,
    toolCallCount: 0,
    messageCount: 1,
    finishReason: 'stop',
    durationMs: 100,
    responseId: 'resp',
    error: null,
    ...overrides,
  })
}

describe('listSubjects', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty when no rows recorded', () => {
    expect(listSubjects({ windowMs: null })).toEqual([])
  })

  test('groups by storage_context_id with per-role totals', () => {
    seed({ storageContextId: 'ctx-A', modelRole: 'main', inputTokens: 100, outputTokens: 200 })
    seed({ storageContextId: 'ctx-A', modelRole: 'main', inputTokens: 50, outputTokens: 80 })
    seed({ storageContextId: 'ctx-A', modelRole: 'small', inputTokens: 30, outputTokens: 40 })
    seed({ storageContextId: 'ctx-A', modelRole: 'embedding', inputTokens: 5, outputTokens: null })
    seed({ storageContextId: 'ctx-B', modelRole: 'main', inputTokens: 7, outputTokens: 9 })

    const result = listSubjects({ windowMs: null })
    expect(result).toHaveLength(2)

    const a = result.find((s) => s.storageContextId === 'ctx-A')
    expect(a).toBeDefined()
    expect(a?.totals.main).toEqual({ inputTokens: 150, outputTokens: 280, calls: 2 })
    expect(a?.totals.small).toEqual({ inputTokens: 30, outputTokens: 40, calls: 1 })
    expect(a?.totals.embedding).toEqual({ inputTokens: 5, outputTokens: 0, calls: 1 })

    const b = result.find((s) => s.storageContextId === 'ctx-B')
    expect(b?.totals.main).toEqual({ inputTokens: 7, outputTokens: 9, calls: 1 })
    expect(b?.totals.small).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0 })
    expect(b?.totals.embedding).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0 })
  })

  test('preserves contextType per subject', () => {
    seed({ storageContextId: 'ctx-dm', contextType: 'dm' })
    seed({ storageContextId: 'ctx-grp', contextType: 'group' })

    const result = listSubjects({ windowMs: null })
    expect(result.find((s) => s.storageContextId === 'ctx-dm')?.contextType).toBe('dm')
    expect(result.find((s) => s.storageContextId === 'ctx-grp')?.contextType).toBe('group')
  })

  test('sums tool_call_count across all roles for the subject', () => {
    seed({ storageContextId: 'ctx', modelRole: 'main', toolCallCount: 3 })
    seed({ storageContextId: 'ctx', modelRole: 'main', toolCallCount: 2 })
    seed({ storageContextId: 'ctx', modelRole: 'small', toolCallCount: 1 })

    const result = listSubjects({ windowMs: null })
    expect(result[0]?.toolCalls).toBe(6)
  })

  test('uses the max occurred_at as lastActiveAt', () => {
    seed({ storageContextId: 'ctx', occurredAt: 1_700_000_000_000 })
    seed({ storageContextId: 'ctx', occurredAt: 1_700_000_500_000 })
    seed({ storageContextId: 'ctx', occurredAt: 1_700_000_100_000 })

    const result = listSubjects({ windowMs: null })
    expect(result[0]?.lastActiveAt).toBe(1_700_000_500_000)
  })

  test('filters by windowMs against now', () => {
    const now = Date.now()
    seed({ storageContextId: 'ctx-old', occurredAt: now - 10 * 24 * 3600 * 1000 })
    seed({ storageContextId: 'ctx-recent', occurredAt: now - 1000 })

    const result = listSubjects({ windowMs: 24 * 3600 * 1000 })
    expect(result.map((s) => s.storageContextId)).toEqual(['ctx-recent'])
  })

  test('treats NULL input/output tokens as 0 in the sum', () => {
    seed({ storageContextId: 'ctx', modelRole: 'main', inputTokens: null, outputTokens: null })
    seed({ storageContextId: 'ctx', modelRole: 'main', inputTokens: 5, outputTokens: 7 })

    const result = listSubjects({ windowMs: null })
    expect(result[0]?.totals.main).toEqual({ inputTokens: 5, outputTokens: 7, calls: 2 })
  })
})

describe('getSubjectDetail', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty when no rows match the subject', () => {
    seed({ storageContextId: 'other' })
    expect(getSubjectDetail('missing', { windowMs: null })).toEqual([])
  })

  test('returns rows for the given storage_context_id, ordered by occurred_at desc', () => {
    seed({ storageContextId: 'ctx', occurredAt: 1000, turnId: 'turn-a', model: 'm', modelRole: 'main' })
    seed({ storageContextId: 'ctx', occurredAt: 3000, turnId: 'turn-c', model: 'm', modelRole: 'small' })
    seed({ storageContextId: 'ctx', occurredAt: 2000, turnId: 'turn-b', model: 'm', modelRole: 'main' })
    seed({ storageContextId: 'other', occurredAt: 4000, turnId: 'turn-other' })

    const rows = getSubjectDetail('ctx', { windowMs: null })
    expect(rows.map((r) => r.turnId)).toEqual(['turn-c', 'turn-b', 'turn-a'])
  })

  test('shape matches RequestRow', () => {
    seed({
      storageContextId: 'ctx',
      occurredAt: 1_700_000_000_000,
      turnId: 'turn',
      chatUserId: 'user',
      model: 'main-model',
      modelRole: 'main',
      inputTokens: 100,
      outputTokens: 200,
      stepCount: 1,
      toolCallCount: 0,
      messageCount: 3,
      durationMs: 1234,
      finishReason: 'stop',
      error: null,
    })

    const row = getSubjectDetail('ctx', { windowMs: null })[0]
    expect(row).toBeDefined()
    expect(row?.eventId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(row?.occurredAt).toBe(1_700_000_000_000)
    expect(row?.turnId).toBe('turn')
    expect(row?.chatUserId).toBe('user')
    expect(row?.model).toBe('main-model')
    expect(row?.modelRole).toBe('main')
    expect(row?.inputTokens).toBe(100)
    expect(row?.outputTokens).toBe(200)
    expect(row?.stepCount).toBe(1)
    expect(row?.toolCallCount).toBe(0)
    expect(row?.messageCount).toBe(3)
    expect(row?.durationMs).toBe(1234)
    expect(row?.finishReason).toBe('stop')
    expect(row?.error).toBeNull()
  })

  test('filters by windowMs', () => {
    const now = Date.now()
    seed({ storageContextId: 'ctx', occurredAt: now - 10 * 24 * 3600 * 1000, turnId: 'old' })
    seed({ storageContextId: 'ctx', occurredAt: now - 1000, turnId: 'recent' })

    const rows = getSubjectDetail('ctx', { windowMs: 24 * 3600 * 1000 })
    expect(rows.map((r) => r.turnId)).toEqual(['recent'])
  })
})
