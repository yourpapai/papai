// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { saveMemoryRecord, listProvisionalRecords } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const provisional = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'group-1',
  scopeType: 'group',
  kind: 'fact',
  content: 'Deploys happen on Fridays.',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: { threads: ['thread-a'], contextId: 'thread-a' },
  threadContextId: 'thread-a',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...overrides,
})

describe('provisional record store', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('round-trips thread_context_id', () => {
    saveMemoryRecord(provisional({ id: 'mem-1' }))
    const rows = listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.threadContextId).toBe('thread-a')
    expect(rows[0]?.status).toBe('provisional')
  })

  test('filters by thread and excludes other statuses', () => {
    saveMemoryRecord(provisional({ id: 'mem-1', threadContextId: 'thread-a' }))
    saveMemoryRecord(provisional({ id: 'mem-2', threadContextId: 'thread-b' }))
    saveMemoryRecord(provisional({ id: 'mem-3', status: 'active', threadContextId: null, evidence: {} }))
    expect(
      listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group', threadContextId: 'thread-a' }),
    ).toHaveLength(1)
    expect(
      listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group', excludeThreadContextId: 'thread-a' }),
    ).toHaveLength(1)
    expect(listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group' })).toHaveLength(2)
  })
})
