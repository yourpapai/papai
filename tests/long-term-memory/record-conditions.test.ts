// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryRecords } from '../../src/db/schema.js'
import { recordScopeCondition, threadScopeCondition } from '../../src/long-term-memory/record-conditions.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const scope: MemoryScope = { scopeId: 'group-1', scopeType: 'group' }

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
  kind: 'fact',
  content: 'Deploys happen on Fridays.',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...overrides,
})

describe('recordScopeCondition', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('matches the record with the given id inside the scope', () => {
    saveMemoryRecord(record({ id: 'wanted' }))
    saveMemoryRecord(record({ id: 'other' }))

    const rows = getDrizzleDb().select().from(memoryRecords).where(recordScopeCondition(scope, 'wanted')).all()

    expect(rows.map((row) => row.id)).toEqual(['wanted'])
  })

  test('does not match a record id from a different scope', () => {
    saveMemoryRecord(record({ id: 'wanted' }))

    const rows = getDrizzleDb()
      .select()
      .from(memoryRecords)
      .where(recordScopeCondition({ scopeId: 'group-2', scopeType: 'group' }, 'wanted'))
      .all()

    expect(rows).toEqual([])
  })
})

describe('threadScopeCondition', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns undefined when neither field is set', () => {
    expect(threadScopeCondition({})).toBeUndefined()
  })

  test('only threadContextId set matches just that thread', () => {
    saveMemoryRecord(record({ id: 'thread-a', threadContextId: 'thread-a' }))
    saveMemoryRecord(record({ id: 'thread-b', threadContextId: 'thread-b' }))
    saveMemoryRecord(record({ id: 'no-thread', threadContextId: null }))

    const rows = getDrizzleDb()
      .select()
      .from(memoryRecords)
      .where(threadScopeCondition({ threadContextId: 'thread-a' }))
      .all()

    expect(rows.map((row) => row.id)).toEqual(['thread-a'])
  })

  test('only excludeThreadContextId set matches every other thread plus null threads', () => {
    saveMemoryRecord(record({ id: 'thread-a', threadContextId: 'thread-a' }))
    saveMemoryRecord(record({ id: 'thread-b', threadContextId: 'thread-b' }))
    saveMemoryRecord(record({ id: 'no-thread', threadContextId: null }))

    const rows = getDrizzleDb()
      .select()
      .from(memoryRecords)
      .where(threadScopeCondition({ excludeThreadContextId: 'thread-a' }))
      .all()

    expect(rows.map((row) => row.id).sort()).toEqual(['no-thread', 'thread-b'])
  })

  test('both fields set AND the two constraints together (regression: must exclude even when threadContextId matches)', () => {
    // threadContextId narrows to 'thread-a'; excludeThreadContextId also excludes 'thread-a'.
    // The only correct outcome under AND semantics is zero rows: nothing can equal 'thread-a'
    // and simultaneously not-equal (or null) 'thread-a'. An early-return implementation that
    // silently drops excludeThreadContextId would incorrectly return the 'thread-a' row.
    saveMemoryRecord(record({ id: 'thread-a', threadContextId: 'thread-a' }))
    saveMemoryRecord(record({ id: 'thread-b', threadContextId: 'thread-b' }))
    saveMemoryRecord(record({ id: 'no-thread', threadContextId: null }))

    const rows = getDrizzleDb()
      .select()
      .from(memoryRecords)
      .where(threadScopeCondition({ threadContextId: 'thread-a', excludeThreadContextId: 'thread-a' }))
      .all()

    expect(rows).toEqual([])
  })
})
