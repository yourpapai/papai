// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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

    test('returns already_present for Kaneo when task already has label by visible name', async () => {
      const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'workspace-label-1' }))
      const provider = createMockProvider({
        name: 'kaneo',
        listTaskLabels: mock(() => Promise.resolve([{ id: 'task-label-1', name: 'Feature', color: '#ff0000' }])),
        listLabels: mock(() => Promise.resolve([{ id: 'workspace-label-1', name: 'Feature', color: '#ff0000' }])),
        addTaskLabel,
      })

      const tool = makeAddTaskLabelTool(provider)
      assertToolExecute(tool)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelName: 'Feature' },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({
        status: 'already_present',
        taskId: 'task-1',
        labelName: 'Feature',
        taskLabelIds: ['task-label-1'],
      })
      expect(addTaskLabel).not.toHaveBeenCalled()
    })

    test('Kaneo still resolves reusable workspace label when task does not already have it', async () => {
      const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'workspace-label-1' }))
      const provider = createMockProvider({
        name: 'kaneo',
        listTaskLabels: mock(() => Promise.resolve([])),
        listLabels: mock(() => Promise.resolve([{ id: 'workspace-label-1', name: 'Feature', color: '#ff0000' }])),
        addTaskLabel,
      })

      const tool = makeAddTaskLabelTool(provider)
      assertToolExecute(tool)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelName: 'Feature' },
        { toolCallId: '1', messages: [] },
      )

      assertTaskLabel(result)
      expect(result).toEqual({ taskId: 'task-1', labelId: 'workspace-label-1' })
      expect(addTaskLabel).toHaveBeenCalledWith('task-1', 'workspace-label-1')
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

    test('returns already_absent for Kaneo when task does not currently have label by visible name', async () => {
      const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'task-label-1' }))
      const provider = createMockProvider({
        name: 'kaneo',
        listTaskLabels: mock(() => Promise.resolve([])),
        removeTaskLabel,
      })

      const tool = makeRemoveTaskLabelTool(provider)
      const result: unknown = await getToolExecutor(tool)(
        { taskId: 'task-1', labelName: 'Feature' },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({
        status: 'already_absent',
        taskId: 'task-1',
        labelName: 'Feature',
      })
      expect(result).not.toHaveProperty('labelId')
      expect(removeTaskLabel).not.toHaveBeenCalled()
    })

    test('returns already_absent for Kaneo when task does not currently have label by id', async () => {
      const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'task-label-1' }))
      const provider = createMockProvider({
        name: 'kaneo',
        listTaskLabels: mock(() => Promise.resolve([])),
        removeTaskLabel,
      })

      const tool = makeRemoveTaskLabelTool(provider)
      const result: unknown = await getToolExecutor(tool)(
        { taskId: 'task-1', labelId: 'missing-label-id' },
        { toolCallId: '1', messages: [] },
      )

      expect(result).toMatchObject({
        status: 'already_absent',
        taskId: 'task-1',
        labelId: 'missing-label-id',
      })
      expect(result).not.toHaveProperty('labelName')
      expect(removeTaskLabel).not.toHaveBeenCalled()
    })

    test('Kaneo removes task label by task-scoped label id resolved from task labels', async () => {
      const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'task-label-1' }))
      const provider = createMockProvider({
        name: 'kaneo',
        listTaskLabels: mock(() => Promise.resolve([{ id: 'task-label-1', name: 'Feature', color: '#ff0000' }])),
        removeTaskLabel,
      })

      const tool = makeRemoveTaskLabelTool(provider)
      assertToolExecute(tool)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelName: 'Feature' },
        { toolCallId: '1', messages: [] },
      )

      assertTaskLabel(result)
      expect(result).toEqual({ taskId: 'task-1', labelId: 'task-label-1' })
      expect(removeTaskLabel).toHaveBeenCalledWith('task-1', 'task-label-1')
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
