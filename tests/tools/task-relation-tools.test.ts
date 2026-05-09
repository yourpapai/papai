import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeAddTaskRelationTool } from '../../src/tools/add-task-relation.js'
import { makeRemoveTaskRelationTool } from '../../src/tools/remove-task-relation.js'
import { makeUpdateTaskRelationTool } from '../../src/tools/update-task-relation.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isTaskRelation(val: unknown): val is { taskId: string; relatedTaskId: string; type: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'taskId' in val &&
    typeof val.taskId === 'string' &&
    'relatedTaskId' in val &&
    typeof val.relatedTaskId === 'string' &&
    'type' in val &&
    typeof val.type === 'string'
  )
}

function isRemoveResult(val: unknown): val is { taskId: string; relatedTaskId: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'taskId' in val &&
    typeof (val as Record<string, unknown>)['taskId'] === 'string' &&
    'relatedTaskId' in val &&
    typeof (val as Record<string, unknown>)['relatedTaskId'] === 'string'
  )
}

describe('Task Relation Tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  describe('makeAddTaskRelationTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskRelationTool(provider)
      expect(tool.description).toContain('Create a directed relation between two tasks')
    })

    test('adds blocks relation', async () => {
      const provider = createMockProvider({
        addRelation: mock(() =>
          Promise.resolve({
            taskId: 'task-1',
            relatedTaskId: 'task-2',
            type: 'blocks',
          }),
        ),
      })

      const tool = makeAddTaskRelationTool(provider)
      const result: unknown = await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      assert(isTaskRelation(result))

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('blocks')
    })

    test('adds duplicate relation', async () => {
      const addRelation = mock((_taskId: string, _relatedTaskId: string, type: string) =>
        Promise.resolve({
          taskId: 'task-1',
          relatedTaskId: 'task-2',
          type,
        }),
      )
      const provider = createMockProvider({ addRelation })

      const tool = makeAddTaskRelationTool(provider)
      await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'duplicate' },
        { toolCallId: '1', messages: [] },
      )

      expect(addRelation).toHaveBeenCalledWith('task-1', 'task-2', 'duplicate')
    })

    test('adds related relation', async () => {
      const addRelation = mock((_taskId: string, _relatedTaskId: string, type: string) =>
        Promise.resolve({
          taskId: 'task-1',
          relatedTaskId: 'task-2',
          type,
        }),
      )
      const provider = createMockProvider({ addRelation })

      const tool = makeAddTaskRelationTool(provider)
      await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' },
        { toolCallId: '1', messages: [] },
      )

      expect(addRelation).toHaveBeenCalledWith('task-1', 'task-2', 'related')
    })

    test('adds parent relation', async () => {
      const addRelation = mock((_taskId: string, _relatedTaskId: string, type: string) =>
        Promise.resolve({
          taskId: 'task-1',
          relatedTaskId: 'task-2',
          type,
        }),
      )
      const provider = createMockProvider({ addRelation })

      const tool = makeAddTaskRelationTool(provider)
      await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'parent' },
        { toolCallId: '1', messages: [] },
      )

      expect(addRelation).toHaveBeenCalledWith('task-1', 'task-2', 'parent')
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        addRelation: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeAddTaskRelationTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', relatedTaskId: 'task-2', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskRelationTool(provider)
      expect(schemaValidates(tool, { relatedTaskId: 'task-2', type: 'blocks' })).toBe(false)
    })

    test('validates relatedTaskId is required', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskRelationTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', type: 'blocks' })).toBe(false)
    })

    test('validates type is required', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskRelationTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', relatedTaskId: 'task-2' })).toBe(false)
    })

    test('validates type is from allowed enum', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskRelationTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', relatedTaskId: 'task-2', type: 'invalid' })).toBe(false)
    })

    test('adding self-relation (taskId === relatedTaskId) — document behavior', async () => {
      const addRelation = mock((_taskId: string, _relatedTaskId: string, _type: string) =>
        Promise.resolve({
          taskId: 'task-1',
          relatedTaskId: 'task-1',
          type: 'blocks',
        }),
      )
      const provider = createMockProvider({ addRelation })

      const tool = makeAddTaskRelationTool(provider)
      const result: unknown = await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-1', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      assert(isTaskRelation(result))

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-1')
      expect(addRelation).toHaveBeenCalledWith('task-1', 'task-1', 'blocks')
    })

    test('adding duplicate relation (same taskId/relatedTaskId/type) — both calls succeed', async () => {
      const addRelation = mock((_taskId: string, _relatedTaskId: string, _type: string) =>
        Promise.resolve({
          taskId: 'task-1',
          relatedTaskId: 'task-2',
          type: 'blocks',
        }),
      )
      const provider = createMockProvider({ addRelation })

      const tool = makeAddTaskRelationTool(provider)
      await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' },
        { toolCallId: '2', messages: [] },
      )

      expect(addRelation).toHaveBeenCalledTimes(2)
    })
  })

  describe('makeUpdateTaskRelationTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeUpdateTaskRelationTool(provider)
      expect(tool.description).toContain('Update the type of an existing relation')
    })

    test('updates relation type from blocks to related', async () => {
      const provider = createMockProvider({
        updateRelation: mock(() =>
          Promise.resolve({
            taskId: 'task-1',
            relatedTaskId: 'task-2',
            type: 'related',
          }),
        ),
      })

      const tool = makeUpdateTaskRelationTool(provider)
      const result: unknown = await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' },
        { toolCallId: '1', messages: [] },
      )
      assert(isTaskRelation(result))

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('related')
    })

    test('updates relation type to duplicate', async () => {
      const updateRelation = mock((_taskId: string, _relatedTaskId: string, type: string) =>
        Promise.resolve({
          taskId: 'task-1',
          relatedTaskId: 'task-2',
          type,
        }),
      )
      const provider = createMockProvider({ updateRelation })

      const tool = makeUpdateTaskRelationTool(provider)
      await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'duplicate' },
        { toolCallId: '1', messages: [] },
      )

      expect(updateRelation).toHaveBeenCalledWith('task-1', 'task-2', 'duplicate')
    })

    test('updates relation type to parent', async () => {
      const updateRelation = mock((_taskId: string, _relatedTaskId: string, type: string) =>
        Promise.resolve({
          taskId: 'task-1',
          relatedTaskId: 'task-2',
          type,
        }),
      )
      const provider = createMockProvider({ updateRelation })

      const tool = makeUpdateTaskRelationTool(provider)
      await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'parent' },
        { toolCallId: '1', messages: [] },
      )

      expect(updateRelation).toHaveBeenCalledWith('task-1', 'task-2', 'parent')
    })

    test('propagates relation not found error', async () => {
      const provider = createMockProvider({
        updateRelation: mock(() => Promise.reject(new Error('Relation not found'))),
      })

      const tool = makeUpdateTaskRelationTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', relatedTaskId: 'invalid', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Relation not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateTaskRelationTool(provider)
      expect(schemaValidates(tool, { relatedTaskId: 'task-2', type: 'blocks' })).toBe(false)
    })

    test('validates relatedTaskId is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateTaskRelationTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', type: 'blocks' })).toBe(false)
    })

    test('validates type is required', () => {
      const provider = createMockProvider()
      const tool = makeUpdateTaskRelationTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', relatedTaskId: 'task-2' })).toBe(false)
    })
  })

  describe('makeRemoveTaskRelationTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskRelationTool(provider)
      expect(tool.description).toContain('Remove a relation between two tasks')
    })

    test('removes relation successfully', async () => {
      const provider = createMockProvider({
        removeRelation: mock(() => Promise.resolve({ taskId: 'task-1', relatedTaskId: 'task-2' })),
      })

      const tool = makeRemoveTaskRelationTool(provider)
      const result: unknown = await tool.execute!(
        { taskId: 'task-1', relatedTaskId: 'task-2' },
        { toolCallId: '1', messages: [] },
      )
      assert(isRemoveResult(result))

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        removeRelation: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeRemoveTaskRelationTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', relatedTaskId: 'task-2' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates relation not found error', async () => {
      const provider = createMockProvider({
        removeRelation: mock(() => Promise.reject(new Error('Relation not found'))),
      })

      const tool = makeRemoveTaskRelationTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', relatedTaskId: 'invalid' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Relation not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskRelationTool(provider)
      expect(schemaValidates(tool, { relatedTaskId: 'task-2' })).toBe(false)
    })

    test('validates relatedTaskId is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskRelationTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    })
  })
})
