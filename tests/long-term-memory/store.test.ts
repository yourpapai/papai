// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  archiveMemoryRecord,
  clearMemoryScope,
  getMemoryProfile,
  listMemoryRecords,
  saveMemoryProfile,
  saveMemoryRecord,
  searchMemoryRecords,
} from '../../src/long-term-memory/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('long-term memory store', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('saves and loads a profile for one scope', () => {
    saveMemoryProfile(
      { scopeId: 'user-1', scopeType: 'personal' },
      '## Communication\n- Concise replies',
      '2026-06-11T00:00:00.000Z',
    )

    expect(getMemoryProfile({ scopeId: 'user-1', scopeType: 'personal' })).toEqual({
      scopeId: 'user-1',
      scopeType: 'personal',
      profile: '## Communication\n- Concise replies',
      enabled: true,
      version: 1,
      updatedAt: '2026-06-11T00:00:00.000Z',
    })
  })

  test('stores records and lists only requested scope/status', () => {
    saveMemoryRecord({
      id: 'mem-1',
      scopeId: 'group-1',
      scopeType: 'group',
      kind: 'decision',
      content: 'The group decided to release on Fridays.',
      summary: 'Friday releases',
      tags: ['release'],
      confidence: 0.9,
      status: 'active',
      source: 'background',
      evidence: { messageIds: ['m1'] },
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      lastSeenAt: '2026-06-11T00:00:00.000Z',
    })

    expect(listMemoryRecords({ scopeId: 'group-1', status: 'active' }).map((r) => r.id)).toEqual(['mem-1'])
    expect(listMemoryRecords({ scopeId: 'user-1', status: 'active' })).toEqual([])
  })

  test('searches active records with FTS', () => {
    saveMemoryRecord({
      id: 'mem-2',
      scopeId: 'user-1',
      scopeType: 'personal',
      kind: 'preference',
      content: 'User prefers concise implementation plans.',
      summary: 'Concise plans',
      tags: ['style'],
      confidence: 1,
      status: 'active',
      source: 'explicit',
      evidence: {},
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      lastSeenAt: '2026-06-11T00:00:00.000Z',
    })

    expect(searchMemoryRecords({ scopeId: 'user-1', query: 'concise', includeStale: false }).map((r) => r.id)).toEqual([
      'mem-2',
    ])
  })

  test('archives a record and clears a scope', () => {
    saveMemoryRecord({
      id: 'mem-3',
      scopeId: 'user-1',
      scopeType: 'personal',
      kind: 'reference',
      content: 'User shared a reusable setup link.',
      summary: null,
      tags: [],
      confidence: 0.7,
      status: 'active',
      source: 'explicit',
      evidence: {},
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      lastSeenAt: '2026-06-11T00:00:00.000Z',
    })

    expect(archiveMemoryRecord('user-1', 'mem-3', '2026-06-12T00:00:00.000Z')).toBe(true)
    expect(listMemoryRecords({ scopeId: 'user-1', status: 'active' })).toEqual([])
    expect(clearMemoryScope({ scopeId: 'user-1', scopeType: 'personal' })).toEqual({
      recordsDeleted: 1,
      profileDeleted: 0,
    })
  })
})
