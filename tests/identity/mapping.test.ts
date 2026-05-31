// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import {
  clearIdentityMapping,
  getIdentityMapping,
  listAllIdentityMappings,
  setIdentityMapping,
  type IdentityMappingDeps,
} from '../../src/identity/mapping.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('identity mapping CRUD', () => {
  const testContextId = 'test-context-123'
  const testProvider = 'youtrack'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should return null when no mapping exists', () => {
    const result = getIdentityMapping(testContextId, testProvider)
    expect(result).toBeNull()
  })

  it('should store and retrieve a mapping', () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: testProvider,
      providerUserId: 'yt-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })

    const result = getIdentityMapping(testContextId, testProvider)
    expect(result).not.toBeNull()
    expect(result?.providerUserLogin).toBe('jsmith')
    expect(result?.matchMethod).toBe('auto')
  })

  it('should clear a mapping', () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: testProvider,
      providerUserId: 'yt-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })

    clearIdentityMapping(testContextId, testProvider)

    const result = getIdentityMapping(testContextId, testProvider)
    expect(result).not.toBeNull()
    expect(result?.providerUserId).toBeNull()
    expect(result?.matchMethod).toBe('unmatched')
  })
})

describe('listAllIdentityMappings', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('returns an empty array when no mappings exist', () => {
    const result = listAllIdentityMappings()
    expect(result).toEqual([])
  })

  it('returns all stored mappings across different contexts and providers', () => {
    setIdentityMapping({
      contextId: 'ctx-A',
      providerName: 'kaneo',
      providerUserId: 'k-1',
      providerUserLogin: 'alice',
      displayName: 'Alice',
      matchMethod: 'auto',
      confidence: 100,
    })
    setIdentityMapping({
      contextId: 'ctx-B',
      providerName: 'youtrack',
      providerUserId: 'yt-2',
      providerUserLogin: 'bob',
      displayName: 'Bob',
      matchMethod: 'manual_nl',
      confidence: 80,
    })

    const result = listAllIdentityMappings()
    expect(result).toHaveLength(2)
    const contextIds = result.map((r) => r.contextId).sort((a, b) => a.localeCompare(b))
    expect(contextIds).toEqual(['ctx-A', 'ctx-B'])
  })

  it('returns the correct IdentityMapping shape for each row', () => {
    setIdentityMapping({
      contextId: 'ctx-shape',
      providerName: 'kaneo',
      providerUserId: 'k-99',
      providerUserLogin: 'charlie',
      displayName: 'Charlie',
      matchMethod: 'auto',
      confidence: 95,
    })

    const result = listAllIdentityMappings()
    expect(result).toHaveLength(1)
    const entry = result[0]
    expect(entry).toBeDefined()
    expect(entry?.contextId).toBe('ctx-shape')
    expect(entry?.providerName).toBe('kaneo')
    expect(entry?.providerUserId).toBe('k-99')
    expect(entry?.providerUserLogin).toBe('charlie')
    expect(entry?.displayName).toBe('Charlie')
    expect(entry?.matchMethod).toBe('auto')
    expect(entry?.confidence).toBe(95)
    expect(typeof entry?.matchedAt).toBe('string')
  })
})

describe('identity mapping DI', () => {
  const testContextId = 'test-context-di'
  const testProvider = 'youtrack'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should use injected deps for getIdentityMapping', async () => {
    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    let getDbCalled = false

    const mockGetDrizzleDb = (): ReturnType<IdentityMappingDeps['getDrizzleDb']> => {
      getDbCalled = true
      return getDrizzleDb()
    }

    const deps: IdentityMappingDeps = { getDrizzleDb: mockGetDrizzleDb }
    const result = getIdentityMapping(testContextId, testProvider, deps)
    expect(getDbCalled).toBe(true)
    expect(result).toBeNull()
  })

  it('should use injected deps for setIdentityMapping', async () => {
    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    let getDbCalled = false

    const mockGetDrizzleDb = (): ReturnType<IdentityMappingDeps['getDrizzleDb']> => {
      getDbCalled = true
      return getDrizzleDb()
    }

    const deps: IdentityMappingDeps = { getDrizzleDb: mockGetDrizzleDb }
    setIdentityMapping(
      {
        contextId: testContextId,
        providerName: testProvider,
        providerUserId: 'yt-123',
        providerUserLogin: 'jsmith',
        displayName: 'John Smith',
        matchMethod: 'auto',
        confidence: 100,
      },
      deps,
    )
    expect(getDbCalled).toBe(true)
  })

  it('should use injected deps for clearIdentityMapping', async () => {
    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    let getDbCalled = false

    const mockGetDrizzleDb = (): ReturnType<IdentityMappingDeps['getDrizzleDb']> => {
      getDbCalled = true
      return getDrizzleDb()
    }

    const deps: IdentityMappingDeps = { getDrizzleDb: mockGetDrizzleDb }
    clearIdentityMapping(testContextId, testProvider, deps)
    expect(getDbCalled).toBe(true)
  })
})
