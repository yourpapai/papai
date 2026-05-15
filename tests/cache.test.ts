// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { getCachedHistory, _userCaches } from '../src/cache.js'
import { appendHistory, saveHistory } from '../src/history.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  _userCaches.clear()
})

describe('getCachedHistory', () => {
  test('returns a snapshot that is not mutated by a subsequent append', () => {
    saveHistory('snap-1', [{ role: 'user', content: 'initial' }])

    const snapshot = getCachedHistory('snap-1')
    expect(snapshot).toHaveLength(1)

    appendHistory('snap-1', [{ role: 'assistant', content: 'reply' }])

    // The previously-returned snapshot must be unaffected
    expect(snapshot).toHaveLength(1)

    // A fresh read must see both messages
    expect(getCachedHistory('snap-1')).toHaveLength(2)
  })
})
