// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runMemoryCapture, type RunMemoryCaptureDeps } from '../../src/long-term-memory/capture.js'
import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'
import { sweepPromotions } from '../../src/long-term-memory/promotion-sweep.js'
import { evaluatePromotion } from '../../src/long-term-memory/promotion.js'
import { listMemoryRecords } from '../../src/long-term-memory/store.js'
import { makeRecallMemoryTool } from '../../src/tools/recall.js'
import { getToolExecutor, setupTestDb } from '../utils/test-helpers.js'

const fact = 'we deploy every friday'
const patch: MemoryPatch = {
  profile: null,
  records: [
    {
      kind: 'fact',
      content: fact,
      summary: null,
      tags: [],
      confidence: 0.5,
      source: 'background',
      evidence: {},
    },
  ],
  updates: [],
}

let uid = 0

const captureDeps: RunMemoryCaptureDeps = {
  flagEnabled: (): boolean => true,
  extractMemoryPatch: (): Promise<MemoryPatch> => Promise.resolve(patch),
  getEmbedding: (): Promise<number[] | null> => Promise.resolve(null),
  now: (): string => '2026-06-16T00:00:00.000Z',
  randomUUID: (): string => `mem-${(uid += 1)}`,
}

type RecallRecord = Readonly<{ content: string; provenance: string }>
type RecallResult = Readonly<{ records: readonly RecallRecord[] }>

function assertRecallResult(value: unknown): asserts value is RecallResult {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('records' in value) ||
    !Array.isArray((value as { records: unknown }).records)
  ) {
    throw new Error('Expected recall result with records array')
  }
}

describe('acceptance: stop rediscovering across threads', () => {
  beforeEach(async () => {
    await setupTestDb()
    uid = 0
  })

  test('a fact captured in 3 short threads is promoted and recalled from a fresh thread', async () => {
    for (const thread of ['g:thread:a', 'g:thread:b', 'g:thread:c']) {
      await runMemoryCapture(
        {
          storageContextId: thread,
          configContextId: 'g',
          contextType: 'group',
          history: [{ role: 'user', content: fact }],
        },
        captureDeps,
      )
    }

    await sweepPromotions({
      listScopes: (): readonly [{ scopeId: string; scopeType: 'group' }] => [{ scopeId: 'g', scopeType: 'group' }],
      evaluate: (scope, candidate): Promise<boolean> =>
        evaluatePromotion(scope, candidate, {
          confirmDurable: (): Promise<boolean> => Promise.resolve(true),
          now: (): string => '2026-06-16T01:00:00.000Z',
        }),
    })

    const activeRecords = listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'active' })
    const promotedFact = activeRecords.find((r) => r.content === fact)
    expect(promotedFact).toBeDefined()

    const tool = makeRecallMemoryTool({ storageContextId: 'g:thread:z', contextType: 'group' })
    const rawResult = await getToolExecutor(tool)({ query: 'friday deploy' })
    assertRecallResult(rawResult)
    const groupRecord = rawResult.records.find((r) => r.content === fact)
    expect(groupRecord).toBeDefined()
    expect(groupRecord?.provenance).toBe('group')
  })
})
