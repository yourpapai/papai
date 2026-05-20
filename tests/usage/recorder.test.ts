// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { recordUsage, type UsageEvent } from '../../src/usage/recorder.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const validEvent = (overrides: Partial<UsageEvent> = {}): UsageEvent => ({
  occurredAt: 1_700_000_000_000,
  turnId: 'turn-1',
  storageContextId: 'ctx-1',
  contextType: 'dm',
  chatUserId: 'user-1',
  model: 'main-model',
  modelRole: 'main',
  inputTokens: 100,
  outputTokens: 200,
  stepCount: 1,
  toolCallCount: 0,
  messageCount: 3,
  finishReason: 'stop',
  durationMs: 1234,
  responseId: 'resp-1',
  error: null,
  ...overrides,
})

describe('recordUsage', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('inserts a fully populated row', () => {
    recordUsage(validEvent())

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.eventId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(row?.storageContextId).toBe('ctx-1')
    expect(row?.contextType).toBe('dm')
    expect(row?.chatUserId).toBe('user-1')
    expect(row?.model).toBe('main-model')
    expect(row?.modelRole).toBe('main')
    expect(row?.inputTokens).toBe(100)
    expect(row?.outputTokens).toBe(200)
    expect(row?.stepCount).toBe(1)
    expect(row?.toolCallCount).toBe(0)
    expect(row?.messageCount).toBe(3)
    expect(row?.finishReason).toBe('stop')
    expect(row?.durationMs).toBe(1234)
    expect(row?.responseId).toBe('resp-1')
    expect(row?.error).toBeNull()
    expect(row?.turnId).toBe('turn-1')
    expect(row?.occurredAt).toBe(1_700_000_000_000)
  })

  test('generates a unique event_id per call', () => {
    recordUsage(validEvent())
    recordUsage(validEvent())

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(2)
    expect(rows[0]?.eventId).not.toBe(rows[1]?.eventId)
  })

  test('accepts NULL tokens on a success row', () => {
    recordUsage(validEvent({ inputTokens: null, outputTokens: null }))

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.inputTokens).toBeNull()
    expect(row?.outputTokens).toBeNull()
    expect(row?.error).toBeNull()
  })

  test('persists an error string on the error row shape', () => {
    recordUsage(
      validEvent({
        inputTokens: null,
        outputTokens: null,
        responseId: null,
        finishReason: null,
        stepCount: 0,
        toolCallCount: 0,
        error: 'boom',
      }),
    )

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.error).toBe('boom')
    expect(row?.inputTokens).toBeNull()
    expect(row?.outputTokens).toBeNull()
    expect(row?.responseId).toBeNull()
    expect(row?.finishReason).toBeNull()
  })

  test('persists embedding-role rows with zeroed counts', () => {
    recordUsage(
      validEvent({
        modelRole: 'embedding',
        stepCount: 0,
        toolCallCount: 0,
        messageCount: 0,
        finishReason: null,
        responseId: null,
      }),
    )

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.modelRole).toBe('embedding')
    expect(row?.stepCount).toBe(0)
    expect(row?.toolCallCount).toBe(0)
    expect(row?.messageCount).toBe(0)
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
    const { recordUsage: freshRecord } = await import('../../src/usage/recorder.js')

    expect(() => {
      freshRecord(validEvent())
    }).not.toThrow()
  })
})
