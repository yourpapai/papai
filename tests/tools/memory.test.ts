// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { listMemoryRecords, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import {
  makeForgetMemoryTool,
  makeListMemoryTool,
  makeRememberMemoryTool,
  makeSearchMemoryTool,
} from '../../src/tools/memory.js'
import { getToolExecutor, setupTestDb } from '../utils/test-helpers.js'

const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-existing',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'The release checklist includes a customer announcement.',
  summary: null,
  tags: ['release'],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-06-12T00:00:00.000Z',
  updatedAt: '2026-06-12T00:00:00.000Z',
  lastSeenAt: '2026-06-12T00:00:00.000Z',
  ...overrides,
})

type MemoryRecordsResult = Readonly<{
  records: readonly Readonly<{ id: string; content: string; kind: string; status: string }>[]
}>

type SavedMemoryResult = Readonly<{
  status: 'saved'
  id: string
  kind: string
}>

function assertMemoryRecordsResult(value: unknown): asserts value is MemoryRecordsResult {
  if (typeof value !== 'object' || value === null || !('records' in value)) {
    throw new Error('Expected memory records result')
  }
}

function assertSavedMemoryResult(value: unknown): asserts value is SavedMemoryResult {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    throw new Error('Expected saved memory result')
  }
}

describe('memory tools', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('remember_memory writes an explicit active memory without echoing content', async () => {
    const tool = makeRememberMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })

    const result = await getToolExecutor(tool)({
      content: 'User prefers release summaries grouped by customer impact.',
      kind: 'preference',
      tags: ['release', 'writing'],
    })

    assertSavedMemoryResult(result)
    expect(result).toMatchObject({ status: 'saved', kind: 'preference' })
    expect(result.id.length).toBeGreaterThan(0)
    expect('content' in result).toBe(false)
    const records = listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active' })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'preference',
      content: 'User prefers release summaries grouped by customer impact.',
      tags: ['release', 'writing'],
      source: 'explicit',
      status: 'active',
    })
  })

  test('search_memory returns active scoped keyword matches', async () => {
    saveMemoryRecord(
      memoryRecordInput({ id: 'mem-user-match', scopeId: 'user-1', content: 'Use concise release notes.' }),
    )
    saveMemoryRecord(
      memoryRecordInput({ id: 'mem-other-scope', scopeId: 'user-2', content: 'Use concise release notes.' }),
    )
    saveMemoryRecord(
      memoryRecordInput({ id: 'mem-stale', scopeId: 'user-1', content: 'Concise old notes.', status: 'stale' }),
    )
    const tool = makeSearchMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })

    const result = await getToolExecutor(tool)({ query: 'concise' })

    expect(result).toMatchObject({ mode: 'keyword' })
    assertMemoryRecordsResult(result)
    expect(result.records.map((record) => record.id)).toEqual(['mem-user-match'])
  })

  test('list_memory omits archived records by default', async () => {
    saveMemoryRecord(memoryRecordInput({ id: 'mem-active', scopeId: 'user-1', content: 'Active memory' }))
    saveMemoryRecord(
      memoryRecordInput({ id: 'mem-archived', scopeId: 'user-1', content: 'Archived memory', status: 'archived' }),
    )
    const tool = makeListMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })

    const result = await getToolExecutor(tool)({})

    assertMemoryRecordsResult(result)
    expect(result.records.map((record) => record.id)).toEqual(['mem-active'])
  })

  test('forget_memory archives a memory by id in the current scope', async () => {
    saveMemoryRecord(memoryRecordInput({ id: 'mem-target', scopeId: 'user-1' }))
    const tool = makeForgetMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })

    const result = await getToolExecutor(tool)({ memory_id: 'mem-target' })

    expect(result).toEqual({ status: 'forgotten', id: 'mem-target' })
    expect(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active' })).toEqual([])
    expect(
      listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'archived' }).map((r) => r.id),
    ).toEqual(['mem-target'])
  })

  test('forget_memory archives a query match only in the current scope', async () => {
    saveMemoryRecord(memoryRecordInput({ id: 'mem-personal', scopeId: 'shared', scopeType: 'personal' }))
    saveMemoryRecord(memoryRecordInput({ id: 'mem-group', scopeId: 'shared', scopeType: 'group' }))
    const tool = makeForgetMemoryTool({ storageContextId: 'shared', contextType: 'dm' })

    const result = await getToolExecutor(tool)({ query: 'release checklist' })

    expect(result).toEqual({ status: 'forgotten', id: 'mem-personal' })
    expect(listMemoryRecords({ scopeId: 'shared', scopeType: 'personal', status: 'active' })).toEqual([])
    expect(listMemoryRecords({ scopeId: 'shared', scopeType: 'group', status: 'active' }).map((r) => r.id)).toEqual([
      'mem-group',
    ])
  })

  test('group thread context writes and searches parent group memory scope', async () => {
    const parentContextId = toScopedContextId({ platformInstanceId: 'telegram-main', nativeContextId: '-1001' })
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-main',
      nativeContextId: '-1001',
      threadId: '42',
    })
    const context = { storageContextId: threadContextId, contextType: 'group' as const }

    await getToolExecutor(makeRememberMemoryTool(context))({
      content: 'The group release captain is Dana.',
      kind: 'person_context',
      tags: ['release'],
    })
    const search = await getToolExecutor(makeSearchMemoryTool(context))({ query: 'Dana' })

    assertMemoryRecordsResult(search)
    expect(search.records.map((record) => record.content)).toEqual(['The group release captain is Dana.'])
    expect(
      listMemoryRecords({ scopeId: parentContextId, scopeType: 'group', status: 'active' }).map((r) => r.content),
    ).toEqual(['The group release captain is Dana.'])
    expect(listMemoryRecords({ scopeId: threadContextId, scopeType: 'group', status: 'active' })).toEqual([])
  })
})
