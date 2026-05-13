import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { Task, TaskListItem, TaskRelation } from '../../src/providers/types.js'
import { makeGetTaskTool } from '../../src/tools/get-task.js'
import { makeListTasksTool } from '../../src/tools/list-tasks.js'
import { makeUpdateTaskTool } from '../../src/tools/update-task.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isTaskWithRelations(val: unknown): val is { id: string; title: string; relations: Array<TaskRelation> } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'title' in val &&
    typeof val.title === 'string' &&
    'relations' in val &&
    Array.isArray(val.relations)
  )
}

function isTaskList(val: unknown): val is Array<TaskListItem> {
  return Array.isArray(val) && val.every((item) => item !== null && typeof item === 'object' && 'id' in item)
}

interface TaskWithRelations {
  id: string
  title: string
  relations: Array<TaskRelation>
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const TASK_FIXTURES: Record<string, Task> = {
  'task-1-blocked': {
    id: 'task-1',
    title: 'Blocked task',
    status: 'todo',
    relations: [{ type: 'blocked_by', taskId: 'task-99' }],
    url: 'https://test.com/task/1',
  },
  'task-2-regular': {
    id: 'task-2',
    title: 'Regular task',
    status: 'in-progress',
    relations: [],
    url: 'https://test.com/task/2',
  },
  'task-3-blocked': {
    id: 'task-3',
    title: 'Another blocked task',
    status: 'todo',
    relations: [
      { type: 'blocked_by', taskId: 'task-98' },
      { type: 'related', taskId: 'task-97' },
    ],
    url: 'https://test.com/task/3',
  },
  'task-1-blocking': {
    id: 'task-1',
    title: 'Blocking task',
    status: 'in-progress',
    relations: [{ type: 'blocks', taskId: 'task-99' }],
    url: 'https://test.com/task/1',
  },
  'task-2-empty': {
    id: 'task-2',
    title: 'Regular task',
    status: 'todo',
    relations: [],
    url: 'https://test.com/task/2',
  },
}

function makeGetTaskByIdMap(map: Record<string, Task>): (taskId: string) => Promise<Task> {
  return (taskId: string): Promise<Task> => {
    const task = map[taskId]
    if (task !== undefined) return Promise.resolve(task)
    return Promise.reject(new Error('Task not found'))
  }
}

function hasRelationType(relationType: string): (t: TaskWithRelations) => boolean {
  return (t: TaskWithRelations): boolean => t.relations.some((r) => r.type === relationType)
}

async function collectTasksByRelationType(
  tasks: Array<TaskListItem>,
  getTaskExecute: (args: { taskId: string }, opts: { toolCallId: string; messages: [] }) => Promise<unknown>,
  relationType: string,
): Promise<Array<TaskWithRelations>> {
  const result: Array<TaskWithRelations> = []
  for (const task of tasks) {
    const details: unknown = await getTaskExecute({ taskId: task.id }, { toolCallId: '1', messages: [] })
    assert(isTaskWithRelations(details), 'Invalid result')
    if (hasRelationType(relationType)(details)) {
      result.push(details)
    }
  }
  return result
}

function isHighPriorityDueInWindow(startOfWeek: Date, endOfWeek: Date): (t: TaskListItem) => boolean {
  return (t: TaskListItem): boolean => {
    if (t.priority !== 'high') return false
    if (t.dueDate === null || t.dueDate === undefined) return false
    const dueDate = new Date(t.dueDate)
    return dueDate >= startOfWeek && dueDate <= endOfWeek
  }
}

function isHighOrUrgentPriorityDueInWindow(startOfWeek: Date, endOfWeek: Date): (t: TaskListItem) => boolean {
  return (t: TaskListItem): boolean => {
    if (t.priority !== 'high' && t.priority !== 'urgent') return false
    if (t.dueDate === null || t.dueDate === undefined) return false
    const dueDate = new Date(t.dueDate)
    return dueDate >= startOfWeek && dueDate <= endOfWeek
  }
}

const MULTI_PROJECT_TASKS: Record<string, Array<TaskListItem>> = {
  'proj-1': [
    {
      id: 'task-1',
      title: 'Backend high priority',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-03-25T12:00:00Z',
      url: 'https://test.com/task/1',
    },
  ],
  'proj-2': [
    {
      id: 'task-2',
      title: 'Frontend high priority',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-03-26T12:00:00Z',
      url: 'https://test.com/task/2',
    },
  ],
}

function listTasksByProjectId(projectId: string): Promise<Array<TaskListItem>> {
  return Promise.resolve(MULTI_PROJECT_TASKS[projectId] ?? [])
}

function makeUpdateTaskMockAlwaysTodo(taskId: string, params: { status?: string }): Promise<Task> {
  return Promise.resolve({
    id: taskId,
    title: 'Task',
    status: params.status ?? 'todo',
    url: 'https://test.com/task/1',
  })
}

function makeUpdateTaskMockWithPartialFailure(
  failTaskId: string,
): (taskId: string, params: { status?: string }) => Promise<Task> {
  return (taskId: string, params: { status?: string }): Promise<Task> => {
    if (taskId === failTaskId) {
      return Promise.reject(new Error('Permission denied'))
    }
    return Promise.resolve({
      id: taskId,
      title: 'Task',
      status: params.status ?? 'todo',
      url: 'https://test.com/task/1',
    })
  }
}

describe('Task Scenarios', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  describe('Find blocked tasks', () => {
    test('filters tasks with blocked_by relations', async () => {
      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            { id: 'task-1', title: 'Blocked task', status: 'todo', url: 'https://test.com/task/1' },
            { id: 'task-2', title: 'Regular task', status: 'in-progress', url: 'https://test.com/task/2' },
            { id: 'task-3', title: 'Another blocked task', status: 'todo', url: 'https://test.com/task/3' },
          ]),
        ),
        getTask: mock(
          makeGetTaskByIdMap({
            'task-1': TASK_FIXTURES['task-1-blocked']!,
            'task-2': TASK_FIXTURES['task-2-regular']!,
            'task-3': TASK_FIXTURES['task-3-blocked']!,
          }),
        ),
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const getTool = makeGetTaskTool(provider)
      assert(getTool.execute, 'Tool execute is undefined')

      const blockedTasks = await collectTasksByRelationType(tasksResult, getTool.execute, 'blocked_by')

      expect(blockedTasks).toHaveLength(2)
      expect(blockedTasks[0]?.id).toBe('task-1')
      expect(blockedTasks[1]?.id).toBe('task-3')
    })

    test('returns empty array when no blocked tasks', async () => {
      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([{ id: 'task-1', title: 'Regular task', status: 'todo', url: 'https://test.com/task/1' }]),
        ),
        getTask: mock(
          (): Promise<Task> =>
            Promise.resolve({
              id: 'task-1',
              title: 'Regular task',
              status: 'todo',
              relations: [{ type: 'related', taskId: 'task-99' }],
              url: 'https://test.com/task/1',
            }),
        ),
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const getTool = makeGetTaskTool(provider)
      assert(getTool.execute, 'Tool execute is undefined')

      const blockedTasks = await collectTasksByRelationType(tasksResult, getTool.execute, 'blocked_by')

      expect(blockedTasks).toHaveLength(0)
    })

    test('finds tasks that block others', async () => {
      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            { id: 'task-1', title: 'Blocking task', status: 'in-progress', url: 'https://test.com/task/1' },
            { id: 'task-2', title: 'Regular task', status: 'todo', url: 'https://test.com/task/2' },
          ]),
        ),
        getTask: mock(
          makeGetTaskByIdMap({
            'task-1': TASK_FIXTURES['task-1-blocking']!,
            'task-2': TASK_FIXTURES['task-2-empty']!,
          }),
        ),
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const getTool = makeGetTaskTool(provider)
      assert(getTool.execute, 'Tool execute is undefined')

      const blockingTasks = await collectTasksByRelationType(tasksResult, getTool.execute, 'blocks')

      expect(blockingTasks).toHaveLength(1)
      expect(blockingTasks[0]?.id).toBe('task-1')
    })
  })

  describe('Bulk move to todo', () => {
    test('moves multiple in-progress tasks to todo', async () => {
      const updateTask = mock(makeUpdateTaskMockAlwaysTodo)

      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            { id: 'task-1', title: 'Task 1', status: 'in-progress', url: 'https://test.com/task/1' },
            { id: 'task-2', title: 'Task 2', status: 'in-progress', url: 'https://test.com/task/2' },
            { id: 'task-3', title: 'Task 3', status: 'in-progress', url: 'https://test.com/task/3' },
          ]),
        ),
        updateTask,
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const inProgressTasks = tasksResult.filter((t) => t.status === 'in-progress')

      const updateTool = makeUpdateTaskTool(provider)
      assert(updateTool.execute, 'Tool execute is undefined')

      for (const task of inProgressTasks) {
        await updateTool.execute({ taskId: task.id, status: 'todo' }, { toolCallId: '1', messages: [] })
      }

      expect(updateTask).toHaveBeenCalledTimes(3)
      expect(updateTask).toHaveBeenCalledWith('task-1', { status: 'todo' })
      expect(updateTask).toHaveBeenCalledWith('task-2', { status: 'todo' })
      expect(updateTask).toHaveBeenCalledWith('task-3', { status: 'todo' })
    })

    test('only moves tasks matching filter criteria', async () => {
      const updateTask = mock(makeUpdateTaskMockAlwaysTodo)

      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            { id: 'task-1', title: 'Task 1', status: 'in-progress', url: 'https://test.com/task/1' },
            { id: 'task-2', title: 'Task 2', status: 'done', url: 'https://test.com/task/2' },
            { id: 'task-3', title: 'Task 3', status: 'in-progress', url: 'https://test.com/task/3' },
          ]),
        ),
        updateTask,
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const inProgressTasks = tasksResult.filter((t) => t.status === 'in-progress')

      const updateTool = makeUpdateTaskTool(provider)
      assert(updateTool.execute, 'Tool execute is undefined')

      for (const task of inProgressTasks) {
        await updateTool.execute({ taskId: task.id, status: 'todo' }, { toolCallId: '1', messages: [] })
      }

      expect(updateTask).toHaveBeenCalledTimes(2)
    })

    test('handles partial failures in bulk operation', async () => {
      const updateTask = mock(makeUpdateTaskMockWithPartialFailure('task-2'))

      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            { id: 'task-1', title: 'Task 1', status: 'in-progress', url: 'https://test.com/task/1' },
            { id: 'task-2', title: 'Task 2', status: 'in-progress', url: 'https://test.com/task/2' },
            { id: 'task-3', title: 'Task 3', status: 'in-progress', url: 'https://test.com/task/3' },
          ]),
        ),
        updateTask,
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const updateTool = makeUpdateTaskTool(provider)
      assert(updateTool.execute, 'Tool execute is undefined')

      const errors: Array<{ taskId: string; error: string }> = []
      for (const task of tasksResult) {
        try {
          await updateTool.execute({ taskId: task.id, status: 'todo' }, { toolCallId: '1', messages: [] })
        } catch (error) {
          errors.push({ taskId: task.id, error: extractErrorMessage(error) })
        }
      }

      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ taskId: 'task-2', error: 'Permission denied' })
    })
  })

  describe('High-priority due this week', () => {
    test('filters tasks by high priority and due date within this week', async () => {
      const startOfWeek = new Date('2026-03-23T00:00:00Z')
      const endOfWeek = new Date('2026-03-29T23:59:59Z')

      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            {
              id: 'task-1',
              title: 'High priority this week',
              status: 'todo',
              priority: 'high',
              dueDate: '2026-03-25T12:00:00Z',
              url: 'https://test.com/task/1',
            },
            {
              id: 'task-2',
              title: 'Low priority this week',
              status: 'todo',
              priority: 'low',
              dueDate: '2026-03-26T12:00:00Z',
              url: 'https://test.com/task/2',
            },
            {
              id: 'task-3',
              title: 'High priority next week',
              status: 'todo',
              priority: 'high',
              dueDate: '2026-04-01T12:00:00Z',
              url: 'https://test.com/task/3',
            },
            {
              id: 'task-4',
              title: 'High priority no due date',
              status: 'todo',
              priority: 'high',
              url: 'https://test.com/task/4',
            },
          ]),
        ),
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const highPriorityThisWeek = tasksResult.filter(isHighPriorityDueInWindow(startOfWeek, endOfWeek))

      expect(highPriorityThisWeek).toHaveLength(1)
      expect(highPriorityThisWeek[0]?.id).toBe('task-1')
    })

    test('handles urgent priority as well as high', async () => {
      const startOfWeek = new Date('2026-03-23T00:00:00Z')
      const endOfWeek = new Date('2026-03-29T23:59:59Z')

      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            {
              id: 'task-1',
              title: 'High priority',
              status: 'todo',
              priority: 'high',
              dueDate: '2026-03-25T12:00:00Z',
              url: 'https://test.com/task/1',
            },
            {
              id: 'task-2',
              title: 'Urgent priority',
              status: 'todo',
              priority: 'urgent',
              dueDate: '2026-03-26T12:00:00Z',
              url: 'https://test.com/task/2',
            },
          ]),
        ),
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const highPriorityThisWeek = tasksResult.filter(isHighOrUrgentPriorityDueInWindow(startOfWeek, endOfWeek))

      expect(highPriorityThisWeek).toHaveLength(2)
    })

    test('returns empty array when no high priority tasks due this week', async () => {
      const startOfWeek = new Date('2026-03-23T00:00:00Z')
      const endOfWeek = new Date('2026-03-29T23:59:59Z')

      const provider = createMockProvider({
        listTasks: mock(() =>
          Promise.resolve([
            {
              id: 'task-1',
              title: 'Low priority this week',
              status: 'todo',
              priority: 'low',
              dueDate: '2026-03-25T12:00:00Z',
              url: 'https://test.com/task/1',
            },
            {
              id: 'task-2',
              title: 'High priority next week',
              status: 'todo',
              priority: 'high',
              dueDate: '2026-04-01T12:00:00Z',
              url: 'https://test.com/task/2',
            },
          ]),
        ),
      })

      const listTool = makeListTasksTool(provider)
      assert(listTool.execute, 'Tool execute is undefined')
      const tasksResult: unknown = await listTool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
      assert(isTaskList(tasksResult), 'Invalid result')

      const highPriorityThisWeek = tasksResult.filter(isHighOrUrgentPriorityDueInWindow(startOfWeek, endOfWeek))

      expect(highPriorityThisWeek).toHaveLength(0)
    })

    test('handles tasks across multiple projects', async () => {
      const startOfWeek = new Date('2026-03-23T00:00:00Z')
      const endOfWeek = new Date('2026-03-29T23:59:59Z')

      const listProjects = mock(() =>
        Promise.resolve([
          { id: 'proj-1', name: 'Backend', url: 'https://test.com/project/1' },
          { id: 'proj-2', name: 'Frontend', url: 'https://test.com/project/2' },
        ]),
      )

      const listTasks = mock(listTasksByProjectId)

      const projects = await listProjects()
      const allHighPriorityTasks: TaskListItem[] = []

      for (const project of projects) {
        const tasks = await listTasks(project.id)
        const projectHighPriority = tasks.filter(isHighOrUrgentPriorityDueInWindow(startOfWeek, endOfWeek))
        allHighPriorityTasks.push(...projectHighPriority)
      }

      expect(allHighPriorityTasks).toHaveLength(2)
    })
  })
})
