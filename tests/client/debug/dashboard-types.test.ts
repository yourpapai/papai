// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type {
  AdminLlmSnapshot,
  BillingDetail,
  BillingSubject,
  BillingWindow,
  Fact,
  Instruction,
  Session,
} from '../../../client/debug/dashboard-types.js'

describe('dashboard-types', () => {
  test('Fact type is usable', () => {
    const fact: Fact = {
      identifier: 'test-123',
      title: 'Test Fact',
      url: 'https://example.com',
      lastSeen: '2024-01-15T10:30:00.000Z',
    }
    expect(fact.identifier).toBe('test-123')
  })

  test('Instruction type is usable', () => {
    const instruction: Instruction = {
      id: 'inst-1',
      text: 'Be helpful',
      createdAt: '2024-01-15T10:00:00.000Z',
    }
    expect(instruction.text).toBe('Be helpful')
  })

  test('BillingWindow type accepts the four whitelisted values', () => {
    const windows: BillingWindow[] = ['24h', '7d', '30d', 'all']
    expect(windows).toHaveLength(4)
  })

  test('BillingSubject type carries display name and per-role totals', () => {
    const subject: BillingSubject = {
      storageContextId: 'user-A',
      contextType: 'dm',
      displayName: 'alice',
      totals: {
        main: { inputTokens: 10, outputTokens: 20, calls: 1 },
        small: { inputTokens: 0, outputTokens: 0, calls: 0 },
        embedding: { inputTokens: 5, outputTokens: 0, calls: 1 },
      },
      toolCalls: 0,
      lastActiveAt: 1_700_000_000_000,
    }
    expect(subject.displayName).toBe('alice')
    expect(subject.totals.main.calls).toBe(1)
  })

  test('BillingDetail type carries subject + requests + truncated', () => {
    const detail: BillingDetail = {
      subject: {
        storageContextId: 'user-A',
        contextType: 'dm',
        displayName: null,
        totals: {
          main: { inputTokens: 0, outputTokens: 0, calls: 0 },
          small: { inputTokens: 0, outputTokens: 0, calls: 0 },
          embedding: { inputTokens: 0, outputTokens: 0, calls: 0 },
        },
        toolCalls: 0,
        lastActiveAt: 0,
      },
      requests: [],
      truncated: false,
    }
    expect(detail.truncated).toBe(false)
  })

  test('AdminLlmSnapshot type covers all five system config keys', () => {
    const empty = { value: null, updatedAt: null, updatedBy: null }
    const snap: AdminLlmSnapshot = {
      llm_apikey: empty,
      llm_baseurl: empty,
      main_model: empty,
      small_model: empty,
      embedding_model: empty,
    }
    expect(snap.llm_apikey.value).toBeNull()
  })

  test('Session type includes full data fields', () => {
    const session: Session = {
      userId: 'user-123',
      lastAccessed: Date.now(),
      historyLength: 5,
      factsCount: 2,
      summary: 'Test summary',
      configKeys: ['key1'],
      workspaceId: 'ws-123',
      facts: [
        {
          identifier: 'fact-1',
          title: 'Fact One',
          url: 'https://example.com/fact',
          lastSeen: '2024-01-15T10:30:00.000Z',
        },
      ],
      config: { key1: 'value1' },
      hasTools: true,
      instructionsCount: 1,
      instructions: [{ id: 'inst-1', text: 'Be helpful', createdAt: '2024-01-15T10:00:00.000Z' }],
    }
    expect(session.userId).toBe('user-123')
    expect(session.facts).toHaveLength(1)
  })
})
