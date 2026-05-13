import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeAddTaskLabelTool } from '../../src/tools/add-task-label.js'
import { makeRemoveTaskLabelTool } from '../../src/tools/remove-task-label.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isTaskLabel(val: unknown): val is { taskId: string; labelId: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'taskId' in val &&
    typeof val.taskId === 'string' &&
    'labelId' in val &&
    typeof val.labelId === 'string'
  )
}

function assertTaskLabel(val: unknown): asserts val is { taskId: string; labelId: string } {
  assert(isTaskLabel(val), 'expected a valid task label result')
}

function assertToolExecute<T extends { execute?: unknown }>(
  tool: T,
): asserts tool is T & { execute: NonNullable<T['execute']> } {
  assert(tool.execute !== undefined, 'Tool execute is undefined')
}

describe('Task Label Tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  describe('makeAddTaskLabelTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskLabelTool(provider)
      expect(tool.description).toContain('Add a label to a task')
    })

    test('adds label to task', async () => {
      const provider = createMockProvider({
        addTaskLabel: mock(() =>
          Promise.resolve({
            taskId: 'task-1',
            labelId: 'label-1',
          }),
        ),
      })

      const tool = makeAddTaskLabelTool(provider)
      assertToolExecute(tool)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      assertTaskLabel(result)

      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
    })

    test('calls provider addTaskLabel with correct params', async () => {
      const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' }))
      const provider = createMockProvider({ addTaskLabel })

      const tool = makeAddTaskLabelTool(provider)
      assertToolExecute(tool)
      await tool.execute({ taskId: 'task-1', labelId: 'label-1' }, { toolCallId: '1', messages: [] })

      expect(addTaskLabel).toHaveBeenCalledTimes(1)
      expect(addTaskLabel).toHaveBeenCalledWith('task-1', 'label-1')
    })

    test('resolves labelName to labelId before adding label', async () => {
      const listLabels = mock(() => Promise.resolve([{ id: 'label-1', name: 'blocked' }]))
      const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' }))
      const provider = createMockProvider({ listLabels, addTaskLabel })

      const tool = makeAddTaskLabelTool(provider)
      assertToolExecute(tool)
      await tool.execute({ taskId: 'task-1', labelName: 'blocked' }, { toolCallId: '1', messages: [] })

      expect(listLabels).toHaveBeenCalledTimes(1)
      expect(addTaskLabel).toHaveBeenCalledWith('task-1', 'label-1')
    })

    test('returns clear error when labelName does not match a visible label', async () => {
      const listLabels = mock(() => Promise.resolve([{ id: 'label-1', name: 'blocked' }]))
      const provider = createMockProvider({ listLabels })

      const tool = makeAddTaskLabelTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', labelName: 'missing' },
        { toolCallId: '1', messages: [] },
      )

      await expect(promise).rejects.toThrow('Label not found: missing')
    })

    test('returns clear error when labelName matches multiple visible labels', async () => {
      const listLabels = mock(() =>
        Promise.resolve([
          { id: 'label-1', name: 'blocked' },
          { id: 'label-2', name: 'blocked' },
        ]),
      )
      const provider = createMockProvider({ listLabels })

      const tool = makeAddTaskLabelTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', labelName: 'blocked' },
        { toolCallId: '1', messages: [] },
      )

      await expect(promise).rejects.toThrow('Multiple labels found: blocked')
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        addTaskLabel: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeAddTaskLabelTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates label not found error', async () => {
      const provider = createMockProvider({
        addTaskLabel: mock(() => Promise.reject(new Error('Label not found'))),
      })

      const tool = makeAddTaskLabelTool(provider)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', labelId: 'invalid' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskLabelTool(provider)
      expect(schemaValidates(tool, { labelId: 'label-1' })).toBe(false)
    })

    test('validates either labelId or labelName is required', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskLabelTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    })

    test('validates labelName is accepted', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskLabelTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', labelName: 'blocked' })).toBe(true)
    })

    test('validates exactly one of labelId or labelName is provided', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskLabelTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', labelId: 'label-1', labelName: 'blocked' })).toBe(false)
    })

    test('adding label already present on task — document behavior', async () => {
      const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' }))
      const provider = createMockProvider({ addTaskLabel })

      const tool = makeAddTaskLabelTool(provider)
      assertToolExecute(tool)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      assertTaskLabel(result)

      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
      expect(addTaskLabel).toHaveBeenCalledWith('task-1', 'label-1')
    })
  })

  describe('makeRemoveTaskLabelTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskLabelTool(provider)
      expect(tool.description).toContain('Remove a label from a task')
    })

    test('removes label from task', async () => {
      const provider = createMockProvider({
        removeTaskLabel: mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' })),
      })

      const tool = makeRemoveTaskLabelTool(provider)
      assertToolExecute(tool)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      assertTaskLabel(result)

      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
    })

    test('calls provider removeTaskLabel with correct params', async () => {
      const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' }))
      const provider = createMockProvider({ removeTaskLabel })

      const tool = makeRemoveTaskLabelTool(provider)
      assertToolExecute(tool)
      await tool.execute({ taskId: 'task-1', labelId: 'label-1' }, { toolCallId: '1', messages: [] })

      expect(removeTaskLabel).toHaveBeenCalledTimes(1)
      expect(removeTaskLabel).toHaveBeenCalledWith('task-1', 'label-1')
    })

    test('resolves labelName to labelId before removing label', async () => {
      const listLabels = mock(() => Promise.resolve([{ id: 'label-1', name: 'blocked' }]))
      const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' }))
      const provider = createMockProvider({ listLabels, removeTaskLabel })

      const tool = makeRemoveTaskLabelTool(provider)
      assertToolExecute(tool)
      await tool.execute({ taskId: 'task-1', labelName: 'blocked' }, { toolCallId: '1', messages: [] })

      expect(listLabels).toHaveBeenCalledTimes(1)
      expect(removeTaskLabel).toHaveBeenCalledWith('task-1', 'label-1')
    })

    test('returns clear error when labelName does not match a visible label for removal', async () => {
      const listLabels = mock(() => Promise.resolve([{ id: 'label-1', name: 'blocked' }]))
      const provider = createMockProvider({ listLabels })

      const tool = makeRemoveTaskLabelTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', labelName: 'missing' },
        { toolCallId: '1', messages: [] },
      )

      await expect(promise).rejects.toThrow('Label not found: missing')
    })

    test('returns clear error when labelName matches multiple visible labels for removal', async () => {
      const listLabels = mock(() =>
        Promise.resolve([
          { id: 'label-1', name: 'blocked' },
          { id: 'label-2', name: 'blocked' },
        ]),
      )
      const provider = createMockProvider({ listLabels })

      const tool = makeRemoveTaskLabelTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', labelName: 'blocked' },
        { toolCallId: '1', messages: [] },
      )

      await expect(promise).rejects.toThrow('Multiple labels found: blocked')
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        removeTaskLabel: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeRemoveTaskLabelTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates label not found error', async () => {
      const provider = createMockProvider({
        removeTaskLabel: mock(() => Promise.reject(new Error('Label not found'))),
      })

      const tool = makeRemoveTaskLabelTool(provider)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', labelId: 'invalid' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskLabelTool(provider)
      expect(schemaValidates(tool, { labelId: 'label-1' })).toBe(false)
    })

    test('validates either labelId or labelName is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskLabelTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    })

    test('validates labelName is accepted', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskLabelTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', labelName: 'blocked' })).toBe(true)
    })

    test('validates exactly one of labelId or labelName is provided', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskLabelTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1', labelId: 'label-1', labelName: 'blocked' })).toBe(false)
    })
  })
})
