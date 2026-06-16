// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { sweepDirtyContexts } from '../../src/long-term-memory/capture-sweep.js'
import { markActivity } from '../../src/long-term-memory/extraction-state.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('sweepDirtyContexts', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('runs capture for idle unextracted group contexts', async () => {
    markActivity(
      { contextId: 'g:thread:a', contextType: 'group', configContextId: 'g', historyLen: 3 },
      '2026-06-16T10:00:00.000Z',
    )
    const captured: string[] = []
    await sweepDirtyContexts('2026-06-16T10:20:00.000Z', {
      idleMs: 600_000,
      loadHistory: () => [{ role: 'user', content: 'hi' }],
      runCapture: (input) => {
        captured.push(input.storageContextId)
        return Promise.resolve()
      },
    })
    expect(captured).toEqual(['g:thread:a'])
  })
})
