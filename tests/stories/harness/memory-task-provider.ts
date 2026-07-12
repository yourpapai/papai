// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { systemError, type AppError } from '../../../src/errors.js'
import type {
  ListTasksParams,
  Comment,
  CommentReaction,
  IdentityUser,
  Label,
  Task,
  TaskCapability,
  TaskLabel,
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
type UpdateCommentInput = Parameters<NonNullable<TaskProvider['updateComment']>>[0]
type RemoveCommentInput = Parameters<NonNullable<TaskProvider['removeComment']>>[0]
type CreateLabelInput = Parameters<NonNullable<TaskProvider['createLabel']>>[0]
type UpdateLabelInput = Parameters<NonNullable<TaskProvider['updateLabel']>>[1]

const supportedMemoryTaskCapabilities: readonly TaskCapability[] = [
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  'comments.reactions',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
]

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

const definedLabelUpdate = (params: UpdateLabelInput): UpdateLabelInput => ({
  ...(params.name === undefined ? {} : { name: params.name }),
  ...(params.color === undefined ? {} : { color: params.color }),
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
  private readonly comments = new Map<string, Map<string, Comment>>()
  private readonly labels = new Map<string, Label>()
  private readonly taskLabelIds = new Map<string, Set<string>>()
  private readonly identityUsers = new Map<string, IdentityUser>()
  private readonly events: ScenarioEvents | undefined
  private readonly nextId: () => string
  private readonly capabilitySet = new Set<TaskCapability>()
  private commentSequence = 0
  private reactionSequence = 0
  private labelSequence = 0

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
    const unsupported = [...new Set(capabilities)].filter(
      (capability) => !supportedMemoryTaskCapabilities.includes(capability),
    )
    if (unsupported.length > 0) {
      throw new Error(`MemoryTaskProvider does not support task capabilities: ${unsupported.join(', ')}`)
    }
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

  getComment(taskId: string, commentId: string): Promise<Comment> {
    return Promise.resolve().then(() => {
      const comment = this.requireComment(taskId, commentId)
      this.events?.record('comment.get', { taskId, commentId })
      return clone(comment)
    })
  }

  getComments(taskId: string, params: Readonly<{ limit?: number; offset?: number }> = {}): Promise<Comment[]> {
    const pagination = clone(params)
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const comments = [...(this.comments.get(taskId)?.values() ?? [])]
      const offset = Math.max(0, pagination.offset ?? 0)
      const limit = Math.max(0, pagination.limit ?? comments.length)
      const result = comments.slice(offset, offset + limit)
      this.events?.record('comment.list', { taskId, count: result.length })
      return clone(result)
    })
  }

  addComment(taskId: string, body: string): Promise<Comment> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const comment: Comment = { id: `comment-${++this.commentSequence}`, body: clone(body) }
      const comments = this.comments.get(taskId) ?? new Map<string, Comment>()
      comments.set(comment.id, clone(comment))
      this.comments.set(taskId, comments)
      this.events?.record('comment.create', { taskId, commentId: comment.id })
      return clone(comment)
    })
  }

  updateComment(params: UpdateCommentInput): Promise<Comment> {
    return Promise.resolve().then(() => {
      const input = clone(params)
      const existing = this.requireComment(input.taskId, input.commentId)
      const updated: Comment = { ...existing, body: input.body }
      this.requireCommentMap(input.taskId).set(input.commentId, clone(updated))
      this.events?.record('comment.update', { taskId: input.taskId, commentId: input.commentId })
      return clone(updated)
    })
  }

  removeComment(params: RemoveCommentInput): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      const input = clone(params)
      const comment = this.requireComment(input.taskId, input.commentId)
      this.requireCommentMap(input.taskId).delete(input.commentId)
      this.events?.record('comment.delete', {
        taskId: input.taskId,
        commentId: input.commentId,
        reactionCount: comment.reactions?.length ?? 0,
      })
      return { id: input.commentId }
    })
  }

  addCommentReaction(taskId: string, commentId: string, reaction: string): Promise<CommentReaction> {
    return Promise.resolve().then(() => {
      const comment = this.requireComment(taskId, commentId)
      const added: CommentReaction = { id: `reaction-${++this.reactionSequence}`, reaction: clone(reaction) }
      const updated: Comment = { ...comment, reactions: [...(comment.reactions ?? []), added] }
      this.requireCommentMap(taskId).set(commentId, clone(updated))
      this.events?.record('comment.reaction.create', { taskId, commentId, reactionId: added.id })
      return clone(added)
    })
  }

  removeCommentReaction(
    taskId: string,
    commentId: string,
    reactionId: string,
  ): Promise<{ id: string; taskId: string; commentId: string }> {
    return Promise.resolve().then(() => {
      const comment = this.requireComment(taskId, commentId)
      const reactions = comment.reactions ?? []
      const index = reactions.findIndex((reaction) => reaction.id === reactionId)
      if (index < 0) {
        throw new Error(`Comment reaction not found: task ${taskId}, comment ${commentId}, reaction ${reactionId}`)
      }
      const updated: Comment = {
        ...comment,
        reactions: reactions.filter((_, reactionIndex) => reactionIndex !== index),
      }
      this.requireCommentMap(taskId).set(commentId, clone(updated))
      this.events?.record('comment.reaction.delete', { taskId, commentId, reactionId })
      return { id: reactionId, taskId, commentId }
    })
  }

  listLabels(): Promise<Label[]> {
    return Promise.resolve().then(() => {
      const result = [...this.labels.values()]
      this.events?.record('label.list', { count: result.length })
      return clone(result)
    })
  }

  listTaskLabels(taskId: string): Promise<TaskLabel[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const result = [...(this.taskLabelIds.get(taskId) ?? [])]
        .map((labelId) => this.labels.get(labelId))
        .filter((label): label is Label => label !== undefined)
      this.events?.record('task.label.list', { taskId, count: result.length })
      return clone(result)
    })
  }

  getLabelByName(labelName: string): Promise<Label[]> {
    return Promise.resolve().then(() => {
      const result = [...this.labels.values()].filter((label) => label.name === labelName)
      this.events?.record('label.find', { queryLength: labelName.length, count: result.length })
      return clone(result)
    })
  }

  createLabel(params: CreateLabelInput): Promise<Label> {
    return Promise.resolve().then(() => {
      const input = clone(params)
      if ([...this.labels.values()].some((label) => label.name === input.name)) {
        throw new Error(`Label already exists: ${input.name}`)
      }
      const label: Label = { ...input, id: `label-${++this.labelSequence}` }
      this.labels.set(label.id, clone(label))
      this.events?.record('label.create', { labelId: label.id })
      return clone(label)
    })
  }

  updateLabel(labelId: string, params: UpdateLabelInput): Promise<Label> {
    return Promise.resolve().then(() => {
      const existing = this.requireLabel(labelId)
      const patch = clone(definedLabelUpdate(params))
      const updated: Label = { ...existing, ...patch, id: labelId }
      this.labels.set(labelId, clone(updated))
      this.events?.record('label.update', { labelId, fields: Object.keys(patch).sort() })
      return clone(updated)
    })
  }

  removeLabel(labelId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireLabel(labelId)
      let taskAssignmentCount = 0
      for (const labelIds of this.taskLabelIds.values()) {
        if (labelIds.delete(labelId)) taskAssignmentCount += 1
      }
      this.labels.delete(labelId)
      this.events?.record('label.delete', { labelId, taskAssignmentCount })
      return { id: labelId }
    })
  }

  addTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.requireLabel(labelId)
      const labelIds = this.taskLabelIds.get(taskId) ?? new Set<string>()
      if (labelIds.has(labelId)) throw new Error(`Task label already exists: task ${taskId}, label ${labelId}`)
      labelIds.add(labelId)
      this.taskLabelIds.set(taskId, labelIds)
      this.events?.record('task.label.create', { taskId, labelId })
      return { taskId, labelId }
    })
  }

  removeTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const labelIds = this.taskLabelIds.get(taskId)
      if (labelIds === undefined || !labelIds.delete(labelId)) {
        throw new Error(`Task label not found: task ${taskId}, label ${labelId}`)
      }
      this.events?.record('task.label.delete', { taskId, labelId })
      return { taskId, labelId }
    })
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

  private requireCommentMap(taskId: string): Map<string, Comment> {
    this.requireTask(taskId)
    return this.comments.get(taskId) ?? new Map<string, Comment>()
  }

  private requireComment(taskId: string, commentId: string): Comment {
    const comment = this.requireCommentMap(taskId).get(commentId)
    if (comment === undefined) throw new Error(`Comment not found: task ${taskId}, comment ${commentId}`)
    return comment
  }

  private requireLabel(labelId: string): Label {
    const label = this.labels.get(labelId)
    if (label === undefined) throw new Error(`Label not found: ${labelId}`)
    return label
  }
}
