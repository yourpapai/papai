// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'
import { purgeMemoryRecord } from '../../src/long-term-memory/purge.js'
import {
  runMemoryExtractionInBackground,
  type ExtractMemoryPatchRunInput,
  type RunMemoryExtractionDeps,
} from '../../src/long-term-memory/runner.js'
import { getMemoryProfile, saveMemoryProfile, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const scope: MemoryScope = { scopeId: 'dm-reg', scopeType: 'personal' }
const NOW = '2026-07-25T12:00:00.000Z'

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

const emptyPatch: MemoryPatch = { profile: null, records: [], updates: [] }

const makeDeps = (
  overrides: Partial<RunMemoryExtractionDeps> & { onCall?: (input: ExtractMemoryPatchRunInput) => void } = {},
): Partial<RunMemoryExtractionDeps> => ({
  extractMemoryPatch: (input): Promise<MemoryPatch> => {
    overrides.onCall?.(input)
    return Promise.resolve(emptyPatch)
  },
  now: (): string => NOW,
  ...overrides,
})

describe('profile regeneration after contamination', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('the extractor is handed null instead of contaminated prose', async () => {
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record('mem-1', 'User lives in Berlin'))
    purgeMemoryRecord(scope, 'mem-1', NOW)

    const seen: (string | null)[] = []
    await runMemoryExtractionInBackground({
      storageContextId: scope.scopeId,
      configContextId: 'cfg-1',
      contextType: 'dm',
      history: [],
      deps: makeDeps({
        onCall: (input): void => {
          seen.push(input.profile)
        },
      }),
    })

    expect(seen).toEqual([null])
  })

  test('writing a new profile clears the contamination flag', async () => {
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record('mem-1', 'User lives in Berlin'))
    saveMemoryRecord(record('mem-2', 'User prefers dark mode'))
    purgeMemoryRecord(scope, 'mem-1', NOW)
    expect(getMemoryProfile(scope)?.contaminatedAt).toBe(NOW)

    await runMemoryExtractionInBackground({
      storageContextId: scope.scopeId,
      configContextId: 'cfg-1',
      contextType: 'dm',
      history: [],
      deps: makeDeps({
        extractMemoryPatch: () => Promise.resolve({ ...emptyPatch, profile: 'User prefers dark mode' }),
      }),
    })

    const profile = getMemoryProfile(scope)
    expect(profile?.contaminatedAt).toBeNull()
    expect(profile?.profile).toBe('User prefers dark mode')
  })

  test('fails closed: a throwing extractor leaves the profile suppressed', async () => {
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record('mem-1', 'User lives in Berlin'))
    purgeMemoryRecord(scope, 'mem-1', NOW)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runMemoryExtractionInBackground({
        storageContextId: scope.scopeId,
        configContextId: 'cfg-1',
        contextType: 'dm',
        history: [],
        deps: makeDeps({ extractMemoryPatch: () => Promise.reject(new Error('LLM unavailable')) }),
      })
      expect(getMemoryProfile(scope)?.contaminatedAt).toBe(NOW)
    }
  })
})
