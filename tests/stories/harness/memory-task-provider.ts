// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { systemError, type AppError } from '../../../src/errors.js'
import type {
  Activity,
  Agile,
  Attachment,
  Column,
  ListTasksParams,
  Comment,
  CommentReaction,
  CreateWorkItemParams,
  IdentityUser,
  Label,
  Project,
  ProvisionMemberInput,
  RelationType,
  SavedQuery,
  SetTaskVisibilityParams,
  Sprint,
  Task,
  TaskCapability,
  TaskCommandResult,
  TaskLabel,
  TaskListItem,
  TaskProvider,
  TaskProviderTrait,
  TaskSearchResult,
  TaskVisibility,
  ToolDueDateInput,
  UpdateWorkItemParams,
  UserRef,
  WorkItem,
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
  'tasks.delete',
  'tasks.count',
  'activities.read',
  'tasks.relations',
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  'projects.team',
  'workItems.list',
  'workItems.create',
  'workItems.update',
  'workItems.delete',
  'agiles.list',
  'sprints.list',
  'sprints.create',
  'sprints.update',
  'sprints.assign',
  'queries.saved',
  'tasks.watchers',
  'tasks.votes',
  'tasks.visibility',
  'members.provision',
  'attachments.list',
  'attachments.upload',
  'attachments.delete',
  'tasks.commands',
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

const contentSize = (content: Uint8Array | Blob): number => ('size' in content ? content.size : content.length)

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

const definedStatusUpdate = (
  params: Readonly<{ name?: string; icon?: string; color?: string; isFinal?: boolean }>,
): Readonly<{ name?: string; icon?: string; color?: string; isFinal?: boolean }> => ({
  ...(params.name === undefined ? {} : { name: params.name }),
  ...(params.icon === undefined ? {} : { icon: params.icon }),
  ...(params.color === undefined ? {} : { color: params.color }),
  ...(params.isFinal === undefined ? {} : { isFinal: params.isFinal }),
})

export class MemoryTaskProvider implements TaskProvider {
  readonly name = 'kaneo'
  readonly supportsCustomFields = true
  private readonly traitSet = new Set<TaskProviderTrait>()
  readonly traits: ReadonlySet<TaskProviderTrait> = this.traitSet
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
  private readonly history = new Map<string, Activity[]>()
  private readonly identityUsers = new Map<string, IdentityUser>()
  private readonly events: ScenarioEvents | undefined
  private readonly nextId: () => string
  private readonly capabilitySet = new Set<TaskCapability>()
  private commentSequence = 0
  private reactionSequence = 0
  private labelSequence = 0
  private activitySequence = 0
  private readonly projects = new Map<string, Project>()
  private readonly statuses = new Map<string, Column[]>()
  private readonly projectTeam = new Map<string, UserRef[]>()
  private projectSequence = 0
  private statusSequence = 0
  private readonly relations = new Map<string, Map<string, RelationType>>()
  private readonly workItems = new Map<string, WorkItem[]>()
  private readonly agiles = new Map<string, Agile>()
  private readonly sprints = new Map<string, Sprint[]>()
  private readonly taskSprints = new Map<string, string>()
  private readonly savedQueries = new Map<string, SavedQuery>()
  private workSequence = 0
  private agileSequence = 0
  private sprintSequence = 0
  private querySequence = 0
  private readonly watchers = new Map<string, UserRef[]>()
  private readonly votedTasks = new Set<string>()
  private readonly taskVisibility = new Map<string, TaskVisibility>()
  private currentUser: UserRef | undefined
  readonly provisionCalls: Array<{
    member: ProvisionMemberInput
    opts?: { existingProviderUserId?: string; existingLogin?: string; existingPassword?: string }
  }> = []
  private readonly attachments = new Map<string, Attachment[]>()
  private attachmentSequence = 0
  readonly commandCalls: Array<{ query: string; taskIds: string[]; comment?: string; silent?: boolean }> = []

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

  setTraits(traits: readonly TaskProviderTrait[]): void {
    for (const trait of traits) this.traitSet.add(trait)
  }

  addIdentityUser(identity: IdentityUser): void {
    this.identityUsers.set(identity.id, clone(identity))
  }

  createTask(params: CreateTaskInput): Promise<Task> {
    const id = this.nextId()
    const task: Task = { ...clone(params), id, url: this.buildTaskUrl(id) }
    this.tasks.set(id, clone(task))
    this.recordActivity(id, { category: 'task.created' })
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
      for (const [field, value] of Object.entries(patch)) {
        this.recordActivity(taskId, {
          category: 'task.updated',
          field,
          added: typeof value === 'string' ? value : JSON.stringify(value),
        })
      }
      this.events?.record('task.update', { taskId, fields: Object.keys(patch).sort() })
      return clone(updated)
    })
  }

  deleteTask(taskId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.recordActivity(taskId, { category: 'task.deleted' })
      this.tasks.delete(taskId)
      this.comments.delete(taskId)
      this.taskLabelIds.delete(taskId)
      this.history.delete(taskId)
      this.events?.record('task.delete', { taskId })
      return { id: taskId }
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

  countTasks(params: Readonly<{ query: string; projectId?: string }>): Promise<number> {
    return Promise.resolve().then(async () => (await this.searchTasks({ ...params })).length)
  }

  getTaskHistory(
    taskId: string,
    params: Readonly<{
      categories?: string[]
      limit?: number
      offset?: number
      reverse?: boolean
      start?: string
      end?: string
      author?: string
    }> = {},
  ): Promise<Activity[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      if (params.start !== undefined || params.end !== undefined) {
        throw new Error('MemoryTaskProvider does not support start/end history filtering')
      }
      const entries = [...(this.history.get(taskId) ?? [])]
      const filtered = entries
        .filter((entry) => params.categories === undefined || params.categories.includes(entry.category))
        .filter((entry) => params.author === undefined || entry.author === params.author)
      const ordered = params.reverse === true ? filtered.reverse() : filtered
      const offset = Math.max(0, params.offset ?? 0)
      const limit = params.limit ?? ordered.length
      const result = ordered.slice(offset, offset + limit)
      this.events?.record('task.history', { taskId, count: result.length })
      return clone(result)
    })
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
      this.recordActivity(taskId, { category: 'comment.created' })
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
      this.recordActivity(input.taskId, { category: 'comment.updated', field: 'comment' })
      this.events?.record('comment.update', { taskId: input.taskId, commentId: input.commentId })
      return clone(updated)
    })
  }

  removeComment(params: RemoveCommentInput): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      const input = clone(params)
      const comment = this.requireComment(input.taskId, input.commentId)
      this.requireCommentMap(input.taskId).delete(input.commentId)
      this.recordActivity(input.taskId, { category: 'comment.deleted' })
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
    const input = clone(params)
    return Promise.resolve().then(() => {
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
    const input = clone(params)
    return Promise.resolve().then(() => {
      const existing = this.requireLabel(labelId)
      const patch = definedLabelUpdate(input)
      if (
        patch.name !== undefined &&
        patch.name !== existing.name &&
        [...this.labels.values()].some((label) => label.name === patch.name)
      ) {
        throw new Error(`Label already exists: ${patch.name}`)
      }
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
      this.recordActivity(taskId, { category: 'task.label.added', field: 'label', added: labelId })
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
      this.recordActivity(taskId, { category: 'task.label.removed', field: 'label', removed: labelId })
      this.events?.record('task.label.delete', { taskId, labelId })
      return { taskId, labelId }
    })
  }

  listProjects(): Promise<Project[]> {
    return Promise.resolve().then(() => {
      const result = [...this.projects.values()]
      this.events?.record('project.list', { count: result.length })
      return clone(result)
    })
  }

  getProject(projectId: string): Promise<Project> {
    return Promise.resolve().then(() => {
      const project = this.requireProject(projectId)
      this.events?.record('project.get', { projectId })
      return clone(project)
    })
  }

  createProject(params: Readonly<{ name: string; description?: string }>): Promise<Project> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      if ([...this.projects.values()].some((project) => project.name === input.name)) {
        throw new Error(`Project already exists: ${input.name}`)
      }
      const id = `project-${++this.projectSequence}`
      const project: Project = {
        id,
        name: input.name,
        url: this.buildProjectUrl(id),
        ...(input.description === undefined ? {} : { description: input.description }),
      }
      this.projects.set(id, clone(project))
      this.events?.record('project.create', { projectId: id })
      return clone(project)
    })
  }

  updateProject(projectId: string, params: Readonly<{ name?: string; description?: string }>): Promise<Project> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      const existing = this.requireProject(projectId)
      if (
        input.name !== undefined &&
        input.name !== existing.name &&
        [...this.projects.values()].some((project) => project.name === input.name)
      ) {
        throw new Error(`Project already exists: ${input.name}`)
      }
      const updated: Project = {
        ...existing,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      }
      this.projects.set(projectId, clone(updated))
      this.events?.record('project.update', { projectId, fields: Object.keys(input).sort() })
      return clone(updated)
    })
  }

  deleteProject(projectId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      this.projects.delete(projectId)
      this.statuses.delete(projectId)
      this.projectTeam.delete(projectId)
      this.events?.record('project.delete', { projectId })
      return { id: projectId }
    })
  }

  listStatuses(projectId: string): Promise<Column[]> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      const result = [...(this.statuses.get(projectId) ?? [])].sort(
        (left, right) => (left.order ?? 0) - (right.order ?? 0),
      )
      this.events?.record('status.list', { projectId, count: result.length })
      return clone(result)
    })
  }

  createStatus(
    projectId: string,
    params: Readonly<{ name: string; icon?: string; color?: string; isFinal?: boolean }>,
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      if (confirm !== true) {
        return {
          status: 'confirmation_required' as const,
          message: `Creating status "${input.name}" changes the shared status set — confirm to proceed.`,
        }
      }
      const columns = this.statuses.get(projectId) ?? []
      const column: Column = {
        id: `status-${++this.statusSequence}`,
        name: input.name,
        order: columns.length,
        ...(input.isFinal === undefined ? {} : { isFinal: input.isFinal }),
      }
      this.statuses.set(projectId, [...columns, clone(column)])
      this.events?.record('status.create', { projectId, statusId: column.id })
      return clone(column)
    })
  }

  updateStatus(
    projectId: string,
    statusId: string,
    params: Readonly<{ name?: string; icon?: string; color?: string; isFinal?: boolean }>,
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      const existing = this.requireColumn(projectId, statusId)
      if (confirm !== true) {
        return {
          status: 'confirmation_required' as const,
          message: `Updating status "${existing.name}" changes the shared status set — confirm to proceed.`,
        }
      }
      const updated: Column = { ...existing, ...definedStatusUpdate(input), id: statusId }
      this.statuses.set(
        projectId,
        (this.statuses.get(projectId) ?? []).map((entry) => (entry.id === statusId ? clone(updated) : entry)),
      )
      this.events?.record('status.update', { projectId, statusId })
      return clone(updated)
    })
  }

  deleteStatus(
    projectId: string,
    statusId: string,
    confirm?: boolean,
  ): Promise<{ id: string } | { status: 'confirmation_required'; message: string }> {
    return Promise.resolve().then(() => {
      const existing = this.requireColumn(projectId, statusId)
      if (confirm !== true) {
        return {
          status: 'confirmation_required' as const,
          message: `Deleting status "${existing.name}" changes the shared status set — confirm to proceed.`,
        }
      }
      this.statuses.set(
        projectId,
        (this.statuses.get(projectId) ?? []).filter((entry) => entry.id !== statusId),
      )
      this.events?.record('status.delete', { projectId, statusId })
      return { id: statusId }
    })
  }

  reorderStatuses(
    projectId: string,
    statuses: ReadonlyArray<Readonly<{ id: string; position: number }>>,
    confirm?: boolean,
  ): Promise<undefined | { status: 'confirmation_required'; message: string }> {
    const input = clone(statuses)
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      if (confirm !== true) {
        return {
          status: 'confirmation_required' as const,
          message: 'Reordering statuses changes the shared status set — confirm to proceed.',
        }
      }
      const positions = new Map(input.map((entry) => [entry.id, entry.position]))
      const reordered = (this.statuses.get(projectId) ?? []).map((entry) => {
        const position = positions.get(entry.id)
        return position === undefined ? entry : { ...entry, order: position }
      })
      this.statuses.set(projectId, reordered)
      this.events?.record('status.reorder', { projectId, count: input.length })
      return undefined
    })
  }

  listProjectTeam(projectId: string): Promise<UserRef[]> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      const result = this.projectTeam.get(projectId) ?? []
      this.events?.record('project.team.list', { projectId, count: result.length })
      return clone(result)
    })
  }

  addProjectMember(projectId: string, userId: string): Promise<{ projectId: string; userId: string }> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      const members = this.projectTeam.get(projectId) ?? []
      if (members.some((member) => member.id === userId)) throw new Error(`Project member already exists: ${userId}`)
      this.projectTeam.set(projectId, [...members, { id: userId }])
      this.events?.record('project.team.add', { projectId, userId })
      return { projectId, userId }
    })
  }

  removeProjectMember(projectId: string, userId: string): Promise<{ projectId: string; userId: string }> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      const members = this.projectTeam.get(projectId) ?? []
      if (!members.some((member) => member.id === userId)) throw new Error(`Project member not found: ${userId}`)
      this.projectTeam.set(
        projectId,
        members.filter((member) => member.id !== userId),
      )
      this.events?.record('project.team.remove', { projectId, userId })
      return { projectId, userId }
    })
  }

  addRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.requireTask(relatedTaskId)
      const relations = this.relations.get(taskId) ?? new Map<string, RelationType>()
      if (relations.has(relatedTaskId)) throw new Error(`Task relation already exists: ${taskId} ${relatedTaskId}`)
      relations.set(relatedTaskId, type)
      this.relations.set(taskId, relations)
      this.events?.record('task.relation.create', { taskId, relatedTaskId, type })
      return { taskId, relatedTaskId, type }
    })
  }

  updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.requireTask(relatedTaskId)
      const relations = this.relations.get(taskId)
      if (relations === undefined || !relations.has(relatedTaskId))
        throw new Error(`Task relation not found: ${taskId} ${relatedTaskId}`)
      relations.set(relatedTaskId, type)
      this.events?.record('task.relation.update', { taskId, relatedTaskId, type })
      return { taskId, relatedTaskId, type }
    })
  }

  removeRelation(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }> {
    return Promise.resolve().then(() => {
      const relations = this.relations.get(taskId)
      if (relations === undefined || !relations.delete(relatedTaskId))
        throw new Error(`Task relation not found: ${taskId} ${relatedTaskId}`)
      this.events?.record('task.relation.delete', { taskId, relatedTaskId })
      return { taskId, relatedTaskId }
    })
  }

  listWorkItems(taskId: string, params: Readonly<{ limit?: number; offset?: number }> = {}): Promise<WorkItem[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const items = this.workItems.get(taskId) ?? []
      const offset = Math.max(0, params.offset ?? 0)
      const limit = params.limit ?? items.length
      const result = items.slice(offset, offset + limit)
      this.events?.record('work.list', { taskId, count: result.length })
      return clone(result)
    })
  }

  createWorkItem(taskId: string, params: CreateWorkItemParams): Promise<WorkItem> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const item: WorkItem = {
        id: `work-${++this.workSequence}`,
        taskId,
        author: input.author ?? 'unknown',
        date: input.date ?? '2026-01-01',
        duration: input.duration,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.type === undefined ? {} : { type: input.type }),
      }
      this.workItems.set(taskId, [...(this.workItems.get(taskId) ?? []), clone(item)])
      this.events?.record('work.create', { taskId, workItemId: item.id })
      return clone(item)
    })
  }

  updateWorkItem(taskId: string, workItemId: string, params: UpdateWorkItemParams): Promise<WorkItem> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const items = this.workItems.get(taskId) ?? []
      const existing = items.find((item) => item.id === workItemId)
      if (existing === undefined) throw new Error(`Work item not found: ${workItemId}`)
      const updated: WorkItem = {
        ...existing,
        ...(input.duration === undefined ? {} : { duration: input.duration }),
        ...(input.date === undefined ? {} : { date: input.date }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.type === undefined ? {} : { type: input.type }),
      }
      this.workItems.set(
        taskId,
        items.map((item) => (item.id === workItemId ? clone(updated) : item)),
      )
      this.events?.record('work.update', { taskId, workItemId })
      return clone(updated)
    })
  }

  deleteWorkItem(taskId: string, workItemId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const items = this.workItems.get(taskId) ?? []
      if (!items.some((item) => item.id === workItemId)) throw new Error(`Work item not found: ${workItemId}`)
      this.workItems.set(
        taskId,
        items.filter((item) => item.id !== workItemId),
      )
      this.events?.record('work.delete', { taskId, workItemId })
      return { id: workItemId }
    })
  }

  addAgile(input: Readonly<{ name: string }>): Agile {
    const agile: Agile = { id: `agile-${++this.agileSequence}`, name: input.name }
    this.agiles.set(agile.id, clone(agile))
    return clone(agile)
  }

  listAgiles(): Promise<Agile[]> {
    return Promise.resolve().then(() => {
      const result = [...this.agiles.values()]
      this.events?.record('agile.list', { count: result.length })
      return clone(result)
    })
  }

  listSprints(agileId: string): Promise<Sprint[]> {
    return Promise.resolve().then(() => {
      this.requireAgile(agileId)
      const result = this.sprints.get(agileId) ?? []
      this.events?.record('sprint.list', { agileId, count: result.length })
      return clone(result)
    })
  }

  createSprint(
    agileId: string,
    params: Readonly<{
      name: string
      goal?: string
      start?: string
      finish?: string
      previousSprintId?: string
      isDefault?: boolean
    }>,
  ): Promise<Sprint> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireAgile(agileId)
      const sprint: Sprint = {
        id: `sprint-${++this.sprintSequence}`,
        agileId,
        name: input.name,
        archived: false,
        ...(input.goal === undefined ? {} : { goal: input.goal }),
        ...(input.start === undefined ? {} : { start: input.start }),
        ...(input.finish === undefined ? {} : { finish: input.finish }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
      }
      this.sprints.set(agileId, [...(this.sprints.get(agileId) ?? []), clone(sprint)])
      this.events?.record('sprint.create', { agileId, sprintId: sprint.id })
      return clone(sprint)
    })
  }

  updateSprint(
    agileId: string,
    sprintId: string,
    params: Readonly<{
      name?: string
      goal?: string | null
      start?: string | null
      finish?: string | null
      archived?: boolean
    }>,
  ): Promise<Sprint> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      const sprint = this.requireSprint(agileId, sprintId)
      const updated: Sprint = {
        ...sprint,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.goal === undefined ? {} : { goal: input.goal }),
        ...(input.start === undefined ? {} : { start: input.start ?? undefined }),
        ...(input.finish === undefined ? {} : { finish: input.finish ?? undefined }),
        ...(input.archived === undefined ? {} : { archived: input.archived }),
      }
      this.sprints.set(
        agileId,
        (this.sprints.get(agileId) ?? []).map((entry) => (entry.id === sprintId ? clone(updated) : entry)),
      )
      this.events?.record('sprint.update', { agileId, sprintId })
      return clone(updated)
    })
  }

  assignTaskToSprint(taskId: string, sprintId: string): Promise<{ taskId: string; sprintId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const agileId = [...this.sprints.entries()].find(([, sprints]) =>
        sprints.some((sprint) => sprint.id === sprintId),
      )?.[0]
      if (agileId === undefined) throw new Error(`Sprint not found: ${sprintId}`)
      this.taskSprints.set(taskId, sprintId)
      this.events?.record('sprint.assign', { taskId, sprintId })
      return { taskId, sprintId }
    })
  }

  taskSprintId(taskId: string): string | undefined {
    return this.taskSprints.get(taskId)
  }

  addSavedQuery(input: Readonly<{ name: string; query?: string }>): SavedQuery {
    const savedQuery: SavedQuery = {
      id: `query-${++this.querySequence}`,
      name: input.name,
      ...(input.query === undefined ? {} : { query: input.query }),
    }
    this.savedQueries.set(savedQuery.id, clone(savedQuery))
    return clone(savedQuery)
  }

  listSavedQueries(): Promise<SavedQuery[]> {
    return Promise.resolve().then(() => {
      const result = [...this.savedQueries.values()]
      this.events?.record('query.list', { count: result.length })
      return clone(result)
    })
  }

  runSavedQuery(queryId: string): Promise<TaskSearchResult[]> {
    return Promise.resolve().then(() => {
      const savedQuery = this.savedQueries.get(queryId)
      if (savedQuery === undefined) throw new Error(`Saved query not found: ${queryId}`)
      this.events?.record('query.run', { queryId })
      if (savedQuery.query === undefined || savedQuery.query === null || savedQuery.query === '') {
        return Promise.resolve(clone([...this.tasks.values()].map(taskSearchResult)))
      }
      return this.searchTasks({ query: savedQuery.query })
    })
  }

  listWatchers(taskId: string): Promise<UserRef[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const result = this.watchers.get(taskId) ?? []
      this.events?.record('task.watchers.list', { taskId, count: result.length })
      return clone(result)
    })
  }

  addWatcher(taskId: string, userId: string): Promise<{ taskId: string; userId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const watchers = this.watchers.get(taskId) ?? []
      if (watchers.some((watcher) => watcher.id === userId)) throw new Error(`Task watcher already exists: ${userId}`)
      this.watchers.set(taskId, [...watchers, { id: userId }])
      this.events?.record('task.watchers.add', { taskId, userId })
      return { taskId, userId }
    })
  }

  removeWatcher(taskId: string, userId: string): Promise<{ taskId: string; userId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const watchers = this.watchers.get(taskId) ?? []
      if (!watchers.some((watcher) => watcher.id === userId)) throw new Error(`Task watcher not found: ${userId}`)
      this.watchers.set(
        taskId,
        watchers.filter((watcher) => watcher.id !== userId),
      )
      this.events?.record('task.watchers.remove', { taskId, userId })
      return { taskId, userId }
    })
  }

  addVote(taskId: string): Promise<{ taskId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.votedTasks.add(taskId)
      this.events?.record('task.vote.add', { taskId })
      return { taskId }
    })
  }

  removeVote(taskId: string): Promise<{ taskId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      if (!this.votedTasks.delete(taskId)) throw new Error(`Task vote not found: ${taskId}`)
      this.events?.record('task.vote.remove', { taskId })
      return { taskId }
    })
  }

  setVisibility(
    taskId: string,
    params: SetTaskVisibilityParams,
  ): Promise<{ taskId: string; visibility: TaskVisibility }> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const visibility: TaskVisibility =
        input.kind === 'public'
          ? { kind: 'public' }
          : {
              kind: 'restricted',
              ...(input.userIds === undefined ? {} : { users: input.userIds.map((id) => ({ id })) }),
              ...(input.groupIds === undefined ? {} : { groups: input.groupIds.map((name) => ({ name })) }),
            }
      this.taskVisibility.set(taskId, clone(visibility))
      this.events?.record('task.visibility.set', { taskId, kind: visibility.kind })
      return { taskId, visibility }
    })
  }

  getTaskVisibility(taskId: string): TaskVisibility {
    this.requireTask(taskId)
    return clone(this.taskVisibility.get(taskId) ?? { kind: 'public' })
  }

  listUsers(query?: string, limit = 10): Promise<UserRef[]> {
    const normalized = (query ?? '').toLowerCase()
    const matches = [...this.identityUsers.values()]
      .filter((identity) => identityMatches(identity, normalized))
      .slice(0, limit)
      .map((identity) => ({ id: identity.id, login: identity.login, name: identity.name }))
    return Promise.resolve(clone(matches))
  }

  getCurrentUser(): Promise<UserRef> {
    return Promise.resolve().then(() => {
      if (this.currentUser === undefined) throw new Error('MemoryTaskProvider has no current user')
      return clone(this.currentUser)
    })
  }

  setCurrentUser(user: UserRef): void {
    this.currentUser = clone(user)
  }

  provisionWorkspaceMember(
    member: ProvisionMemberInput,
    opts?: Readonly<{ existingProviderUserId?: string; existingLogin?: string; existingPassword?: string }>,
  ): Promise<{ providerUserId: string; login: string; password: string }> {
    this.provisionCalls.push({ member: clone(member), ...(opts === undefined ? {} : { opts: clone(opts) }) })
    this.events?.record('member.provision', { login: member.username ?? member.chatUserId })
    const login = member.username ?? member.chatUserId
    return Promise.resolve({ providerUserId: `prov-${login}`, login, password: 'memory-password' })
  }

  listAttachments(taskId: string): Promise<Attachment[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const result = this.attachments.get(taskId) ?? []
      this.events?.record('attachment.list', { taskId, count: result.length })
      return clone(result)
    })
  }

  uploadAttachment(
    taskId: string,
    file: Readonly<{ name: string; content: Uint8Array | Blob; mimeType?: string }>,
  ): Promise<Attachment> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const id = `attachment-${++this.attachmentSequence}`
      const attachment: Attachment = {
        id,
        name: file.name,
        url: `memory://attachments/${id}`,
        size: contentSize(file.content),
        ...(file.mimeType === undefined ? {} : { mimeType: file.mimeType }),
      }
      this.attachments.set(taskId, [...(this.attachments.get(taskId) ?? []), clone(attachment)])
      this.events?.record('attachment.upload', { taskId, attachmentId: id })
      return clone(attachment)
    })
  }

  deleteAttachment(taskId: string, attachmentId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const attachments = this.attachments.get(taskId) ?? []
      if (!attachments.some((attachment) => attachment.id === attachmentId)) {
        throw new Error(`Attachment not found: ${attachmentId}`)
      }
      this.attachments.set(
        taskId,
        attachments.filter((attachment) => attachment.id !== attachmentId),
      )
      this.events?.record('attachment.delete', { taskId, attachmentId })
      return { id: attachmentId }
    })
  }

  applyCommand(
    params: Readonly<{ query: string; taskIds: string[]; comment?: string; silent?: boolean }>,
  ): Promise<TaskCommandResult> {
    const input = clone(params)
    this.commandCalls.push(clone(input))
    this.events?.record('command.apply', { taskIds: input.taskIds })
    return Promise.resolve(clone(input))
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

  private recordActivity(taskId: string, entry: Readonly<Omit<Activity, 'id' | 'timestamp'>>): void {
    this.activitySequence += 1
    const activity: Activity = {
      id: `activity-${this.activitySequence}`,
      timestamp: String(this.activitySequence),
      ...entry,
    }
    const entries = this.history.get(taskId) ?? []
    entries.push(clone(activity))
    this.history.set(taskId, entries)
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

  private requireProject(projectId: string): Project {
    const project = this.projects.get(projectId)
    if (project === undefined) throw new Error(`Project not found: ${projectId}`)
    return project
  }

  private requireColumn(projectId: string, statusId: string): Column {
    const column = (this.statuses.get(projectId) ?? []).find((entry) => entry.id === statusId)
    if (column === undefined) throw new Error(`Status not found: project ${projectId}, status ${statusId}`)
    return column
  }

  private requireAgile(agileId: string): Agile {
    const agile = this.agiles.get(agileId)
    if (agile === undefined) throw new Error(`Agile not found: ${agileId}`)
    return agile
  }

  private requireSprint(agileId: string, sprintId: string): Sprint {
    const sprint = (this.sprints.get(agileId) ?? []).find((entry) => entry.id === sprintId)
    if (sprint === undefined) throw new Error(`Sprint not found: agile ${agileId}, sprint ${sprintId}`)
    return sprint
  }
}
