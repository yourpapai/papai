// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { markActivity, markExtracted, listDirtyContexts } from '../../src/long-term-memory/extraction-state.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('extraction-state watermarks', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('a context with newer activity than extraction is dirty once idle', () => {
    markActivity(
      { contextId: 'c1', contextType: 'group', configContextId: 'cfg1', historyLen: 4 },
      '2026-06-16T10:00:00.000Z',
    )
    expect(listDirtyContexts('2026-06-16T10:10:00.000Z').map((c) => c.contextId)).toEqual(['c1'])
    markExtracted('c1', 4, '2026-06-16T10:11:00.000Z')
    expect(listDirtyContexts('2026-06-16T10:20:00.000Z')).toHaveLength(0)
  })

  test('not dirty while still active (within idle window)', () => {
    markActivity(
      { contextId: 'c1', contextType: 'group', configContextId: 'cfg1', historyLen: 4 },
      '2026-06-16T10:09:50.000Z',
    )
    expect(listDirtyContexts('2026-06-16T10:10:00.000Z', 60_000)).toHaveLength(0)
  })
})
