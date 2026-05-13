import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeListWorkTool } from '../../src/tools/list-work.js'
import { makeLogWorkTool } from '../../src/tools/log-work.js'
import { makeRemoveWorkTool } from '../../src/tools/remove-work.js'
import { makeUpdateWorkTool } from '../../src/tools/update-work.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('Work Item Tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  describe('makeListWorkTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const t = makeListWorkTool(provider)
      expect(t.description).toContain('List all work items')
    })

    test('schema requires taskId', () => {
      const provider = createMockProvider()
      const t = makeListWorkTool(provider)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1' })).toBe(true)
    })

    test('schema accepts optional limit and offset', () => {
      const provider = createMockProvider()
      const t = makeListWorkTool(provider)

      expect(schemaValidates(t, { taskId: 'task-1', limit: 10, offset: 30 })).toBe(true)
      expect(schemaValidates(t, { taskId: 'task-1', limit: 0 })).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1', offset: -1 })).toBe(false)
    })

    test('returns work items from provider', async () => {
      const workItems = [{ id: 'wi-1', taskId: 'task-1', author: 'alice', date: '2024-01-15', duration: 'PT2H' }]
      const provider = createMockProvider({ listWorkItems: mock(() => Promise.resolve(workItems)) })
      const result: unknown = await getToolExecutor(makeListWorkTool(provider))({ taskId: 'task-1' })
      expect(result).toEqual(workItems)
    })

    test('calls provider.listWorkItems with correct taskId', async () => {
      const listWorkItems = mock(() => Promise.resolve([]))
      const provider = createMockProvider({ listWorkItems })
      await getToolExecutor(makeListWorkTool(provider))({ taskId: 'task-99' })
      expect(listWorkItems).toHaveBeenCalledWith('task-99')
    })

    test('passes limit and offset to provider.listWorkItems', async () => {
      const listWorkItems = mock(() => Promise.resolve([]))
      const provider = createMockProvider({ listWorkItems })

      await getToolExecutor(makeListWorkTool(provider))({ taskId: 'task-99', limit: 10, offset: 30 })

      expect(listWorkItems).toHaveBeenCalledWith('task-99', { limit: 10, offset: 30 })
    })

    test('propagates provider errors', async () => {
      const provider = createMockProvider({
        listWorkItems: mock(() => Promise.reject(new Error('not found'))),
      })
      await expect(getToolExecutor(makeListWorkTool(provider))({ taskId: 'task-1' })).rejects.toThrow('not found')
    })
  })

  describe('makeLogWorkTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const t = makeLogWorkTool(provider)
      expect(t.description).toContain('Log time')
    })

    test('schema requires taskId and duration', () => {
      const provider = createMockProvider()
      const t = makeLogWorkTool(provider)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1' })).toBe(false)
      expect(schemaValidates(t, { duration: '2h' })).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1', duration: '2h' })).toBe(true)
    })

    test('schema accepts all optional fields', () => {
      const provider = createMockProvider()
      const t = makeLogWorkTool(provider)
      expect(
        schemaValidates(t, {
          taskId: 'task-1',
          duration: '2h 30m',
          date: '2024-01-15',
          description: 'Fixing bug',
          type: 'Development',
          author: 'alice',
        }),
      ).toBe(true)
    })

    test('creates work item via provider', async () => {
      const workItem = { id: 'wi-1', taskId: 'task-1', author: 'alice', date: '2024-01-15', duration: 'PT2H' }
      const createWorkItem = mock(() => Promise.resolve(workItem))
      const provider = createMockProvider({ createWorkItem })
      const result: unknown = await getToolExecutor(makeLogWorkTool(provider))({
        taskId: 'task-1',
        duration: '2h',
        date: '2024-01-15',
      })
      expect(result).toEqual(workItem)
      expect(createWorkItem).toHaveBeenCalledWith('task-1', {
        duration: '2h',
        date: '2024-01-15',
        description: undefined,
        type: undefined,
        author: undefined,
      })
    })

    test('propagates provider errors', async () => {
      const provider = createMockProvider({
        createWorkItem: mock(() => Promise.reject(new Error('validation error'))),
      })
      await expect(getToolExecutor(makeLogWorkTool(provider))({ taskId: 'task-1', duration: '1h' })).rejects.toThrow(
        'validation error',
      )
    })
  })

  describe('makeUpdateWorkTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const t = makeUpdateWorkTool(provider)
      expect(t.description).toContain('Update an existing work item')
    })

    test('schema requires taskId and workItemId', () => {
      const provider = createMockProvider()
      const t = makeUpdateWorkTool(provider)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1' })).toBe(false)
      expect(schemaValidates(t, { workItemId: 'wi-1' })).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1', workItemId: 'wi-1' })).toBe(true)
    })

    test('updates work item via provider', async () => {
      const workItem = { id: 'wi-1', taskId: 'task-1', author: 'alice', date: '2024-01-16', duration: 'PT3H' }
      const updateWorkItem = mock(() => Promise.resolve(workItem))
      const provider = createMockProvider({ updateWorkItem })
      const result: unknown = await getToolExecutor(makeUpdateWorkTool(provider))({
        taskId: 'task-1',
        workItemId: 'wi-1',
        duration: '3h',
        date: '2024-01-16',
      })
      expect(result).toEqual(workItem)
      expect(updateWorkItem).toHaveBeenCalledWith('task-1', 'wi-1', {
        duration: '3h',
        date: '2024-01-16',
        description: undefined,
        type: undefined,
      })
    })

    test('propagates provider errors', async () => {
      const provider = createMockProvider({
        updateWorkItem: mock(() => Promise.reject(new Error('not found'))),
      })
      await expect(
        getToolExecutor(makeUpdateWorkTool(provider))({ taskId: 'task-1', workItemId: 'wi-1' }),
      ).rejects.toThrow('not found')
    })
  })

  describe('makeRemoveWorkTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const t = makeRemoveWorkTool(provider)
      expect(t.description).toContain('Remove a work item')
    })

    test('schema requires taskId, workItemId, and confidence', () => {
      const provider = createMockProvider()
      const t = makeRemoveWorkTool(provider)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { taskId: 't1', workItemId: 'wi-1' })).toBe(false)
      expect(schemaValidates(t, { taskId: 't1', workItemId: 'wi-1', confidence: 0.9 })).toBe(true)
    })

    test('blocks when confidence is below threshold', async () => {
      const provider = createMockProvider()
      const result = await getToolExecutor(makeRemoveWorkTool(provider))({
        taskId: 't1',
        workItemId: 'wi-1',
        confidence: 0.7,
      })
      expect(result).toMatchObject({ status: 'confirmation_required' })
    })

    test('deletes work item when confidence is sufficient', async () => {
      const deleteWorkItem = mock(() => Promise.resolve({ id: 'wi-1' }))
      const provider = createMockProvider({ deleteWorkItem })
      const result: unknown = await getToolExecutor(makeRemoveWorkTool(provider))({
        taskId: 't1',
        workItemId: 'wi-1',
        confidence: 0.9,
      })
      expect(result).toEqual({ id: 'wi-1' })
      expect(deleteWorkItem).toHaveBeenCalledWith('t1', 'wi-1')
    })

    test('uses label in confirmation message', async () => {
      const provider = createMockProvider()
      const result = await getToolExecutor(makeRemoveWorkTool(provider))({
        taskId: 't1',
        workItemId: 'wi-1',
        label: '2h on 2024-01-15',
        confidence: 0.5,
      })
      expect(result).toMatchObject({ status: 'confirmation_required' })
      expect(result).toMatchObject({
        message: 'Remove work item "2h on 2024-01-15"? This action is irreversible — please confirm.',
      })
    })

    test('propagates provider errors', async () => {
      const provider = createMockProvider({
        deleteWorkItem: mock(() => Promise.reject(new Error('server error'))),
      })
      await expect(
        getToolExecutor(makeRemoveWorkTool(provider))({ taskId: 't1', workItemId: 'wi-1', confidence: 1.0 }),
      ).rejects.toThrow('server error')
    })
  })
})
