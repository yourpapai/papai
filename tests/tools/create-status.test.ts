import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeCreateStatusTool } from '../../src/tools/create-status.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('makeCreateStatusTool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const provider = createMockProvider()
    const tool = makeCreateStatusTool(provider)
    expect(tool.description).toContain('Create a new status')
  })

  test('creates status with required fields', async () => {
    const provider = createMockProvider({
      createStatus: mock(() =>
        Promise.resolve({
          id: 'col-new',
          name: 'In Progress',
        }),
      ),
    })

    const tool = makeCreateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { projectId: 'proj-1', name: 'In Progress' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({ id: 'col-new', name: 'In Progress' })
  })

  test('passes confirm parameter to provider', async () => {
    const createStatus = mock(
      (
        _projectId: string,
        _params: { name: string; icon?: string; color?: string; isFinal?: boolean },
        _confirm?: boolean,
      ) =>
        Promise.resolve({
          id: 'col-new',
          name: 'Done',
        }),
    )
    const provider = createMockProvider({ createStatus })

    const tool = makeCreateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute({ projectId: 'proj-1', name: 'Done', confirm: true }, { toolCallId: '1', messages: [] })

    expect(createStatus).toHaveBeenCalledWith(
      'proj-1',
      {
        name: 'Done',
        icon: undefined,
        color: undefined,
        isFinal: undefined,
      },
      true,
    )
  })

  test('returns confirmation_required when provider returns shared bundle warning', async () => {
    const createStatus = mock(() =>
      Promise.resolve({ status: 'confirmation_required' as const, message: 'Shared bundle' }),
    )
    const provider = createMockProvider({ createStatus })

    const tool = makeCreateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { projectId: 'proj-1', name: 'In Progress' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
  })

  test('propagates API errors', async () => {
    const provider = createMockProvider({
      createStatus: mock(() => Promise.reject(new Error('API Error'))),
    })

    const tool = makeCreateStatusTool(provider)
    const promise = getToolExecutor(tool)({ projectId: 'proj-1', name: 'Test' }, { toolCallId: '1', messages: [] })
    await expect(promise).rejects.toThrow('API Error')
    try {
      await promise
    } catch {
      // ignore
    }
  })

  test('validates projectId is required', () => {
    const provider = createMockProvider()
    const tool = makeCreateStatusTool(provider)
    expect(schemaValidates(tool, { name: 'Test' })).toBe(false)
  })

  test('validates name is required', () => {
    const provider = createMockProvider()
    const tool = makeCreateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1' })).toBe(false)
  })
})
