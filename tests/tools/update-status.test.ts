import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeUpdateStatusTool } from '../../src/tools/update-status.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('makeUpdateStatusTool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(tool.description).toContain('Update an existing status')
  })

  test('updates status name', async () => {
    const provider = createMockProvider({
      updateStatus: mock(() =>
        Promise.resolve({
          id: 'col-1',
          name: 'Updated Name',
        }),
      ),
    })

    const tool = makeUpdateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { projectId: 'proj-1', statusId: 'col-1', name: 'Updated Name' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({ id: 'col-1', name: 'Updated Name' })
  })

  test('passes confirm parameter to provider', async () => {
    const updateStatus = mock(
      (
        _projectId: string,
        _statusId: string,
        _params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
        _confirm?: boolean,
      ) =>
        Promise.resolve({
          id: 'col-1',
          name: 'Updated',
        }),
    )
    const provider = createMockProvider({ updateStatus })

    const tool = makeUpdateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      { projectId: 'proj-1', statusId: 'col-1', name: 'Updated', confirm: true },
      { toolCallId: '1', messages: [] },
    )

    expect(updateStatus).toHaveBeenCalledWith(
      'proj-1',
      'col-1',
      {
        name: 'Updated',
        icon: undefined,
        color: undefined,
        isFinal: undefined,
      },
      true,
    )
  })

  test('returns confirmation_required when provider returns shared bundle warning', async () => {
    const updateStatus = mock(() =>
      Promise.resolve({ status: 'confirmation_required' as const, message: 'Shared bundle' }),
    )
    const provider = createMockProvider({ updateStatus })

    const tool = makeUpdateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { projectId: 'proj-1', statusId: 'col-1', name: 'Updated' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
  })

  test('propagates status not found error', async () => {
    const provider = createMockProvider({
      updateStatus: mock(() => Promise.reject(new Error('Status not found'))),
    })

    const tool = makeUpdateStatusTool(provider)
    const promise = getToolExecutor(tool)(
      { projectId: 'proj-1', statusId: 'invalid', name: 'Test' },
      { toolCallId: '1', messages: [] },
    )
    await expect(promise).rejects.toThrow('Status not found')
    try {
      await promise
    } catch {
      // ignore
    }
  })

  test('validates projectId is required', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { statusId: 'col-1', name: 'Test' })).toBe(false)
  })

  test('validates statusId is required', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', name: 'Test' })).toBe(false)
  })

  test('validates at least one field is provided', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1' })).toBe(false)
  })
})
