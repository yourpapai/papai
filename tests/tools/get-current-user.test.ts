import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeGetCurrentUserTool } from '../../src/tools/get-current-user.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isUserRef(value: unknown): value is { id: string; login: string; name?: string } {
  return value !== null && typeof value === 'object' && 'id' in value && 'login' in value
}

describe('Get Current User Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeGetCurrentUserTool(createMockProvider())
    expect(tool.description).toContain('current authenticated user')
  })

  test('returns the normalized current user from the provider', async () => {
    const getCurrentUser = mock(() => Promise.resolve({ id: 'user-42', login: 'alice', name: 'Alice Smith' }))
    const tool = makeGetCurrentUserTool(createMockProvider({ getCurrentUser }))

    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    assert(isUserRef(result), 'Invalid result')
    expect(result).toEqual({ id: 'user-42', login: 'alice', name: 'Alice Smith' })
    expect(getCurrentUser).toHaveBeenCalledTimes(1)
  })

  test('propagates provider errors', async () => {
    const tool = makeGetCurrentUserTool(
      createMockProvider({
        getCurrentUser: mock(() => Promise.reject(new Error('Current user lookup failed'))),
      }),
    )

    await expect(getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })).rejects.toThrow(
      'Current user lookup failed',
    )
  })

  test('validates an empty input object', () => {
    const tool = makeGetCurrentUserTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(true)
  })
})
