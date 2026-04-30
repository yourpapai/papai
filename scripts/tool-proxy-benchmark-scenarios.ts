import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { makeToolProxy } from '../src/tools/tool-proxy.js'
import type { BenchmarkMode, BenchmarkResult } from './tool-proxy-benchmark.js'

type BenchmarkCounts = Record<'toolCallCount' | 'stepCount', number>
type TaskRecord = Readonly<Record<string, unknown>>

export type BenchmarkScenarioSnapshot = Readonly<{ tasks: readonly TaskRecord[]; toolCalls: readonly string[] }>
export type BenchmarkStore = { readonly tasks: Map<string, TaskRecord>; readonly toolCalls: string[]; nextId: number }
export type BenchmarkScenario = Readonly<{ id: string; prompt: string }>

const toolNames = [
  'create_task',
  'search_tasks',
  'update_task',
  'add_comment',
  'assign_user',
  'get_current_time',
  'web_lookup',
  'delete_task',
] as const
type BenchmarkToolName = (typeof toolNames)[number]
const toolSchemas: Readonly<Record<BenchmarkToolName, z.ZodType<Readonly<Record<string, unknown>>>>> = {
  create_task: z.object({
    title: z.string().describe('Task title to create.'),
    description: z.string().optional().describe('Optional task description.'),
  }),
  search_tasks: z.object({
    query: z.string().describe('Search query for task titles.'),
  }),
  update_task: z.object({
    taskId: z.string().describe('Task identifier to update.'),
    status: z.string().optional().describe('Optional status to apply.'),
    title: z.string().optional().describe('Optional replacement task title.'),
  }),
  add_comment: z.object({
    taskId: z.string().describe('Task identifier receiving the comment.'),
    comment: z.string().describe('Comment text to append.'),
  }),
  assign_user: z.object({
    taskId: z.string().describe('Task identifier to assign.'),
    username: z.string().describe('Username to assign to the task.'),
  }),
  get_current_time: z.object({}),
  web_lookup: z.object({
    topic: z.string().describe('Topic to look up.'),
  }),
  delete_task: z.object({
    taskId: z.string().describe('Task identifier to delete.'),
    label: z.string().optional().describe('Human-readable task title for the confirmation message.'),
    confidence: z.number().min(0).max(1).describe('Confidence from 0 to 1 that the user explicitly wants deletion.'),
  }),
}

const evaluation = (
  success: boolean,
  failureCategory: string,
): Pick<BenchmarkResult, 'success' | 'failureCategory'> => ({
  success,
  failureCategory: success ? null : failureCategory,
})
const hasCalls = (snapshot: BenchmarkScenarioSnapshot, calls: readonly string[]): boolean =>
  calls.every((call) => snapshot.toolCalls.includes(call))
const taskById = (snapshot: BenchmarkScenarioSnapshot, id: string): TaskRecord | undefined =>
  snapshot.tasks.find((task) => task['id'] === id)

export function evaluateBenchmarkScenario(
  scenarioName: string,
  snapshot: BenchmarkScenarioSnapshot,
): Pick<BenchmarkResult, 'success' | 'failureCategory'> {
  if (scenarioName === 'create-task') {
    return evaluation(
      hasCalls(snapshot, ['create_task']) && snapshot.tasks.some((task) => task['title'] === 'Write proxy benchmark'),
      'validation_failed',
    )
  }
  if (scenarioName === 'search-update-task') {
    const task = taskById(snapshot, 'task-1')
    return evaluation(
      hasCalls(snapshot, ['search_tasks', 'update_task']) && task !== undefined && task['status'] === 'in_progress',
      'validation_failed',
    )
  }
  if (scenarioName === 'comment-existing-task') {
    const task = taskById(snapshot, 'task-1')
    const comments = task === undefined ? [] : task['comments']
    return evaluation(
      hasCalls(snapshot, ['add_comment']) && Array.isArray(comments) && comments.includes('include proxy mode'),
      'validation_failed',
    )
  }
  if (scenarioName === 'time-web-lookup') {
    return evaluation(hasCalls(snapshot, ['get_current_time', 'web_lookup']), 'validation_failed')
  }
  if (scenarioName === 'delete-needs-confirmation') {
    const task = taskById(snapshot, 'task-1')
    return evaluation(
      snapshot.toolCalls.includes('delete_task') && task !== undefined && task['deleted'] !== true,
      'confirmation_error',
    )
  }
  return evaluation(false, 'validation_failed')
}

export const scenarios: readonly BenchmarkScenario[] = [
  { id: 'create-task', prompt: 'Create a task titled "Write proxy benchmark".' },
  { id: 'search-update-task', prompt: 'Find the release notes task and mark it in progress.' },
  { id: 'comment-existing-task', prompt: 'Add comment "include proxy mode" to task-1.' },
  { id: 'time-web-lookup', prompt: 'Check current time and look up release notes context.' },
  { id: 'delete-needs-confirmation', prompt: 'Try to delete task-1 without explicit confirmation.' },
]

export const createBenchmarkStore = (): BenchmarkStore => ({
  tasks: new Map<string, TaskRecord>().set('task-1', {
    id: 'task-1',
    title: 'Write release notes',
    status: 'open',
    comments: [] as readonly string[],
    deleted: false,
  }),
  toolCalls: [],
  nextId: 2,
})

export const resultForRun = (
  model: string,
  mode: BenchmarkMode,
  scenario: BenchmarkScenario,
  outcome: Pick<BenchmarkResult, 'success' | 'failureCategory'>,
  counts: BenchmarkCounts,
): BenchmarkResult => ({ model, mode, scenario: scenario.id, ...outcome, ...counts })

export const toolsForMode = (mode: BenchmarkMode, store: BenchmarkStore): ToolSet => {
  const direct = makeFakeTools(store)
  return mode === 'direct' ? direct : { papai_tool: makeToolProxy(direct) }
}

const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required tool input: ${name}`)
  return value
}

const patchTask = (
  store: BenchmarkStore,
  id: string,
  patch: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const task = store.tasks.get(id)
  if (task === undefined) throw new Error(`Task not found: ${id}`)
  const updated = { ...task, ...patch }
  store.tasks.set(id, updated)
  return updated
}

const fakeTool = (store: BenchmarkStore, name: BenchmarkToolName): ToolSet[string] =>
  tool({
    description: `Benchmark ${name} tool.`,
    inputSchema: toolSchemas[name],
    execute: (input) => executeFakeTool(store, name, input),
  })

const executeFakeTool = (store: BenchmarkStore, name: string, input: Record<string, unknown>): unknown => {
  store.toolCalls.push(name)
  if (name === 'create_task') return createTask(store, input)
  if (name === 'search_tasks') return searchTasks(store, readString(input['query'], 'query'))
  if (name === 'update_task')
    return patchTask(store, readString(input['taskId'], 'taskId'), { status: 'in_progress', title: input['title'] })
  if (name === 'add_comment') return addComment(store, input)
  if (name === 'assign_user')
    return patchTask(store, readString(input['taskId'], 'taskId'), {
      assignee: readString(input['username'], 'username'),
    })
  if (name === 'get_current_time') return { iso: '2026-04-30T12:00:00.000Z', timezone: 'UTC' }
  if (name === 'web_lookup')
    return { topic: readString(input['topic'], 'topic'), summary: 'Reference summary', source: 'benchmark://web' }
  return deleteTask(store, input)
}

const createTask = (store: BenchmarkStore, input: Record<string, unknown>): TaskRecord => {
  const id = `task-${store.nextId}`
  store.nextId += 1
  const task = {
    id,
    title: readString(input['title'], 'title'),
    description: input['description'],
    status: 'open',
    comments: [],
    deleted: false,
  }
  store.tasks.set(id, task)
  return task
}

const searchTasks = (store: BenchmarkStore, query: string): readonly TaskRecord[] =>
  [...store.tasks.values()].filter((task) => String(task['title']).toLowerCase().includes(query.toLowerCase()))

const taskComments = (task: TaskRecord | undefined): readonly unknown[] => {
  const raw = task === undefined ? [] : task['comments']
  return Array.isArray(raw) ? raw : []
}

const addComment = (store: BenchmarkStore, input: Record<string, unknown>): TaskRecord => {
  const id = readString(input['taskId'], 'taskId')
  return patchTask(store, id, {
    comments: [...taskComments(store.tasks.get(id)), readString(input['comment'], 'comment')],
  })
}

const deleteTask = (
  store: BenchmarkStore,
  input: Record<string, unknown>,
): TaskRecord | Readonly<Record<string, string>> => {
  const taskId = readString(input['taskId'], 'taskId')
  const confidence = input['confidence']
  if (typeof confidence === 'number' && confidence >= 0.85) return patchTask(store, taskId, { deleted: true })
  const label = typeof input['label'] === 'string' && input['label'].length > 0 ? input['label'] : taskId
  return {
    status: 'confirmation_required',
    message: `Delete "${label}"? This action is irreversible - please confirm.`,
  }
}

const makeFakeTools = (store: BenchmarkStore): ToolSet =>
  Object.fromEntries(toolNames.map((name) => [name, fakeTool(store, name)]))
