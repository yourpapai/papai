// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type {
  ContextType,
  ModelRole,
  RequestRow,
  SubjectRoleTotals,
  SubjectSummary,
  UsageWindow,
} from '../../src/usage/types.js'

describe('usage types', () => {
  test('ModelRole accepts valid values', () => {
    const roles: ModelRole[] = ['main', 'small', 'embedding']
    expect(roles).toHaveLength(3)
  })

  test('ContextType accepts valid values', () => {
    const types: ContextType[] = ['dm', 'group']
    expect(types).toHaveLength(2)
  })

  test('UsageWindow shape', () => {
    const w: UsageWindow = { windowMs: null }
    expect(w.windowMs).toBeNull()
  })

  test('SubjectRoleTotals shape', () => {
    const t: SubjectRoleTotals = { inputTokens: 1, outputTokens: 2, calls: 3 }
    expect(t.calls).toBe(3)
  })

  test('SubjectSummary shape', () => {
    const s: SubjectSummary = {
      storageContextId: 'ctx',
      contextType: 'dm',
      totals: {
        main: { inputTokens: 0, outputTokens: 0, calls: 0 },
        small: { inputTokens: 0, outputTokens: 0, calls: 0 },
        embedding: { inputTokens: 0, outputTokens: 0, calls: 0 },
      },
      toolCalls: 0,
      lastActiveAt: 0,
    }
    expect(s.storageContextId).toBe('ctx')
  })

  test('RequestRow shape', () => {
    const r: RequestRow = {
      eventId: 'e1',
      occurredAt: 0,
      turnId: null,
      chatUserId: 'u',
      model: 'm',
      modelRole: 'main',
      inputTokens: null,
      outputTokens: null,
      stepCount: 0,
      toolCallCount: 0,
      messageCount: 0,
      durationMs: 0,
      finishReason: null,
      error: null,
    }
    expect(r.eventId).toBe('e1')
  })
})
