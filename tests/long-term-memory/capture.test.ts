// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runMemoryCapture } from '../../src/long-term-memory/capture.js'
import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'
import { purgeMemoryRecord } from '../../src/long-term-memory/purge.js'
import { resolveMemoryScope } from '../../src/long-term-memory/scope.js'
import { listProvisionalRecords, saveMemoryProfile, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const patch: MemoryPatch = {
  profile: null,
  records: [
    {
      kind: 'fact',
      content: 'Deploys happen on Fridays.',
      summary: null,
      tags: [],
      confidence: 0.5,
      source: 'background',
      evidence: {},
    },
  ],
  updates: [],
}

describe('runMemoryCapture', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('writes provisional records tagged with the current thread', async () => {
    await runMemoryCapture(
      {
        storageContextId: 'group-1:thread:abc',
        configContextId: 'group-1',
        contextType: 'group',
        history: [{ role: 'user', content: 'hi' }],
      },
      {
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => '2026-06-16T00:00:00.000Z',
        randomUUID: () => 'mem-new',
      },
    )
    const rows = listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.threadContextId).toBe('group-1:thread:abc')
    expect(rows[0]?.evidence.threads).toEqual(['group-1:thread:abc'])
    expect(rows[0]?.scopeType).toBe('group')
  })

  test('no-op for DM contexts', async () => {
    await runMemoryCapture(
      {
        storageContextId: 'user-1',
        configContextId: 'user-1',
        contextType: 'dm',
        history: [{ role: 'user', content: 'hi' }],
      },
      {
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => 'x',
        randomUUID: () => 'y',
      },
    )
    expect(listProvisionalRecords({ scopeId: 'user-1', scopeType: 'group' })).toHaveLength(0)
  })

  test('no-op for group context without thread segment', async () => {
    await runMemoryCapture(
      {
        storageContextId: 'group-1',
        configContextId: 'group-1',
        contextType: 'group',
        history: [{ role: 'user', content: 'hi' }],
      },
      {
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => 'x',
        randomUUID: () => 'y',
      },
    )
    expect(listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group' })).toHaveLength(0)
  })

  test('does not re-capture a tombstoned fact', async () => {
    const storageContextId = 'group-recap:thread:t1'
    const scope = resolveMemoryScope({ storageContextId, contextType: 'group' })
    insertTombstone(scope, 'The team ships on Fridays', '2026-07-24T00:00:00.000Z')

    await runMemoryCapture(
      { storageContextId, configContextId: 'group-recap', contextType: 'group', history: [] },
      {
        extractMemoryPatch: () =>
          Promise.resolve({
            profile: null,
            records: [
              {
                kind: 'fact',
                content: 'the team  SHIPS on fridays',
                summary: null,
                tags: [],
                confidence: 1,
                source: 'background',
                evidence: {},
              },
            ],
            updates: [],
          }),
        getEmbedding: () => Promise.resolve([1, 0, 0]),
        now: () => '2026-07-24T01:00:00.000Z',
        randomUUID: () => 'mem-recap',
      },
    )

    const records = listProvisionalRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType })
    expect(records.find((r) => r.id === 'mem-recap')).toBeUndefined()
  })
})

describe('runMemoryCapture profile contamination gate', () => {
  const STORAGE_CONTEXT_ID = 'group-gate:thread:t1'
  const scope: MemoryScope = { scopeId: 'group-gate', scopeType: 'group' }
  const PURGED_AT = '2026-07-25T12:00:00.000Z'

  const record = (id: string, content: string): MemoryRecordInput => ({
    id,
    scopeId: scope.scopeId,
    scopeType: scope.scopeType,
    kind: 'fact',
    content,
    summary: null,
    tags: [],
    confidence: 1,
    status: 'active',
    source: 'explicit',
    evidence: {},
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
  })

  const captureWithSpy = async (seen: string[]): Promise<void> => {
    await runMemoryCapture(
      {
        storageContextId: STORAGE_CONTEXT_ID,
        configContextId: 'group-gate',
        contextType: 'group',
        history: [{ role: 'user', content: 'hi' }],
      },
      {
        extractMemoryPatch: (input) => {
          seen.push(input.profile)
          return Promise.resolve({ profile: null, records: [], updates: [] })
        },
        getEmbedding: () => Promise.resolve(null),
        now: () => '2026-07-25T13:00:00.000Z',
        randomUUID: () => 'mem-gate',
      },
    )
  }

  beforeEach(async () => {
    await setupTestDb()
  })

  test('hands the extractor an empty profile after a purge contaminates it', async () => {
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record('mem-1', 'User lives in Berlin'))
    purgeMemoryRecord(scope, 'mem-1', PURGED_AT)

    const seen: string[] = []
    await captureWithSpy(seen)

    expect(seen).toEqual([''])
  })

  test('passes an uncontaminated profile through unchanged', async () => {
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')

    const seen: string[] = []
    await captureWithSpy(seen)

    expect(seen).toEqual(['User lives in Berlin'])
  })
})
