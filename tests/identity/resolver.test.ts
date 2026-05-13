import { describe, expect, it, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { getIdentityMapping, setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { resolveMeReference, attemptAutoLink } from '../../src/identity/resolver.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { localDatetimeToUtc, utcToLocal } from '../../src/utils/datetime.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const knownUsers: Record<string, { id: string; login: string; name: string }> = {
  jsmith: { id: 'user-123', login: 'jsmith', name: 'John Smith' },
  JDOE: { id: 'user-456', login: 'jdoe', name: 'Jane Doe' },
}

type UserRecord = { id: string; login: string; name: string }

function searchUsersDefault(query: string): Promise<UserRecord[]> {
  const match = knownUsers[query]
  return match === undefined ? Promise.resolve([]) : Promise.resolve([match])
}

function searchUsersEmailLogin(query: string): Promise<UserRecord[]> {
  const emailMap: Record<string, UserRecord> = {
    jsmith: { id: 'user-123', login: 'jsmith@example.com', name: 'John Smith' },
  }
  const match = emailMap[query]
  return match === undefined ? Promise.resolve([]) : Promise.resolve([match])
}

function searchUsersEmailLoginExact(query: string): Promise<UserRecord[]> {
  const emailSet = new Set(['jsmith', 'jsmith@example.com'])
  return emailSet.has(query)
    ? Promise.resolve([{ id: 'user-123', login: 'jsmith@example.com', name: 'John Smith' }])
    : Promise.resolve([])
}

// Mock provider with identity resolver
const mockProvider: TaskProvider = {
  name: 'mock',
  capabilities: new Set(),
  configRequirements: [],
  preferredUserIdentifier: 'id',
  identityResolver: {
    searchUsers: searchUsersDefault,
  },
  buildTaskUrl: () => '',
  buildProjectUrl: () => '',
  classifyError: (e) => {
    throw e
  },
  getPromptAddendum: () => '',
  normalizeDueDateInput: (dueDate, timezone) =>
    dueDate === undefined ? undefined : localDatetimeToUtc(dueDate.date, dueDate.time, timezone),
  formatDueDateOutput: (dueDate, timezone) =>
    dueDate === undefined || dueDate === null ? dueDate : utcToLocal(dueDate, timezone),
  normalizeListTaskParams: (params) => ({ ...params }),
  createTask() {
    return Promise.reject(new Error('not implemented'))
  },
  getTask() {
    return Promise.reject(new Error('not implemented'))
  },
  updateTask() {
    return Promise.reject(new Error('not implemented'))
  },
  listTasks() {
    return Promise.reject(new Error('not implemented'))
  },
  searchTasks() {
    return Promise.reject(new Error('not implemented'))
  },
}

describe('resolveMeReference', () => {
  const testContextId = 'test-resolver-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping(testContextId, 'mock')
  })

  it('should return not_found when no mapping exists', async () => {
    const providerWithoutResolver: TaskProvider = { ...mockProvider, identityResolver: undefined }
    const result = await resolveMeReference(testContextId, providerWithoutResolver)
    expect(result.type).toBe('not_found')
  })

  it('should return found when mapping exists', async () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: 'mock',
      providerUserId: 'user-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    const result = await resolveMeReference(testContextId, mockProvider)
    expect(result.type).toBe('found')
    assert(result.type === 'found')
    expect(result.identity.login).toBe('jsmith')
    expect(result.identity.userId).toBe('user-123')
    expect(result.identity.displayName).toBe('John Smith')
  })

  it('should return unmatched when mapping is marked unmatched', async () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: 'mock',
      providerUserId: 'unmatched-id',
      providerUserLogin: 'unmatched-login',
      displayName: 'Unmatched User',
      matchMethod: 'unmatched',
      confidence: 0,
    })

    clearIdentityMapping(testContextId, 'mock')

    const result = await resolveMeReference(testContextId, mockProvider)
    expect(result.type).toBe('unmatched')
  })

  it('should handle mapping with empty displayName', async () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: 'mock',
      providerUserId: 'user-123',
      providerUserLogin: 'jsmith',
      displayName: '',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    const result = await resolveMeReference(testContextId, mockProvider)
    expect(result.type).toBe('found')
    assert(result.type === 'found')
    expect(result.identity.displayName).toBe('')
  })
})

describe('attemptAutoLink', () => {
  const testContextId = 'test-autolink-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping(testContextId, 'mock')
  })

  it('should auto-link when exact match found', async () => {
    const result = await attemptAutoLink(testContextId, 'jsmith', mockProvider)
    expect(result.type).toBe('found')
    assert(result.type === 'found')
    expect(result.identity.login).toBe('jsmith')
    expect(result.identity.userId).toBe('user-123')
    expect(result.identity.displayName).toBe('John Smith')

    const mapping = getIdentityMapping(testContextId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith')
    expect(mapping?.matchMethod).toBe('auto')
    expect(mapping?.confidence).toBe(100)
  })

  it('should auto-link with case-insensitive match', async () => {
    const result = await attemptAutoLink(testContextId, 'JDOE', mockProvider)
    expect(result.type).toBe('found')
    assert(result.type === 'found')
    expect(result.identity.login).toBe('jdoe')
  })

  it('should return unmatched when no exact match found', async () => {
    const result = await attemptAutoLink(testContextId, 'unknownuser', mockProvider)
    expect(result.type).toBe('unmatched')

    const mapping = getIdentityMapping(testContextId, 'mock')
    expect(mapping?.matchMethod).toBe('unmatched')
    expect(mapping?.confidence).toBe(0)
  })

  it('should return not_found when provider has no identity resolver', async () => {
    const providerWithoutResolver = { ...mockProvider, identityResolver: undefined }
    const result = await attemptAutoLink(testContextId, 'jsmith', providerWithoutResolver as TaskProvider)
    expect(result.type).toBe('not_found')
  })

  it('should handle search errors gracefully', async () => {
    const providerWithFailingResolver: TaskProvider = {
      ...mockProvider,
      identityResolver: {
        searchUsers: () => Promise.reject(new Error('Network error')),
      },
    } as TaskProvider

    const result = await attemptAutoLink(testContextId, 'jsmith', providerWithFailingResolver)
    expect(result.type).toBe('not_found')
    assert(result.type === 'not_found')
    expect(result.message).toContain('Unable to search')
  })

  it('should return unmatched on subsequent resolveMeReference after auto-link miss', async () => {
    // First: attemptAutoLink fails to find match
    const autoLinkResult = await attemptAutoLink(testContextId, 'unknownuser', mockProvider)
    expect(autoLinkResult.type).toBe('unmatched')

    // Then: subsequent resolveMeReference should return unmatched (not found with empty userId)
    const resolveResult = await resolveMeReference(testContextId, mockProvider)
    expect(resolveResult.type).toBe('unmatched')
  })

  it('should auto-link when login is email and username matches local part', async () => {
    // Provider where login is email (like Kaneo)
    const emailLoginProvider: TaskProvider = {
      ...mockProvider,
      identityResolver: { searchUsers: searchUsersEmailLogin },
    } as TaskProvider

    const result = await attemptAutoLink(testContextId, 'jsmith', emailLoginProvider)
    expect(result.type).toBe('found')
    assert(result.type === 'found')
    expect(result.identity.login).toBe('jsmith@example.com')
    expect(result.identity.userId).toBe('user-123')

    const mapping = getIdentityMapping(testContextId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith@example.com')
  })

  it('should auto-link with exact email match when login is email', async () => {
    // Provider where login is email (like Kaneo)
    const emailLoginProvider: TaskProvider = {
      ...mockProvider,
      identityResolver: { searchUsers: searchUsersEmailLoginExact },
    } as TaskProvider

    const result = await attemptAutoLink(testContextId, 'jsmith@example.com', emailLoginProvider)
    expect(result.type).toBe('found')
    assert(result.type === 'found')
    expect(result.identity.login).toBe('jsmith@example.com')
  })
})
