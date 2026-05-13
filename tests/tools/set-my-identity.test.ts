import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getIdentityMapping, clearIdentityMapping, setIdentityMapping } from '../../src/identity/mapping.js'
import { makeSetMyIdentityTool } from '../../src/tools/set-my-identity.js'
import { createMinimalTaskProviderStub } from '../utils/factories.js'
import { mockLogger, setupTestDb, getToolExecutor } from '../utils/test-helpers.js'

function searchUsersJsmith(query: string): Promise<{ id: string; login: string; name: string }[]> {
  const results = new Map([['jsmith', [{ id: 'user-123', login: 'jsmith', name: 'John Smith' }]]])
  return Promise.resolve(results.get(query) ?? [])
}

function searchUsersBobsmith(query: string): Promise<{ id: string; login: string; name: string }[]> {
  const results = new Map([['bobsmith', [{ id: 'user-789', login: 'bobsmith', name: 'Bob Smith' }]]])
  return Promise.resolve(results.get(query) ?? [])
}

const bobProvider = createMinimalTaskProviderStub({
  identityResolver: {
    searchUsers: mock(searchUsersBobsmith),
  },
})

function searchUsersJsmithEmail(query: string): Promise<{ id: string; login: string; name: string }[]> {
  const results = new Map([['jsmith', [{ id: 'user-123', login: 'jsmith@example.com', name: 'John Smith' }]]])
  return Promise.resolve(results.get(query) ?? [])
}

const kaneoLikeProvider = createMinimalTaskProviderStub({
  identityResolver: {
    searchUsers: mock(searchUsersJsmithEmail),
  },
})

function searchUsersJsmithOrEmail(query: string): Promise<{ id: string; login: string; name: string }[]> {
  const results = new Map([
    ['jsmith', [{ id: 'user-123', login: 'jsmith@example.com', name: 'John Smith' }]],
    ['jsmith@example.com', [{ id: 'user-123', login: 'jsmith@example.com', name: 'John Smith' }]],
  ])
  return Promise.resolve(results.get(query) ?? [])
}

const kaneoLikeProviderWithEmail = createMinimalTaskProviderStub({
  identityResolver: {
    searchUsers: mock(searchUsersJsmithOrEmail),
  },
})

describe('set_my_identity tool', () => {
  const testUserId = 'test-user-tool-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping(testUserId, 'mock')
  })

  test('returns tool with correct structure', () => {
    const tool = makeSetMyIdentityTool(
      createMinimalTaskProviderStub({
        identityResolver: {
          searchUsers: mock(searchUsersJsmith),
        },
      }),
      testUserId,
    )
    expect(tool.description).toContain('identity')
  })

  test('should create identity mapping when user found', async () => {
    const tool = makeSetMyIdentityTool(
      createMinimalTaskProviderStub({
        identityResolver: {
          searchUsers: mock(searchUsersJsmith),
        },
      }),
      testUserId,
    )
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    const mapping = getIdentityMapping(testUserId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith')
  })

  test('should return error when user not found', async () => {
    const tool = makeSetMyIdentityTool(
      createMinimalTaskProviderStub({
        identityResolver: {
          searchUsers: mock(searchUsersJsmith),
        },
      }),
      testUserId,
    )
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm nonexistent" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'error')
  })

  test('should return error when provider has no identity resolver', async () => {
    const providerWithoutResolver = createMinimalTaskProviderStub({
      identityResolver: undefined,
    })

    const tool = makeSetMyIdentityTool(providerWithoutResolver, testUserId)
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'error')
  })

  test('should return error when claim cannot be parsed', async () => {
    const tool = makeSetMyIdentityTool(
      createMinimalTaskProviderStub({
        identityResolver: {
          searchUsers: mock(searchUsersJsmith),
        },
      }),
      testUserId,
    )
    const result: unknown = await getToolExecutor(tool)(
      { claim: 'just some random text' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'error')
  })

  test('should isolate identities by chatUserId in group contexts', async () => {
    // Alice sets her identity using her chatUserId
    const aliceTool = makeSetMyIdentityTool(
      createMinimalTaskProviderStub({
        identityResolver: {
          searchUsers: mock(searchUsersJsmith),
        },
      }),
      'user-alice',
    )
    await getToolExecutor(aliceTool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    // Verify Alice's identity is stored under her chatUserId
    const aliceMapping = getIdentityMapping('user-alice', 'mock')
    expect(aliceMapping?.providerUserLogin).toBe('jsmith')

    // Verify group context doesn't have Alice's identity
    const groupMapping = getIdentityMapping('group-123', 'mock')
    expect(groupMapping).toBeNull()

    // Bob sets his identity using his chatUserId
    const bobTool = makeSetMyIdentityTool(bobProvider, 'user-bob')
    await getToolExecutor(bobTool)({ claim: "I'm bobsmith" }, { toolCallId: '2', messages: [] })

    // Verify Bob's identity is stored separately
    const bobMapping = getIdentityMapping('user-bob', 'mock')
    expect(bobMapping?.providerUserLogin).toBe('bobsmith')

    // Alice's identity should be unchanged
    const aliceMappingAfter = getIdentityMapping('user-alice', 'mock')
    expect(aliceMappingAfter?.providerUserLogin).toBe('jsmith')
  })

  test('should match user when login is email and claim is username prefix', async () => {
    const tool = makeSetMyIdentityTool(kaneoLikeProvider, testUserId)
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    const mapping = getIdentityMapping(testUserId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith@example.com')
  })

  test('should match user with exact email claim when login is email', async () => {
    // Simulate Kaneo provider where login is email; search matches both local part and full email
    const tool = makeSetMyIdentityTool(kaneoLikeProviderWithEmail, testUserId)
    const result: unknown = await getToolExecutor(tool)(
      { claim: "I'm jsmith@example.com" },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'success')
    const mapping = getIdentityMapping(testUserId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith@example.com')
  })

  test('should use injected deps', async () => {
    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    let setMappingCalled = false

    const mockSetIdentityMapping = (
      params: Parameters<typeof setIdentityMapping>[0],
      depsArg?: Parameters<typeof setIdentityMapping>[1],
    ): void => {
      setMappingCalled = true
      setIdentityMapping(params, depsArg)
    }

    const deps = {
      setIdentityMapping: mockSetIdentityMapping,
      getDrizzleDb,
    }

    const tool = makeSetMyIdentityTool(
      createMinimalTaskProviderStub({
        identityResolver: {
          searchUsers: mock(searchUsersJsmith),
        },
      }),
      testUserId,
      deps,
    )
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    expect(setMappingCalled).toBe(true)
    const mapping = getIdentityMapping(testUserId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith')
  })
})
