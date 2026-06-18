// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runMemoryCapture } from '../../src/long-term-memory/capture.js'
import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'
import { listProvisionalRecords } from '../../src/long-term-memory/store.js'
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
})
