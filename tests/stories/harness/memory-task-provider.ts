// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { systemError, type AppError } from '../../../src/errors.js'
import type {
  ListTasksParams,
  IdentityUser,
  Task,
  TaskCapability,
  TaskListItem,
  TaskProvider,
  TaskProviderTrait,
  TaskSearchResult,
  ToolDueDateInput,
} from '../../../src/providers/types.js'
import type { ScenarioEvents } from './events.js'

type CreateTaskInput = Parameters<TaskProvider['createTask']>[0]
type UpdateTaskInput = Parameters<TaskProvider['updateTask']>[1]
type SearchTaskInput = Parameters<TaskProvider['searchTasks']>[0]

export type MemoryTaskProviderOptions = Readonly<{
  events?: ScenarioEvents
  nextId?: () => string
  capabilities?: readonly TaskCapability[]
}>

const clone = <T>(value: T): T => structuredClone(value)

const taskListItem = (task: Task): TaskListItem => ({
  id: task.id,
  title: task.title,
  url: task.url,
  ...(task.number === undefined ? {} : { number: task.number }),
  ...(task.status === undefined ? {} : { status: task.status }),
  ...(task.priority === undefined ? {} : { priority: task.priority }),
  ...(task.dueDate === undefined ? {} : { dueDate: task.dueDate }),
  ...(task.resolved === undefined ? {} : { resolved: task.resolved }),
})

const taskSearchResult = (task: Task): TaskSearchResult => ({
  id: task.id,
  title: task.title,
  url: task.url,
  ...(task.number === undefined ? {} : { number: task.number }),
  ...(task.status === undefined ? {} : { status: task.status }),
  ...(task.priority === undefined ? {} : { priority: task.priority }),
  ...(task.projectId === undefined ? {} : { projectId: task.projectId }),
})

const compareText = (left: string | null | undefined, right: string | null | undefined): number =>
  (left ?? '').localeCompare(right ?? '')

const compareTasks = (left: Task, right: Task, params: Readonly<ListTasksParams>): number => {
  const direction = params.sortOrder === 'desc' ? -1 : 1
  switch (params.sortBy) {
    case 'title':
      return direction * compareText(left.title, right.title)
    case 'priority':
      return direction * compareText(left.priority, right.priority)
    case 'dueDate':
      return direction * compareText(left.dueDate, right.dueDate)
    case 'number':
      return direction * ((left.number ?? 0) - (right.number ?? 0))
    case 'createdAt':
      return direction * compareText(left.createdAt, right.createdAt)
    case 'position':
    case undefined:
      return 0
  }
  return 0
}

const includesQuery = (task: Task, normalizedQuery: string): boolean =>
  normalizedQuery === '' ||
  task.title.toLowerCase().includes(normalizedQuery) ||
  (task.description ?? '').toLowerCase().includes(normalizedQuery)

const identityMatches = (identity: IdentityUser, query: string): boolean =>
  identity.id.toLowerCase().includes(query) ||
  identity.login.toLowerCase().includes(query) ||
  (identity.name ?? '').toLowerCase().includes(query)

const definedUpdate = (params: UpdateTaskInput): UpdateTaskInput => ({
  ...(params.title === undefined ? {} : { title: params.title }),
  ...(params.description === undefined ? {} : { description: params.description }),
  ...(params.status === undefined ? {} : { status: params.status }),
  ...(params.priority === undefined ? {} : { priority: params.priority }),
  ...(params.startDate === undefined ? {} : { startDate: params.startDate }),
  ...(params.dueDate === undefined ? {} : { dueDate: params.dueDate }),
  ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
  ...(params.assignee === undefined ? {} : { assignee: params.assignee }),
  ...(params.customFields === undefined ? {} : { customFields: params.customFields }),
})

export class MemoryTaskProvider implements TaskProvider {
  readonly name = 'kaneo'
  readonly supportsCustomFields = true
  readonly traits: ReadonlySet<TaskProviderTrait> = new Set<TaskProviderTrait>()
  readonly preferredUserIdentifier = 'id' as const
  readonly identityResolver = {
    searchUsers: (query: string, limit = 10): Promise<IdentityUser[]> => {
      const normalized = query.toLowerCase()
      const matches = [...this.identityUsers.values()].filter((identity) => identityMatches(identity, normalized))
      const result = matches.slice(0, limit).map(clone)
      this.events?.record('identity.search', {
        queryLength: query.length,
        limit,
        matchedUserIds: result.map(({ id }) => id),
      })
      return Promise.resolve(result)
    },
  }

  private readonly tasks = new Map<string, Task>()
  private readonly identityUsers = new Map<string, IdentityUser>()
  private readonly events: ScenarioEvents | undefined
  private readonly nextId: () => string
  private readonly capabilitySet = new Set<TaskCapability>()

  get capabilities(): ReadonlySet<TaskCapability> {
    return this.capabilitySet
  }

  constructor(options: MemoryTaskProviderOptions = {}) {
    this.events = options.events
    this.setCapabilities(options.capabilities ?? [])
    let sequence = 0
    this.nextId = options.nextId ?? ((): string => `task-${++sequence}`)
  }

  setCapabilities(capabilities: readonly TaskCapability[]): void {
    this.capabilitySet.clear()
    for (const capability of capabilities) this.capabilitySet.add(capability)
  }

  addIdentityUser(identity: IdentityUser): void {
    this.identityUsers.set(identity.id, clone(identity))
  }

  createTask(params: CreateTaskInput): Promise<Task> {
    const id = this.nextId()
    const task: Task = { ...clone(params), id, url: this.buildTaskUrl(id) }
    this.tasks.set(id, clone(task))
    this.events?.record('task.create', {
      taskId: id,
      projectId: params.projectId,
      fields: Object.keys(params).sort(),
    })
    return Promise.resolve(clone(task))
  }

  getTask(taskId: string): Promise<Task> {
    return Promise.resolve().then(() => {
      const task = this.requireTask(taskId)
      this.events?.record('task.get', { taskId })
      return clone(task)
    })
  }

  updateTask(taskId: string, params: UpdateTaskInput): Promise<Task> {
    return Promise.resolve().then(() => {
      const existing = this.requireTask(taskId)
      const patch = clone(definedUpdate(params))
      const updated: Task = { ...existing, ...patch, id: taskId, url: existing.url }
      this.tasks.set(taskId, clone(updated))
      this.events?.record('task.update', { taskId, fields: Object.keys(patch).sort() })
      return clone(updated)
    })
  }

  listTasks(projectId: string, params: ListTasksParams = {}): Promise<TaskListItem[]> {
    const matching = [...this.tasks.values()]
      .filter((task) => task.projectId === projectId)
      .filter((task) => params.status === undefined || task.status === params.status)
      .filter((task) => params.priority === undefined || task.priority === params.priority)
      .filter((task) => params.assigneeId === undefined || task.assignee === params.assigneeId)
      .filter(
        (task) =>
          params.dueBefore === undefined ||
          (task.dueDate !== undefined && task.dueDate !== null && task.dueDate < params.dueBefore),
      )
      .filter(
        (task) =>
          params.dueAfter === undefined ||
          (task.dueDate !== undefined && task.dueDate !== null && task.dueDate > params.dueAfter),
      )
      .sort((left, right) => compareTasks(left, right, params))
    const limit = params.limit ?? matching.length
    const offset = Math.max(0, ((params.page ?? 1) - 1) * limit)
    const result = matching.slice(offset, offset + limit).map(taskListItem)
    this.events?.record('task.list', {
      projectId,
      ...(params.assigneeId === undefined ? {} : { assigneeId: params.assigneeId }),
      count: result.length,
    })
    return Promise.resolve(clone(result))
  }

  searchTasks(params: SearchTaskInput): Promise<TaskSearchResult[]> {
    const query = params.query.toLowerCase()
    const matching = [...this.tasks.values()]
      .filter((task) => includesQuery(task, query))
      .filter((task) => params.projectId === undefined || task.projectId === params.projectId)
      .filter((task) => params.assigneeId === undefined || task.assignee === params.assigneeId)
    const offset = Math.max(0, params.offset ?? 0)
    const limit = params.limit ?? matching.length
    const result = matching.slice(offset, offset + limit).map(taskSearchResult)
    this.events?.record('task.search', { queryLength: params.query.length, count: result.length })
    return Promise.resolve(clone(result))
  }

  buildTaskUrl(taskId: string): string {
    return `memory://tasks/${taskId}`
  }

  buildProjectUrl(projectId: string): string {
    return `memory://projects/${projectId}`
  }

  classifyError(error: unknown): AppError {
    return systemError.unexpected(error instanceof Error ? error : new Error(String(error)))
  }

  getPromptAddendum(): string {
    return ''
  }

  normalizeDueDateInput(dueDate: ToolDueDateInput | undefined): string | undefined {
    return dueDate?.date
  }

  formatDueDateOutput(dueDate: string | null | undefined): string | null | undefined {
    return dueDate
  }

  normalizeListTaskParams(params: Readonly<ListTasksParams>): ListTasksParams {
    return clone(params)
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new Error(`Task not found: ${taskId}`)
    return task
  }
}
