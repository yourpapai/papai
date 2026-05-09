import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeReorderStatusesTool } from '../../src/tools/reorder-statuses.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('makeReorderStatusesTool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const provider = createMockProvider()
    const tool = makeReorderStatusesTool(provider)
    expect(tool.description).toContain('Reorder statuses')
  })

  test('reorders statuses successfully', async () => {
    const reorderStatuses = mock(
      (_projectId: string, _statuses: { id: string; position: number }[], _confirm?: boolean) =>
        Promise.resolve(undefined),
    )
    const provider = createMockProvider({ reorderStatuses })

    const tool = makeReorderStatusesTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      {
        projectId: 'proj-1',
        statuses: [
          { id: 'col-2', position: 0 },
          { id: 'col-1', position: 1 },
          { id: 'col-3', position: 2 },
        ],
      },
      { toolCallId: '1', messages: [] },
    )

    expect(reorderStatuses).toHaveBeenCalledWith(
      'proj-1',
      [
        { id: 'col-2', position: 0 },
        { id: 'col-1', position: 1 },
        { id: 'col-3', position: 2 },
      ],
      undefined,
    )
  })

  test('passes confirm parameter to provider', async () => {
    const reorderStatuses = mock(
      (_projectId: string, _statuses: { id: string; position: number }[], _confirm?: boolean) =>
        Promise.resolve(undefined),
    )
    const provider = createMockProvider({ reorderStatuses })

    const tool = makeReorderStatusesTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      {
        projectId: 'proj-1',
        statuses: [{ id: 'col-1', position: 0 }],
        confirm: true,
      },
      { toolCallId: '1', messages: [] },
    )

    expect(reorderStatuses).toHaveBeenCalledWith('proj-1', [{ id: 'col-1', position: 0 }], true)
  })

  test('returns confirmation_required when provider returns shared bundle warning', async () => {
    const reorderStatuses = mock(() =>
      Promise.resolve({ status: 'confirmation_required' as const, message: 'Shared bundle' }),
    )
    const provider = createMockProvider({ reorderStatuses })

    const tool = makeReorderStatusesTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      {
        projectId: 'proj-1',
        statuses: [{ id: 'col-1', position: 0 }],
      },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
  })

  test('propagates API errors', async () => {
    const provider = createMockProvider({
      reorderStatuses: mock(() => Promise.reject(new Error('API Error'))),
    })

    const tool = makeReorderStatusesTool(provider)
    const promise = getToolExecutor(tool)(
      {
        projectId: 'proj-1',
        statuses: [{ id: 'col-1', position: 0 }],
      },
      { toolCallId: '1', messages: [] },
    )
    await expect(promise).rejects.toThrow('API Error')
    try {
      await promise
    } catch {
      // ignore
    }
  })

  test('validates projectId is required', () => {
    const provider = createMockProvider()
    const tool = makeReorderStatusesTool(provider)
    expect(schemaValidates(tool, { statuses: [{ id: 'col-1', position: 0 }] })).toBe(false)
  })

  test('validates statuses is required', () => {
    const provider = createMockProvider()
    const tool = makeReorderStatusesTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1' })).toBe(false)
  })
})
