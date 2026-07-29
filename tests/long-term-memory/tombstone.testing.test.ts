// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { isContentTombstoned } from '../../src/long-term-memory/tombstone.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
import type { MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const scope: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }
const NOW = '2026-07-24T00:00:00.000Z'

describe('insertTombstone (test seam)', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('insert then isContentTombstoned matches normalized variants', () => {
    insertTombstone(scope, 'User likes dark mode', NOW)
    expect(isContentTombstoned(scope, '  user LIKES dark mode ')).toBe(true)
    expect(isContentTombstoned(scope, 'user likes light mode')).toBe(false)
  })

  test('duplicate insert does not throw', () => {
    insertTombstone(scope, 'dup', NOW)
    expect(() => insertTombstone(scope, 'dup', '2026-07-25T00:00:00.000Z')).not.toThrow()
  })
})
