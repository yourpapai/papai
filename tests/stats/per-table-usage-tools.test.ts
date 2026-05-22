// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents, toolCallEvents } from '../../src/db/schema.js'
import { llmUsageForSubject, toolCallsForSubject } from '../../src/stats/per-table-usage.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('llmUsageForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero-shape when subject has no events', () => {
    expect(llmUsageForSubject('nobody')).toEqual({ rowCount: 0, inputTokensTotal: 0, outputTokensTotal: 0 })
  })

  test('aggregates row count and token totals across events', () => {
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'e1',
          occurredAt: 1000,
          storageContextId: 'u1',
          contextType: 'dm',
          chatUserId: 'u1',
          model: 'm',
          modelRole: 'main',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 10,
        },
        {
          eventId: 'e2',
          occurredAt: 2000,
          storageContextId: 'u1',
          contextType: 'dm',
          chatUserId: 'u1',
          model: 'm',
          modelRole: 'small',
          inputTokens: 20,
          outputTokens: 10,
          durationMs: 10,
        },
        {
          eventId: 'e3',
          occurredAt: 3000,
          storageContextId: 'u1',
          contextType: 'dm',
          chatUserId: 'u1',
          model: 'm',
          modelRole: 'main',
          inputTokens: null,
          outputTokens: null,
          durationMs: 10,
        },
        {
          eventId: 'e4',
          occurredAt: 1000,
          storageContextId: 'other',
          contextType: 'dm',
          chatUserId: 'other',
          model: 'm',
          modelRole: 'main',
          inputTokens: 9999,
          outputTokens: 9999,
          durationMs: 10,
        },
      ])
      .run()

    const result = llmUsageForSubject('u1')

    expect(result.rowCount).toBe(3)
    expect(result.inputTokensTotal).toBe(120)
    expect(result.outputTokensTotal).toBe(60)
  })
})

describe('toolCallsForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero-shape when subject has no tool-call events', () => {
    expect(toolCallsForSubject('nobody')).toEqual({
      total: 0,
      success: 0,
      failure: 0,
      topTools: [],
      errorTypeCounts: {},
    })
  })

  test('aggregates total, success/failure, top tools and error type counts', () => {
    const base = {
      turnId: 't',
      contextType: 'dm',
      chatUserId: 'u1',
      model: 'm',
      modelRole: 'main',
      toolCallId: 'tc',
    } as const

    getDrizzleDb()
      .insert(toolCallEvents)
      .values([
        { eventId: 't1', storageContextId: 'u1', occurredAt: 1, toolName: 'search_tasks', success: 1, ...base },
        { eventId: 't2', storageContextId: 'u1', occurredAt: 2, toolName: 'search_tasks', success: 1, ...base },
        { eventId: 't3', storageContextId: 'u1', occurredAt: 3, toolName: 'search_tasks', success: 1, ...base },
        {
          eventId: 't4',
          storageContextId: 'u1',
          occurredAt: 4,
          toolName: 'create_task',
          success: 0,
          errorType: 'network',
          ...base,
        },
        {
          eventId: 't5',
          storageContextId: 'u1',
          occurredAt: 5,
          toolName: 'create_task',
          success: 0,
          errorType: 'network',
          ...base,
        },
        {
          eventId: 't6',
          storageContextId: 'u1',
          occurredAt: 6,
          toolName: 'get_task',
          success: 0,
          errorType: 'provider',
          ...base,
        },
        { eventId: 't7', storageContextId: 'other', occurredAt: 7, toolName: 'leak', success: 1, ...base },
      ])
      .run()

    const result = toolCallsForSubject('u1')

    expect(result.total).toBe(6)
    expect(result.success).toBe(3)
    expect(result.failure).toBe(3)
    expect(result.topTools[0]?.toolName).toBe('search_tasks')
    expect(result.topTools[0]?.count).toBe(3)
    expect(result.errorTypeCounts).toEqual({ network: 2, provider: 1 })
  })
})
