import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import type {
  BenchmarkDeferredEntry,
  BenchmarkRecurringEntry,
  BenchmarkStore,
  BenchmarkTask,
} from './tool-surface-benchmark-scenarios-support.js'

type BenchmarkToolName =
  | 'create_task'
  | 'search_tasks'
  | 'list_tasks'
  | 'update_task'
  | 'add_comment'
  | 'find_user'
  | 'get_current_time'
  | 'web_fetch'
  | 'delete_task'
  | 'create_recurring_task'
  | 'create_deferred_prompt'
type ToolInput = Readonly<Record<string, unknown>>
type ToolExecutor = (store: BenchmarkStore, input: ToolInput) => unknown

const toolNames: readonly BenchmarkToolName[] = [
  'create_task',
  'search_tasks',
  'list_tasks',
  'update_task',
  'add_comment',
  'find_user',
  'get_current_time',
  'web_fetch',
  'delete_task',
  'create_recurring_task',
  'create_deferred_prompt',
] as const
const toolSchemas: Readonly<Record<BenchmarkToolName, z.ZodType<ToolInput>>> = {
  create_task: z.object({
    title: z.string().describe('Task title to create.'),
    priority: z.string().optional().describe('Priority to assign to the created task.'),
  }),
  search_tasks: z.object({ query: z.string().describe('Search query for task titles.') }),
  list_tasks: z.object({ projectId: z.string().optional().describe('Optional project identifier to filter tasks.') }),
  update_task: z.object({
    taskId: z.string().describe('Task identifier to update.'),
    status: z.string().optional().describe('Status to apply to the task.'),
    assigneeId: z.string().nullable().optional().describe('Assignee identifier to set on the task.'),
    priority: z.string().optional().describe('Priority to apply to the task.'),
    title: z.string().optional().describe('Replacement title for the task.'),
  }),
  add_comment: z.object({
    taskId: z.string().describe('Task identifier receiving the comment.'),
    comment: z.string().describe('Comment text to append.'),
  }),
  find_user: z.object({ query: z.string().describe('Name or handle to resolve to a user record.') }),
  get_current_time: z.object({}),
  web_fetch: z.object({
    url: z.string().describe('Public URL to fetch.'),
    goal: z.string().optional().describe('Optional reading goal for the fetch.'),
  }),
  delete_task: z.object({
    taskId: z.string().describe('Task identifier to delete.'),
    confidence: z.number().min(0).max(1).describe('Confidence that the user explicitly wants deletion.'),
  }),
  create_recurring_task: z.object({
    title: z.string().describe('Recurring task title.'),
    cadence: z.string().describe('Recurring cadence such as daily or weekly.'),
  }),
  create_deferred_prompt: z.object({
    prompt: z.string().describe('Reminder prompt to schedule.'),
    when: z.string().describe('When the reminder should trigger.'),
  }),
}

const readString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required tool input: ${field}`)
  return value
}
const maybeString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const maybeNullableString = (value: unknown): string | null | undefined => (value === null ? null : maybeString(value))
const currentTask = (store: BenchmarkStore, taskId: string): BenchmarkTask => {
  const task = store.tasks.get(taskId)
  if (task === undefined) throw new Error(`Task not found: ${taskId}`)
  return task
}
const putTask = (store: BenchmarkStore, task: BenchmarkTask): BenchmarkTask => (store.tasks.set(task.id, task), task)
const patchTask = (store: BenchmarkStore, taskId: string, patch: Partial<BenchmarkTask>): BenchmarkTask =>
  putTask(store, { ...currentTask(store, taskId), ...patch })

const createTask: ToolExecutor = (store, input) =>
  putTask(store, {
    id: `task-${store.nextTaskId++}`,
    title: readString(input['title'], 'title'),
    priority: maybeString(input['priority']) ?? 'medium',
    status: 'todo',
    assigneeId: null,
    comments: [],
    deleted: false,
  })
const searchTasks: ToolExecutor = (store, input) =>
  [...store.tasks.values()].filter((task) =>
    task.title.toLowerCase().includes(readString(input['query'], 'query').toLowerCase()),
  )
const listTasks: ToolExecutor = (store) => [...store.tasks.values()]
const updateTask: ToolExecutor = (store, input) => {
  const taskId = readString(input['taskId'], 'taskId')
  const task = currentTask(store, taskId)
  return patchTask(store, taskId, {
    status: maybeString(input['status']) ?? task.status,
    assigneeId: maybeNullableString(input['assigneeId']) ?? task.assigneeId,
    priority: maybeString(input['priority']) ?? task.priority,
    title: maybeString(input['title']) ?? task.title,
  })
}
const addComment: ToolExecutor = (store, input) => {
  const task = currentTask(store, readString(input['taskId'], 'taskId'))
  return putTask(store, { ...task, comments: [...task.comments, readString(input['comment'], 'comment')] })
}
const findUser: ToolExecutor = (_store, input) =>
  readString(input['query'], 'query').toLowerCase().includes('alex')
    ? { id: 'user-alex', name: 'Alex' }
    : { id: 'user-reviewer', name: 'Reviewer' }
const getCurrentTime: ToolExecutor = () => ({ iso: '2026-05-09T09:00:00.000Z', timezone: 'UTC' })
const webFetch: ToolExecutor = (_store, input) => ({
  url: readString(input['url'], 'url'),
  title: 'Benchmark release notes',
})
const deleteTask: ToolExecutor = (store, input) =>
  typeof input['confidence'] === 'number' && input['confidence'] >= 0.85
    ? patchTask(store, readString(input['taskId'], 'taskId'), { deleted: true })
    : {
        status: 'confirmation_required',
        message: `Delete ${readString(input['taskId'], 'taskId')}? Please confirm the benchmark deletion request.`,
      }
const createRecurringTask: ToolExecutor = (store, input) => {
  const entry: BenchmarkRecurringEntry = {
    id: `recurring-${store.nextRecurringId++}`,
    title: readString(input['title'], 'title'),
    cadence: readString(input['cadence'], 'cadence'),
  }
  store.recurringEntries.set(entry.id, entry)
  return entry
}
const createDeferredPrompt: ToolExecutor = (store, input) => {
  const entry: BenchmarkDeferredEntry = {
    id: `deferred-${store.nextDeferredId++}`,
    prompt: readString(input['prompt'], 'prompt'),
    when: readString(input['when'], 'when'),
  }
  store.deferredEntries.set(entry.id, entry)
  return entry
}

const executors: Readonly<Record<BenchmarkToolName, ToolExecutor>> = {
  create_task: createTask,
  search_tasks: searchTasks,
  list_tasks: listTasks,
  update_task: updateTask,
  add_comment: addComment,
  find_user: findUser,
  get_current_time: getCurrentTime,
  web_fetch: webFetch,
  delete_task: deleteTask,
  create_recurring_task: createRecurringTask,
  create_deferred_prompt: createDeferredPrompt,
}

export const buildDirectTools = (store: BenchmarkStore): ToolSet =>
  Object.fromEntries(
    toolNames.map((name) => [
      name,
      tool({
        description: `Benchmark ${name} tool.`,
        inputSchema: toolSchemas[name],
        execute: (input: ToolInput) => (store.toolCalls.push(name), executors[name](store, input)),
      }),
    ]),
  )
