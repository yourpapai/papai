// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { toolCallEvents } from '../../src/db/schema.js'
import { toolCallEventId } from '../../src/usage/event-id.js'
import {
  recordToolCall,
  type ToolCallClassification,
  type ToolCallEvent,
  updateToolCallClassification,
} from '../../src/usage/tool-call-recorder.js'
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
  responseId: 'resp-1',
  ...overrides,
})

describe('recordToolCall', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('inserts a row with the deterministic event_id', () => {
    recordToolCall(validEvent())

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.eventId).toBe(toolCallEventId('turn-1', 'call-1'))
    expect(rows[0]?.toolName).toBe('create_task')
    expect(rows[0]?.success).toBe(1)
    expect(rows[0]?.durationMs).toBe(42)
    expect(rows[0]?.argsBytes).toBe(100)
    expect(rows[0]?.resultBytes).toBe(200)
    expect(rows[0]?.responseId).toBe('resp-1')
    expect(rows[0]?.forwardAttempts).toBe(0)
    expect(rows[0]?.forwardedAt).toBeNull()
  })

  test('encodes success=false as 0', () => {
    recordToolCall(validEvent({ success: false, resultBytes: null }))

    const row = getDrizzleDb().select().from(toolCallEvents).all()[0]
    expect(row?.success).toBe(0)
    expect(row?.resultBytes).toBeNull()
  })

  test('idempotent — duplicate insert is dropped without throwing', () => {
    recordToolCall(validEvent({ turnId: 'turn-dup', toolCallId: 'call-dup' }))

    expect(() => {
      recordToolCall(validEvent({ turnId: 'turn-dup', toolCallId: 'call-dup' }))
    }).not.toThrow()

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(1)
  })

  test('accepts NULL durationMs / argsBytes / resultBytes', () => {
    recordToolCall(
      validEvent({
        durationMs: null,
        argsBytes: null,
        resultBytes: null,
        responseId: null,
      }),
    )

    const row = getDrizzleDb().select().from(toolCallEvents).all()[0]
    expect(row?.durationMs).toBeNull()
    expect(row?.argsBytes).toBeNull()
    expect(row?.resultBytes).toBeNull()
    expect(row?.responseId).toBeNull()
  })

  test('does not throw when the underlying insert fails', async () => {
    type RunStep = { run: () => never }
    type ValuesStep = { values: (input: unknown) => RunStep }
    type InsertStep = { insert: (table: unknown) => ValuesStep }
    const throwingDb: InsertStep = {
      insert: (): ValuesStep => ({
        values: (): RunStep => ({
          run: (): never => {
            throw new Error('simulated db failure')
          },
        }),
      }),
    }
    void mock.module('../../src/db/drizzle.js', () => ({
      getDrizzleDb: (): InsertStep => throwingDb,
    }))
    const { recordToolCall: freshRecord } = await import('../../src/usage/tool-call-recorder.js')

    expect(() => {
      freshRecord(validEvent({ turnId: 'turn-throw', toolCallId: 'call-throw' }))
    }).not.toThrow()
  })
})

const validClassification = (overrides: Partial<ToolCallClassification> = {}): ToolCallClassification => ({
  errorType: 'schema_validation',
  errorCode: 'INVALID_ARGS',
  retryable: false,
  recovered: false,
  ...overrides,
})

describe('updateToolCallClassification', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('updates the matching row in place', () => {
    recordToolCall(validEvent({ turnId: 'turn-c', toolCallId: 'call-c', success: false, resultBytes: null }))

    updateToolCallClassification('turn-c', 'call-c', validClassification())

    const row = getDrizzleDb().select().from(toolCallEvents).all()[0]
    expect(row?.errorType).toBe('schema_validation')
    expect(row?.errorCode).toBe('INVALID_ARGS')
    expect(row?.retryable).toBe(0)
    expect(row?.recovered).toBe(0)
  })

  test('encodes retryable=true and recovered=true as 1', () => {
    recordToolCall(validEvent({ turnId: 'turn-c2', toolCallId: 'call-c2', success: false, resultBytes: null }))

    updateToolCallClassification('turn-c2', 'call-c2', validClassification({ retryable: true, recovered: true }))

    const row = getDrizzleDb().select().from(toolCallEvents).all()[0]
    expect(row?.retryable).toBe(1)
    expect(row?.recovered).toBe(1)
  })

  test('encodes null retryable/recovered as NULL', () => {
    recordToolCall(validEvent({ turnId: 'turn-c3', toolCallId: 'call-c3', success: false, resultBytes: null }))

    updateToolCallClassification('turn-c3', 'call-c3', validClassification({ retryable: null, recovered: null }))

    const row = getDrizzleDb().select().from(toolCallEvents).all()[0]
    expect(row?.retryable).toBeNull()
    expect(row?.recovered).toBeNull()
  })

  test('does not throw when no matching row exists', () => {
    // No insert before the update.
    expect(() => {
      updateToolCallClassification('turn-missing', 'call-missing', validClassification())
    }).not.toThrow()

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    expect(rows).toHaveLength(0)
  })

  test('only updates the targeted (turnId, toolCallId) row', () => {
    recordToolCall(validEvent({ turnId: 'turn-A', toolCallId: 'call-A', success: false, resultBytes: null }))
    recordToolCall(validEvent({ turnId: 'turn-B', toolCallId: 'call-B', success: false, resultBytes: null }))

    updateToolCallClassification('turn-A', 'call-A', validClassification({ errorType: 'only-A' }))

    const rows = getDrizzleDb().select().from(toolCallEvents).all()
    const a = rows.find((r) => r.turnId === 'turn-A')
    const b = rows.find((r) => r.turnId === 'turn-B')
    expect(a?.errorType).toBe('only-A')
    expect(b?.errorType).toBeNull()
  })
})
