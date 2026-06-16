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
    { kind: 'fact', content: 'x', summary: null, tags: [], confidence: 0.5, source: 'background', evidence: {} },
  ],
  updates: [],
}

describe('flag-off parity', () => {
  beforeEach(async () => {
    await setupTestDb()
  })
  test('no provisional rows are written when the flag is off', async () => {
    await runMemoryCapture(
      {
        storageContextId: 'g:thread:a',
        configContextId: 'g',
        contextType: 'group',
        history: [{ role: 'user', content: 'x' }],
      },
      {
        flagEnabled: () => false,
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => 'n',
        randomUUID: () => 'm',
      },
    )
    expect(listProvisionalRecords({ scopeId: 'g', scopeType: 'group' })).toHaveLength(0)
  })
})
