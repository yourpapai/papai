// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, test, expect, beforeEach } from 'bun:test'

import { userCachesForTesting } from '../src/cache.js'
import { getCachedInstructions, addCachedInstruction, deleteCachedInstruction } from '../src/cache.js'
import { userInstructions } from '../src/db/schema.js'
import { mockLogger, setupTestDb, getTestDb } from './utils/test-helpers.js'

describe('instructions cache', () => {
  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('getCachedInstructions returns empty array for new context', () => {
    const result = getCachedInstructions('ctx-1')
    expect(result).toEqual([])
  })

  test('addCachedInstruction stores instruction and retrieves it', () => {
    addCachedInstruction('ctx-1', { id: 'i-1', text: 'Always reply in Spanish' })
    const result = getCachedInstructions('ctx-1')
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe('Always reply in Spanish')
  })

  test('addCachedInstruction allows more than 20 (cap is in instructions module)', () => {
    for (let i = 0; i < 21; i++) {
      addCachedInstruction('ctx-1', { id: `i-${i}`, text: `Instruction ${i}` })
    }
    expect(getCachedInstructions('ctx-1').length).toBe(21)
  })

  test('deleteCachedInstruction removes by id', () => {
    addCachedInstruction('ctx-1', { id: 'i-1', text: 'First' })
    addCachedInstruction('ctx-1', { id: 'i-2', text: 'Second' })
    deleteCachedInstruction('ctx-1', 'i-1')
    const result = getCachedInstructions('ctx-1')
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('i-2')
  })

  test('deleteCachedInstruction is a no-op for unknown id', () => {
    addCachedInstruction('ctx-1', { id: 'i-1', text: 'First' })
    deleteCachedInstruction('ctx-1', 'unknown')
    expect(getCachedInstructions('ctx-1')).toHaveLength(1)
  })

  test('lazy loads from DB on first access', () => {
    // Pre-seed DB directly
    const db = getTestDb()
    db.insert(userInstructions)
      .values({ id: 'db-1', contextId: 'ctx-db', text: 'From DB', createdAt: new Date().toISOString() })
      .run()
    userCachesForTesting.clear()

    const result = getCachedInstructions('ctx-db')
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe('From DB')
  })
})
