// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AppError } from '../../errors.js'
import { logger } from '../../logger.js'
import { localDatetimeToUtc, utcToLocal } from '../../utils/datetime.js'
import type {
  Column,
  Comment,
  Label,
  ListTasksParams,
  Project,
  RelationType,
  Task,
  TaskLabel,
  TaskListItem,
  TaskProvider,
  TaskSearchResult,
} from '../types.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { ALL_CAPABILITIES, CONFIG_REQUIREMENTS, KANEO_TRAITS } from './constants.js'
import { createKaneoIdentityResolver } from './identity-resolver.js'
import { kaneoAddComment, kaneoGetComments, kaneoRemoveComment, kaneoUpdateComment } from './operations/comments.js'
import {
  kaneoAddTaskLabel,
  kaneoCreateLabel,
  kaneoListLabels,
  kaneoListTaskLabels,
  kaneoRemoveLabel,
  kaneoRemoveTaskLabel,
  kaneoUpdateLabel,
} from './operations/labels.js'
import { kaneoCreateProject, kaneoDeleteProject, kaneoListProjects, kaneoUpdateProject } from './operations/projects.js'
import { kaneoAddRelation, kaneoRemoveRelation, kaneoUpdateRelation } from './operations/relations.js'
import {
  kaneoDeleteStatus,
  kaneoCreateStatus,
  kaneoListStatuses,
  kaneoReorderStatuses,
  kaneoUpdateStatus,
} from './operations/statuses.js'
import {
  kaneoCreateTask,
  kaneoDeleteTask,
  kaneoGetTask,
  kaneoListTasks,
  kaneoSearchTasks,
  kaneoUpdateTask,
} from './operations/tasks.js'
import { buildProjectUrl, buildTaskUrl } from './url-builder.js'

const log = logger.child({ scope: 'provider:kaneo' })

/** KaneoProvider wraps kaneo operation functions to implement TaskProvider. */
export class KaneoProvider implements TaskProvider {
  readonly name = 'kaneo'
  readonly capabilities = ALL_CAPABILITIES
  readonly traits = KANEO_TRAITS
  readonly configRequirements = CONFIG_REQUIREMENTS
  readonly preferredUserIdentifier = 'id' as const
  readonly identityResolver

  constructor(
    private readonly config: KaneoConfig,
    private readonly workspaceId: string,
  ) {
    log.debug({ workspaceId }, 'KaneoProvider created')
    this.identityResolver = createKaneoIdentityResolver(this.config, this.workspaceId)
  }

  createTask(params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    startDate?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }): Promise<Task> {
    return kaneoCreateTask(this.config, this.workspaceId, params)
  }

  getTask(taskId: string): Promise<Task> {
    return kaneoGetTask(this.config, this.workspaceId, taskId)
  }

  updateTask(
    taskId: string,
    params: {
      title?: string
      description?: string
      status?: string
      priority?: string
      startDate?: string
      dueDate?: string
      projectId?: string
      assignee?: string
    },
  ): Promise<Task> {
    return kaneoUpdateTask(this.config, this.workspaceId, taskId, params)
  }

  listTasks(projectId: string, params?: ListTasksParams): Promise<TaskListItem[]> {
    return kaneoListTasks(this.config, this.workspaceId, projectId, params)
  }

  searchTasks(params: {
    query: string
    projectId?: string
    assigneeId?: string
    limit?: number
    offset?: number
  }): Promise<TaskSearchResult[]> {
    return kaneoSearchTasks(this.config, this.workspaceId, params)
  }

  deleteTask(taskId: string): Promise<{ id: string }> {
    return kaneoDeleteTask(this.config, taskId)
  }

  listProjects(): Promise<Project[]> {
    return kaneoListProjects(this.config, this.workspaceId)
  }

  createProject(params: { name: string; description?: string }): Promise<Project> {
    return kaneoCreateProject(this.config, this.workspaceId, params)
  }

  updateProject(projectId: string, params: { name?: string; description?: string }): Promise<Project> {
    return kaneoUpdateProject(this.config, this.workspaceId, projectId, params)
  }

  deleteProject(projectId: string): Promise<{ id: string }> {
    return kaneoDeleteProject(this.config, projectId)
  }

  addComment(taskId: string, body: string): Promise<Comment> {
    return kaneoAddComment(this.config, taskId, body)
  }

  getComments(taskId: string): Promise<Comment[]> {
    return kaneoGetComments(this.config, taskId)
  }

  updateComment(params: { taskId: string; commentId: string; body: string }): Promise<Comment> {
    return kaneoUpdateComment(this.config, params)
  }

  removeComment(params: { taskId: string; commentId: string }): Promise<{ id: string }> {
    return kaneoRemoveComment(this.config, params)
  }

  listLabels(): Promise<Label[]> {
    return kaneoListLabels(this.config, this.workspaceId)
  }

  listTaskLabels(taskId: string): Promise<TaskLabel[]> {
    return kaneoListTaskLabels(this.config, taskId)
  }

  createLabel(params: { name: string; color?: string }): Promise<Label> {
    return kaneoCreateLabel(this.config, this.workspaceId, params)
  }

  updateLabel(labelId: string, params: { name?: string; color?: string }): Promise<Label> {
    return kaneoUpdateLabel(this.config, labelId, params)
  }

  removeLabel(labelId: string): Promise<{ id: string }> {
    return kaneoRemoveLabel(this.config, labelId)
  }

  addTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return kaneoAddTaskLabel(this.config, this.workspaceId, taskId, labelId)
  }

  removeTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return kaneoRemoveTaskLabel(this.config, taskId, labelId)
  }

  addRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return kaneoAddRelation(this.config, taskId, relatedTaskId, type)
  }

  updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return kaneoUpdateRelation(this.config, taskId, relatedTaskId, type)
  }

  removeRelation(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }> {
    return kaneoRemoveRelation(this.config, taskId, relatedTaskId)
  }

  listStatuses(projectId: string): Promise<Column[]> {
    return kaneoListStatuses(this.config, projectId)
  }

  createStatus(
    projectId: string,
    params: { name: string; icon?: string; color?: string; isFinal?: boolean },
    _confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }> {
    return kaneoCreateStatus(this.config, projectId, params)
  }

  updateStatus(
    _projectId: string,
    statusId: string,
    params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
    _confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }> {
    return kaneoUpdateStatus(this.config, statusId, params)
  }

  deleteStatus(
    _projectId: string,
    statusId: string,
    _confirm?: boolean,
  ): Promise<{ id: string } | { status: 'confirmation_required'; message: string }> {
    return kaneoDeleteStatus(this.config, statusId)
  }

  reorderStatuses(
    projectId: string,
    statuses: { id: string; position: number }[],
    _confirm?: boolean,
  ): Promise<undefined | { status: 'confirmation_required'; message: string }> {
    return kaneoReorderStatuses(this.config, projectId, statuses)
  }

  buildTaskUrl(taskId: string, projectId?: string): string {
    return buildTaskUrl(this.config.baseUrl, this.workspaceId, projectId ?? '', taskId)
  }

  buildProjectUrl(projectId: string): string {
    return buildProjectUrl(this.config.baseUrl, this.workspaceId, projectId)
  }

  classifyError(error: unknown): AppError {
    return classifyKaneoError(error).appError
  }

  getPromptAddendum(): string {
    return `IMPORTANT — Task status vs kanban columns:
- Columns define the board layout ("Todo", "In Progress", "Done"); task status is the column the task currently sits in.
- To move a task, update its status to the target column name. To change the board structure, use the column management tools.
- Always call list_columns before updating a task status to make sure the column exists.`
  }

  normalizeDueDateInput(
    dueDate: Readonly<{ date: string; time?: string }> | undefined,
    timezone: string,
  ): string | undefined {
    if (dueDate === undefined) return undefined
    return localDatetimeToUtc(dueDate.date, dueDate.time, timezone)
  }

  formatDueDateOutput(dueDate: string | null | undefined, timezone: string): string | null | undefined {
    return utcToLocal(dueDate, timezone)
  }

  normalizeListTaskParams(params: Readonly<ListTasksParams>): ListTasksParams {
    return { ...params }
  }
}

/** Re-export KaneoConfig so the registry imports from the provider layer. */
export type { KaneoConfig }
export { isKaneoSessionCookie } from './client.js'
