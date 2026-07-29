// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryRecords } from '../../src/db/schema.js'
import { runMemoryMaintenance } from '../../src/long-term-memory/maintenance.js'
import { rowToRecord, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecord, MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-06-12T00:00:00.000Z'
const OLD_DECISION = '2026-02-01T00:00:00.000Z'
const RECENT = '2026-06-01T00:00:00.000Z'
const EXPIRED = '2026-06-11T23:59:59.000Z'
const PERSONAL_SCOPE: MemoryScope = { scopeId: 'user-memory', scopeType: 'personal' }
const GROUP_SCOPE: MemoryScope = { scopeId: 'group-memory', scopeType: 'group' }

const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-default',
  scopeId: PERSONAL_SCOPE.scopeId,
  scopeType: PERSONAL_SCOPE.scopeType,
  kind: 'decision',
  content: 'The team chose the lightweight implementation path.',
  summary: 'Lightweight path',
  tags: [],
  confidence: 0.8,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: RECENT,
  updatedAt: RECENT,
  lastSeenAt: RECENT,
  ...overrides,
})

// Reads the raw row directly, bypassing query-time validity filtering: this helper verifies
// the maintenance job's own writes (status/updatedAt), including on records whose expiresAt
// has already passed -- exactly the rows that recordValidityCondition now excludes from
// listMemoryRecords, so listMemoryRecords cannot be used here.
const recordById = (scope: MemoryScope, status: MemoryRecordInput['status'], id: string): MemoryRecord | null => {
  const row = getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.scopeId, scope.scopeId),
        eq(memoryRecords.scopeType, scope.scopeType),
        eq(memoryRecords.status, status),
        eq(memoryRecords.id, id),
      ),
    )
    .get()
  return row === undefined ? null : rowToRecord(row)
}

describe('long-term memory maintenance', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('marks old non-explicit active decisions stale and archives expired references', () => {
    saveMemoryRecord(
      memoryRecordInput({
        id: 'old-decision',
        lastSeenAt: OLD_DECISION,
        createdAt: OLD_DECISION,
        updatedAt: OLD_DECISION,
      }),
    )
    saveMemoryRecord(
      memoryRecordInput({
        id: 'expired-reference',
        kind: 'reference',
        lastSeenAt: RECENT,
        expiresAt: EXPIRED,
      }),
    )

    expect(runMemoryMaintenance(NOW)).toEqual({ staleMarked: 1, archived: 1 })

    expect(recordById(PERSONAL_SCOPE, 'stale', 'old-decision')).toMatchObject({
      id: 'old-decision',
      updatedAt: NOW,
    })
    expect(recordById(PERSONAL_SCOPE, 'archived', 'expired-reference')).toMatchObject({
      id: 'expired-reference',
      updatedAt: NOW,
    })
  })

  test('keeps old explicit records active', () => {
    saveMemoryRecord(
      memoryRecordInput({
        id: 'explicit-old',
        source: 'explicit',
        lastSeenAt: OLD_DECISION,
        createdAt: OLD_DECISION,
        updatedAt: OLD_DECISION,
      }),
    )

    expect(runMemoryMaintenance(NOW)).toEqual({ staleMarked: 0, archived: 0 })
    expect(recordById(PERSONAL_SCOPE, 'active', 'explicit-old')).toMatchObject({
      id: 'explicit-old',
      updatedAt: OLD_DECISION,
    })
  })

  test('keeps recent active records active', () => {
    saveMemoryRecord(memoryRecordInput({ id: 'recent-decision' }))

    expect(runMemoryMaintenance(NOW)).toEqual({ staleMarked: 0, archived: 0 })
    expect(recordById(PERSONAL_SCOPE, 'active', 'recent-decision')).toMatchObject({
      id: 'recent-decision',
      updatedAt: RECENT,
    })
  })

  test('does not count already archived expired records again', () => {
    saveMemoryRecord(
      memoryRecordInput({
        id: 'archived-expired',
        scopeId: GROUP_SCOPE.scopeId,
        scopeType: GROUP_SCOPE.scopeType,
        kind: 'reference',
        status: 'archived',
        expiresAt: EXPIRED,
      }),
    )

    expect(runMemoryMaintenance(NOW)).toEqual({ staleMarked: 0, archived: 0 })
    expect(recordById(GROUP_SCOPE, 'archived', 'archived-expired')).toMatchObject({
      id: 'archived-expired',
      updatedAt: RECENT,
    })
  })

  test('rejects invalid maintenance timestamps', () => {
    expect(() => runMemoryMaintenance('not-a-date')).toThrow('Invalid memory maintenance timestamp')
  })
})
