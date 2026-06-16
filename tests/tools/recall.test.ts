// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import { strict as assert } from 'node:assert'

import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { makeRecallMemoryTool } from '../../src/tools/recall.js'
import { getToolExecutor, setupTestDb } from '../utils/test-helpers.js'

const active = (id: string): MemoryRecordInput => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'friday deploys happen weekly',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'background',
  evidence: {},
  threadContextId: null,
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

type RecallResult = { mode: string; records: Array<{ id: string; provenance: string }> }

const isRecallResult = (v: unknown): v is RecallResult => typeof v === 'object' && v !== null && 'records' in v

describe('recall tool', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns records with provenance and public shape', async () => {
    saveMemoryRecord(active('a'))
    const tool = makeRecallMemoryTool({ storageContextId: 'g:thread:z', contextType: 'group' })
    const result = await getToolExecutor(tool)({ query: 'friday deploys' })
    assert.ok(isRecallResult(result))
    expect(result.mode).toBe('recall')
    expect(result.records[0]?.provenance).toBe('group')
    expect(result.records[0]).not.toHaveProperty('embedding')
    expect(result.records[0]).not.toHaveProperty('scopeId')
  })
})
