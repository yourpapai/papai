import { beforeEach, describe, expect, test } from 'bun:test'

import { clearIdentityMapping, getIdentityMapping, setIdentityMapping } from '../../src/identity/mapping.js'
import { makeClearMyIdentityTool } from '../../src/tools/clear-my-identity.js'
import { createMinimalTaskProviderStub } from '../utils/factories.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('clear_my_identity tool', () => {
  const testUserId = 'test-user-clear-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    // Setup initial mapping
    setIdentityMapping({
      contextId: testUserId,
      providerName: 'mock',
      providerUserId: 'user-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })
  })

  test('returns tool with correct structure', () => {
    const tool = makeClearMyIdentityTool(createMinimalTaskProviderStub(), testUserId)
    expect(tool.description).toContain('identity')
  })

  test('should clear identity mapping', async () => {
    const tool = makeClearMyIdentityTool(createMinimalTaskProviderStub(), testUserId)
    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    const mapping = getIdentityMapping(testUserId, 'mock')
    expect(mapping?.providerUserId).toBeNull()
    expect(mapping?.matchMethod).toBe('unmatched')
  })

  test('should return info when no mapping exists', async () => {
    // Clear any existing mapping first
    clearIdentityMapping(testUserId, 'mock')

    const tool = makeClearMyIdentityTool(createMinimalTaskProviderStub(), testUserId)
    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'info')
    expect(result).toHaveProperty('message', 'No identity mapping to clear.')
  })

  test('should isolate clear operations by chatUserId', async () => {
    // Setup another user's identity
    const otherUserId = 'user-other'
    setIdentityMapping({
      contextId: otherUserId,
      providerName: 'mock',
      providerUserId: 'user-999',
      providerUserLogin: 'otheruser',
      displayName: 'Other User',
      matchMethod: 'auto',
      confidence: 100,
    })

    // Clear first user's identity
    const tool = makeClearMyIdentityTool(createMinimalTaskProviderStub(), testUserId)
    await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    // First user's identity should be cleared
    const clearedMapping = getIdentityMapping(testUserId, 'mock')
    expect(clearedMapping?.providerUserId).toBeNull()

    // Other user's identity should remain intact
    const otherMapping = getIdentityMapping(otherUserId, 'mock')
    expect(otherMapping?.providerUserId).toBe('user-999')
  })

  test('should use injected deps', async () => {
    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    let getDbCalled = false
    let clearCalled = false

    const mockGetDrizzleDb = (): ReturnType<typeof getDrizzleDb> => {
      getDbCalled = true
      return getDrizzleDb()
    }

    const mockClearIdentityMapping = (contextId: string, providerName: string): void => {
      clearCalled = true
      clearIdentityMapping(contextId, providerName)
    }

    const deps = {
      getIdentityMapping: (ctxId: string, provName: string): ReturnType<typeof getIdentityMapping> => {
        getDbCalled = true
        return getIdentityMapping(ctxId, provName)
      },
      clearIdentityMapping: mockClearIdentityMapping,
      getDrizzleDb: mockGetDrizzleDb,
    }

    const tool = makeClearMyIdentityTool(createMinimalTaskProviderStub(), testUserId, deps)
    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    expect(getDbCalled).toBe(true)
    expect(clearCalled).toBe(true)
  })
})
