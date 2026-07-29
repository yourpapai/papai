// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  contentHash,
  deleteMatchingTombstone,
  isContentTombstoned,
  normalizeForHash,
} from '../../src/long-term-memory/tombstone.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
import type { MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const scope: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }
const NOW = '2026-07-24T00:00:00.000Z'

describe('tombstone hashing', () => {
  test('normalization folds case and collapses whitespace', () => {
    expect(normalizeForHash('  Hello   World  ')).toBe('hello world')
  })

  test('case and whitespace variants hash equal (EN)', () => {
    expect(contentHash('User likes DARK  mode')).toBe(contentHash('user likes dark mode'))
  })

  test('case variants hash equal (RU)', () => {
    expect(contentHash('Пользователь любит ТЁМНУЮ тему')).toBe(contentHash('пользователь любит тёмную тему'))
  })

  test('different content hashes differ', () => {
    expect(contentHash('likes dark mode')).not.toBe(contentHash('likes light mode'))
  })
})

describe('tombstone store', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('tombstones are scope-isolated', () => {
    insertTombstone(scope, 'secret', NOW)
    expect(isContentTombstoned({ scopeId: 'user-2', scopeType: 'personal' }, 'secret')).toBe(false)
    expect(isContentTombstoned({ scopeId: 'user-1', scopeType: 'group' }, 'secret')).toBe(false)
  })

  test('deleteMatchingTombstone removes it', () => {
    insertTombstone(scope, 'gone soon', NOW)
    deleteMatchingTombstone(scope, 'GONE  soon')
    expect(isContentTombstoned(scope, 'gone soon')).toBe(false)
  })
})
