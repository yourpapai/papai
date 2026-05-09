import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeListStatusesTool } from '../../src/tools/list-statuses.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

interface StatusItem {
  id: string
  name: string
  color?: string | null
  isFinal?: boolean
}

function isStatusItem(item: unknown): item is StatusItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    'id' in item &&
    typeof (item as Record<string, unknown>)['id'] === 'string' &&
    'name' in item &&
    typeof (item as Record<string, unknown>)['name'] === 'string'
  )
}

function isStatusArray(val: unknown): val is StatusItem[] {
  return Array.isArray(val) && val.every(isStatusItem)
}

describe('makeListStatusesTool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const provider = createMockProvider()
    const tool = makeListStatusesTool(provider)
    expect(tool.description).toContain('List all statuses')
  })

  test('lists all statuses in project', async () => {
    const provider = createMockProvider({
      listStatuses: mock(() =>
        Promise.resolve([
          { id: 'col-1', name: 'todo' },
          { id: 'col-2', name: 'in-progress' },
          { id: 'col-3', name: 'done', isFinal: true },
        ]),
      ),
    })

    const tool = makeListStatusesTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
    assert(isStatusArray(result), 'Invalid result')

    expect(result).toHaveLength(3)
    expect(result[0]?.name).toBe('todo')
    expect(result[1]?.name).toBe('in-progress')
    expect(result[2]?.name).toBe('done')
  })

  test('returns empty array when no statuses', async () => {
    const provider = createMockProvider({
      listStatuses: mock(() => Promise.resolve([])),
    })

    const tool = makeListStatusesTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute({ projectId: 'empty-proj' }, { toolCallId: '1', messages: [] })
    assert(Array.isArray(result), 'Invalid result')

    expect(result).toHaveLength(0)
  })

  test('includes projectId in list call', async () => {
    const listStatuses = mock((_projectId: string) => Promise.resolve([]))
    const provider = createMockProvider({ listStatuses })

    const tool = makeListStatusesTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute({ projectId: 'proj-123' }, { toolCallId: '1', messages: [] })

    expect(listStatuses).toHaveBeenCalledWith('proj-123')
  })

  test('propagates project not found error', async () => {
    const provider = createMockProvider({
      listStatuses: mock((): Promise<never> => Promise.reject(new Error('Project not found'))),
    })

    const tool = makeListStatusesTool(provider)
    const promise: Promise<unknown> = getToolExecutor(tool)({ projectId: 'invalid' }, { toolCallId: '1', messages: [] })
    await expect(promise).rejects.toThrow('Project not found')
    try {
      await promise
    } catch {
      // ignore
    }
  })

  test('propagates API errors', async () => {
    const provider = createMockProvider({
      listStatuses: mock(() => Promise.reject(new Error('API Error'))),
    })

    const tool = makeListStatusesTool(provider)
    const promise: Promise<unknown> = getToolExecutor(tool)({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
    await expect(promise).rejects.toThrow('API Error')
    try {
      await promise
    } catch {
      // ignore
    }
  })

  test('validates projectId is required', () => {
    const provider = createMockProvider()
    const tool = makeListStatusesTool(provider)
    expect(schemaValidates(tool, {})).toBe(false)
  })

  test('returns statuses with correct structure', async () => {
    const provider = createMockProvider({
      listStatuses: mock(() =>
        Promise.resolve([
          { id: 'col-1', name: 'Backlog' },
          { id: 'col-2', name: 'In Progress' },
          { id: 'col-3', name: 'Review' },
          { id: 'col-4', name: 'Done', isFinal: true },
        ]),
      ),
    })

    const tool = makeListStatusesTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
    assert(isStatusArray(result), 'Invalid result')

    expect(result).toHaveLength(4)
    for (const status of result) {
      expect(status).toHaveProperty('id')
      expect(status).toHaveProperty('name')
    }
  })
})
