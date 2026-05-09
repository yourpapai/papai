import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeDeleteStatusTool } from '../../src/tools/delete-status.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('makeDeleteStatusTool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const provider = createMockProvider()
    const tool = makeDeleteStatusTool(provider)
    expect(tool.description).toContain('Delete a status')
  })

  test('deletes status successfully with high confidence', async () => {
    const provider = createMockProvider({
      deleteStatus: mock(() => Promise.resolve({ id: 'col-1' })),
    })

    const execute = getToolExecutor(makeDeleteStatusTool(provider))
    const result: unknown = await execute(
      { projectId: 'proj-1', statusId: 'col-1', confidence: 0.9 },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({ id: 'col-1' })
  })

  test('returns confirmation_required when confidence is below threshold', async () => {
    const provider = createMockProvider()
    const execute = getToolExecutor(makeDeleteStatusTool(provider))
    const result: unknown = await execute(
      { projectId: 'proj-1', statusId: 'col-1', label: 'In Progress', confidence: 0.6 },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
    assert(typeof result === 'object')
    assert(result !== null)
    assert('message' in result)
    const message = (result as Record<string, unknown>)['message']
    assert(typeof message === 'string')
    expect(message.includes('In Progress')).toBe(true)
  })

  test('passes confirm parameter to provider', async () => {
    const deleteStatus = mock((_projectId: string, _statusId: string, _confirm?: boolean) =>
      Promise.resolve({ id: 'col-1' }),
    )
    const provider = createMockProvider({ deleteStatus })

    const execute = getToolExecutor(makeDeleteStatusTool(provider))
    await execute(
      { projectId: 'proj-1', statusId: 'col-1', confidence: 0.9, confirm: true },
      { toolCallId: '1', messages: [] },
    )

    expect(deleteStatus).toHaveBeenCalledWith('proj-1', 'col-1', true)
  })

  test('returns confirmation_required when provider returns shared bundle warning', async () => {
    const deleteStatus = mock(() =>
      Promise.resolve({ status: 'confirmation_required' as const, message: 'Shared bundle' }),
    )
    const provider = createMockProvider({ deleteStatus })

    const execute = getToolExecutor(makeDeleteStatusTool(provider))
    const result: unknown = await execute(
      { projectId: 'proj-1', statusId: 'col-1', confidence: 0.9 },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
  })

  test('propagates status not found error', async () => {
    const provider = createMockProvider({
      deleteStatus: mock(() => Promise.reject(new Error('Status not found'))),
    })

    const tool = makeDeleteStatusTool(provider)
    const promise = getToolExecutor(tool)(
      { projectId: 'proj-1', statusId: 'invalid', confidence: 0.9 },
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
    const tool = makeDeleteStatusTool(provider)
    expect(schemaValidates(tool, { statusId: 'col-1', confidence: 0.9 })).toBe(false)
  })

  test('validates statusId is required', () => {
    const provider = createMockProvider()
    const tool = makeDeleteStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', confidence: 0.9 })).toBe(false)
  })
})
