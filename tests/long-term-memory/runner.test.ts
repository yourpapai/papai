// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'
import { runMemoryExtractionInBackground } from '../../src/long-term-memory/runner.js'
import {
  getMemoryProfile,
  listMemoryRecords,
  saveMemoryRecord,
  setMemoryCaptureEnabled,
} from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const history: readonly ModelMessage[] = [
  { role: 'user', content: 'Please remember that release notes go out on Fridays.' },
  { role: 'assistant', content: 'Noted.' },
]

const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-existing',
  scopeId: 'ctx-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'Old release note process.',
  summary: 'Old release notes',
  tags: ['release'],
  confidence: 0.5,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...overrides,
})

const patch: MemoryPatch = {
  profile: '## Team memory\n- Release notes go out on Fridays',
  records: [
    {
      kind: 'procedure',
      content: 'Release notes go out on Fridays.',
      summary: 'Friday release notes',
      tags: ['release'],
      confidence: 0.88,
      source: 'background',
      evidence: {
        messageIds: ['m-1'],
        timestamps: ['2026-06-12T00:00:00.000Z'],
        contextId: 'ctx-1',
      },
    },
  ],
  updates: [{ id: 'mem-existing', status: 'stale', content: 'Updated release note process.', confidence: 0.7 }],
}

describe('runMemoryExtractionInBackground', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('applies generated patch to normalized scope', async () => {
    saveMemoryRecord(memoryRecordInput({ id: 'mem-existing', scopeId: 'ctx-1', scopeType: 'personal' }))

    await runMemoryExtractionInBackground({
      storageContextId: 'ctx-1',
      configContextId: 'cfg-1',
      contextType: 'dm',
      history,
      deps: {
        extractMemoryPatch: () => Promise.resolve(patch),
        now: () => '2026-06-12T00:00:00.000Z',
        randomUUID: () => 'mem-new',
      },
    })

    expect(getMemoryProfile({ scopeId: 'ctx-1', scopeType: 'personal' })?.profile).toBe(
      '## Team memory\n- Release notes go out on Fridays',
    )
    expect(
      listMemoryRecords({ scopeId: 'ctx-1', scopeType: 'personal' })
        .map((record) => record.id)
        .sort(),
    ).toEqual(['mem-existing', 'mem-new'])
    const updated = listMemoryRecords({ scopeId: 'ctx-1', scopeType: 'personal' }).find(
      (record) => record.id === 'mem-existing',
    )
    expect(updated?.status).toBe('stale')
    expect(updated?.content).toBe('Updated release note process.')
    expect(updated?.confidence).toBe(0.7)
  })

  test('stores background source and canonical timestamps for extracted records', async () => {
    const extractedPatch: MemoryPatch = {
      profile: null,
      records: [
        {
          kind: 'fact',
          content: 'Release notes expire after launch.',
          summary: null,
          tags: [],
          confidence: 0.8,
          source: 'background',
          evidence: {},
          expiresAt: '2026-06-13T00:00:00Z',
          validFrom: 'not-a-date',
        },
      ],
      updates: [],
    }
    await runMemoryExtractionInBackground({
      storageContextId: 'ctx-1',
      configContextId: 'cfg-1',
      contextType: 'dm',
      history,
      deps: {
        extractMemoryPatch: () => Promise.resolve(extractedPatch),
        now: () => '2026-06-12T00:00:00.000Z',
        randomUUID: () => 'mem-sanitized',
      },
    })

    const [record] = listMemoryRecords({ scopeId: 'ctx-1', scopeType: 'personal' })
    expect(record?.source).toBe('background')
    expect(record?.expiresAt).toBe('2026-06-13T00:00:00.000Z')
    expect(record?.validFrom).toBeNull()
  })

  test('respects disabled profile and skips extraction', async () => {
    setMemoryCaptureEnabled({ scopeId: 'ctx-disabled', scopeType: 'personal' }, false, '2026-06-12T00:00:00.000Z')
    let calls = 0

    await runMemoryExtractionInBackground({
      storageContextId: 'ctx-disabled',
      configContextId: 'cfg-1',
      contextType: 'dm',
      history,
      deps: {
        extractMemoryPatch: () => {
          calls += 1
          return Promise.resolve(patch)
        },
      },
    })

    expect(calls).toBe(0)
    expect(listMemoryRecords({ scopeId: 'ctx-disabled', scopeType: 'personal' })).toEqual([])
  })

  test('in-flight guard prevents duplicate concurrent extraction for same normalized scope', async () => {
    let releaseFirst: (value: MemoryPatch) => void = () => {}
    const firstPatch = new Promise<MemoryPatch>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0

    const first = runMemoryExtractionInBackground({
      storageContextId: 'same-scope',
      configContextId: 'cfg-1',
      contextType: 'dm',
      history,
      deps: {
        extractMemoryPatch: () => {
          calls += 1
          return firstPatch
        },
        randomUUID: () => `mem-${calls}`,
      },
    })
    const second = runMemoryExtractionInBackground({
      storageContextId: 'same-scope',
      configContextId: 'cfg-1',
      contextType: 'dm',
      history,
      deps: {
        extractMemoryPatch: () => {
          calls += 1
          return Promise.resolve({ profile: null, records: [], updates: [] })
        },
      },
    })

    await second
    expect(calls).toBe(1)
    releaseFirst({ profile: null, records: [], updates: [] })
    await first
  })

  test('group thread context resolves to parent group scope', async () => {
    const parent = toScopedContextId({ platformInstanceId: 'telegram-main', nativeContextId: '-1001' })
    const thread = toScopedThreadContextId({
      platformInstanceId: 'telegram-main',
      nativeContextId: '-1001',
      threadId: '42',
    })

    await runMemoryExtractionInBackground({
      storageContextId: thread,
      configContextId: parent,
      contextType: 'group',
      history,
      deps: {
        extractMemoryPatch: () => Promise.resolve(patch),
        now: () => '2026-06-12T00:00:00.000Z',
        randomUUID: () => 'mem-group',
      },
    })

    expect(getMemoryProfile({ scopeId: parent, scopeType: 'group' })?.profile).toBe(
      '## Team memory\n- Release notes go out on Fridays',
    )
    expect(listMemoryRecords({ scopeId: parent, scopeType: 'group' }).map((record) => record.id)).toEqual(['mem-group'])
    expect(listMemoryRecords({ scopeId: thread, scopeType: 'group' })).toEqual([])
  })
})
