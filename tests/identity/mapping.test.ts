// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import {
  clearIdentityMapping,
  getIdentityMapping,
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
