import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeFindUserTool } from '../../src/tools/find-user.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isUserArray(value: unknown): value is Array<{ id: string }> {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && 'id' in item)
}

describe('Find User Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeFindUserTool(createMockProvider())
    expect(tool.description).toContain('Find users')
  })

  test('finds users with query and limit', async () => {
    const listUsers = mock(() =>
      Promise.resolve([
        { id: 'user-1', login: 'alice', name: 'Alice Smith' },
        { id: 'user-2', login: 'alicia', name: 'Alicia Keys' },
      ]),
    )
    const provider = createMockProvider({ listUsers })
    const tool = makeFindUserTool(provider)

    const result: unknown = await getToolExecutor(tool)({ query: 'ali', limit: 2 }, { toolCallId: '1', messages: [] })

    assert(isUserArray(result), 'Invalid result')
    expect(result).toHaveLength(2)
    expect(listUsers).toHaveBeenCalledWith('ali', 2)
  })

  test('passes undefined limit when omitted', async () => {
    const listUsers = mock(() => Promise.resolve([{ id: 'user-1', login: 'alice', name: 'Alice Smith' }]))
    const provider = createMockProvider({ listUsers })
    const tool = makeFindUserTool(provider)

    await getToolExecutor(tool)({ query: 'alice' }, { toolCallId: '1', messages: [] })

    expect(listUsers).toHaveBeenCalledWith('alice', undefined)
  })

  test('propagates provider errors', async () => {
    const tool = makeFindUserTool(
      createMockProvider({
        listUsers: mock(() => Promise.reject(new Error('Lookup failed'))),
      }),
    )

    await expect(getToolExecutor(tool)({ query: 'alice' }, { toolCallId: '1', messages: [] })).rejects.toThrow(
      'Lookup failed',
    )
  })

  test('validates required query and optional positive limit', () => {
    const tool = makeFindUserTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { query: 'alice', limit: 0 })).toBe(false)
    expect(schemaValidates(tool, { query: 'alice', limit: 1 })).toBe(true)
  })
})
