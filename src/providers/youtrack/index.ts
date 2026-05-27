// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type {
  Attachment,
  Column,
  Comment,
  CreateWorkItemParams,
  Label,
  ListTasksParams,
  Project,
  RelationType,
  Task,
  TaskCommandResult,
  TaskListItem,
  TaskProvider,
  TaskSearchResult,
  UpdateWorkItemParams,
  WorkItem,
} from '../types.js'
import type { YouTrackConfig } from './client.js'
import { CONFIG_REQUIREMENTS, YOUTRACK_CAPABILITIES } from './constants.js'
import { normalizeYouTrackDueDateInput, normalizeYouTrackListTaskParams } from './due-date.js'
import { createYouTrackIdentityResolver } from './identity-resolver.js'
import {
  addYouTrackTaskLabel,
  createYouTrackLabel,
  findYouTrackLabelsByName,
  listYouTrackLabels,
  removeYouTrackLabel,
  removeYouTrackTaskLabel,
  updateYouTrackLabel,
} from './labels.js'
import {
  deleteYouTrackAttachment,
  listYouTrackAttachments,
  uploadYouTrackAttachment,
} from './operations/attachments.js'
import { applyYouTrackCommand } from './operations/commands.js'
import {
  addYouTrackComment,
  getYouTrackComment,
  getYouTrackComments,
  removeYouTrackComment,
  updateYouTrackComment,
} from './operations/comments.js'
import {
  createYouTrackProject,
  deleteYouTrackProject,
  getYouTrackProject,
  listYouTrackProjects,
  updateYouTrackProject,
} from './operations/projects.js'
import {
  createYouTrackStatus,
  deleteYouTrackStatus,
  listYouTrackStatuses,
  reorderYouTrackStatuses,
  updateYouTrackStatus,
} from './operations/statuses.js'
import {
  createYouTrackTask,
  deleteYouTrackTask,
  getYouTrackTask,
  listYouTrackTasks,
  searchYouTrackTasks,
  updateYouTrackTask,
} from './operations/tasks.js'
import {
  createYouTrackWorkItem,
  deleteYouTrackWorkItem,
  listYouTrackWorkItems,
  updateYouTrackWorkItem,
} from './operations/work-items.js'
import { YouTrackPhaseFiveProvider } from './phase-five-provider.js'
import { addYouTrackRelation, removeYouTrackRelation, updateYouTrackRelation } from './relations.js'

const log = logger.child({ scope: 'provider:youtrack' })

export class YouTrackProvider extends YouTrackPhaseFiveProvider implements TaskProvider {
  readonly name = 'youtrack'
  readonly supportsCustomFields = true
  readonly capabilities = YOUTRACK_CAPABILITIES
  readonly traits = new Set(['supports-command-language', 'command-language:youtrack', 'custom-fields'] as const)
  readonly configRequirements = CONFIG_REQUIREMENTS
  readonly preferredUserIdentifier = 'login' as const
  readonly identityResolver

  constructor(config: YouTrackConfig) {
    super(config)
    log.debug('YouTrackProvider created')
    this.identityResolver = createYouTrackIdentityResolver(this.config)
  }

  createTask(params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }): Promise<Task> {
    return createYouTrackTask(this.config, params)
  }
  getTask(taskId: string): Promise<Task> {
    return getYouTrackTask(this.config, taskId)
  }
  updateTask(
    taskId: string,
    params: {
      title?: string
      description?: string
      status?: string
      priority?: string
      dueDate?: string
      projectId?: string
      assignee?: string
      customFields?: Array<{ name: string; value: string }>
    },
  ): Promise<Task> {
    return updateYouTrackTask(this.config, taskId, params)
  }
  listTasks(projectId: string, params?: ListTasksParams): Promise<TaskListItem[]> {
    return listYouTrackTasks(this.config, projectId, params)
  }
  searchTasks(params: {
    query: string
    projectId?: string
    assigneeId?: string
    limit?: number
    offset?: number
  }): Promise<TaskSearchResult[]> {
    return searchYouTrackTasks(this.config, params)
  }
  deleteTask(taskId: string): Promise<{ id: string }> {
    return deleteYouTrackTask(this.config, taskId)
  }
  getProject(projectId: string): Promise<Project> {
    return getYouTrackProject(this.config, projectId)
  }
  listProjects(): Promise<Project[]> {
    return listYouTrackProjects(this.config)
  }
  createProject(params: { name: string; description?: string }): Promise<Project> {
    return createYouTrackProject(this.config, params)
  }
  updateProject(projectId: string, params: { name?: string; description?: string }): Promise<Project> {
    return updateYouTrackProject(this.config, projectId, params)
  }
  deleteProject(projectId: string): Promise<{ id: string }> {
    return deleteYouTrackProject(this.config, projectId)
  }
  addComment(taskId: string, body: string): Promise<Comment> {
    return addYouTrackComment(this.config, taskId, body)
  }
  getComments(taskId: string, params?: { limit?: number; offset?: number }): Promise<Comment[]> {
    return getYouTrackComments(this.config, taskId, params)
  }
  getComment(taskId: string, commentId: string): Promise<Comment> {
    return getYouTrackComment(this.config, taskId, commentId)
  }
  updateComment(params: { taskId: string; commentId: string; body: string }): Promise<Comment> {
    return updateYouTrackComment(this.config, params)
  }
  removeComment(params: { taskId: string; commentId: string }): Promise<{ id: string }> {
    return removeYouTrackComment(this.config, params)
  }
  listLabels(): Promise<Label[]> {
    return listYouTrackLabels(this.config)
  }
  getLabelByName(labelName: string): Promise<Label[]> {
    return findYouTrackLabelsByName(this.config, labelName)
  }
  createLabel(params: { name: string; color?: string }): Promise<Label> {
    return createYouTrackLabel(this.config, params)
  }
  updateLabel(labelId: string, params: { name?: string; color?: string }): Promise<Label> {
    return updateYouTrackLabel(this.config, labelId, params)
  }
  removeLabel(labelId: string): Promise<{ id: string }> {
    return removeYouTrackLabel(this.config, labelId)
  }
  addTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return addYouTrackTaskLabel(this.config, taskId, labelId)
  }
  removeTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return removeYouTrackTaskLabel(this.config, taskId, labelId)
  }
  addRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return addYouTrackRelation(this.config, taskId, relatedTaskId, type)
  }
  removeRelation(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }> {
    return removeYouTrackRelation(this.config, taskId, relatedTaskId)
  }
  updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return updateYouTrackRelation(this.config, taskId, relatedTaskId, type)
  }
  listStatuses(projectId: string): Promise<Column[]> {
    return listYouTrackStatuses(this.config, projectId)
  }
  createStatus(
    projectId: string,
    params: { name: string; icon?: string; color?: string; isFinal?: boolean },
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }> {
    return createYouTrackStatus(this.config, projectId, { name: params.name, isFinal: params.isFinal }, confirm)
  }
  updateStatus(
    projectId: string,
    statusId: string,
    params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }> {
    return updateYouTrackStatus(
      this.config,
      projectId,
      statusId,
      { name: params.name, isFinal: params.isFinal },
      confirm,
    )
  }
  deleteStatus(
    projectId: string,
    statusId: string,
    confirm?: boolean,
  ): Promise<{ id: string } | { status: 'confirmation_required'; message: string }> {
    return deleteYouTrackStatus(this.config, projectId, statusId, confirm)
  }
  reorderStatuses(
    projectId: string,
    statuses: { id: string; position: number }[],
    confirm?: boolean,
  ): Promise<undefined | { status: 'confirmation_required'; message: string }> {
    return reorderYouTrackStatuses(this.config, projectId, statuses, confirm)
  }
  listAttachments(taskId: string): Promise<Attachment[]> {
    return listYouTrackAttachments(this.config, taskId)
  }
  uploadAttachment(
    taskId: string,
    file: { name: string; content: Uint8Array | Blob; mimeType?: string },
  ): Promise<Attachment> {
    return uploadYouTrackAttachment(this.config, taskId, file)
  }
  deleteAttachment(taskId: string, attachmentId: string): Promise<{ id: string }> {
    return deleteYouTrackAttachment(this.config, taskId, attachmentId)
  }
  listWorkItems(taskId: string, params?: { limit?: number; offset?: number }): Promise<WorkItem[]> {
    return listYouTrackWorkItems(this.config, taskId, params)
  }
  createWorkItem(taskId: string, params: CreateWorkItemParams): Promise<WorkItem> {
    return createYouTrackWorkItem(this.config, taskId, params)
  }
  updateWorkItem(taskId: string, workItemId: string, params: UpdateWorkItemParams): Promise<WorkItem> {
    return updateYouTrackWorkItem(this.config, taskId, workItemId, params)
  }
  deleteWorkItem(taskId: string, workItemId: string): Promise<{ id: string }> {
    return deleteYouTrackWorkItem(this.config, taskId, workItemId)
  }

  applyCommand(params: {
    query: string
    taskIds: string[]
    comment?: string
    silent?: boolean
  }): Promise<TaskCommandResult> {
    return applyYouTrackCommand(this.config, params)
  }
  normalizeDueDateInput(
    dueDate: Readonly<{ date: string; time?: string }> | undefined,
    _timezone: string,
  ): string | undefined {
    return normalizeYouTrackDueDateInput(dueDate)
  }
  formatDueDateOutput(dueDate: string | null | undefined, _timezone: string): string | null | undefined {
    return dueDate
  }
  normalizeListTaskParams(params: Readonly<ListTasksParams>): ListTasksParams {
    return normalizeYouTrackListTaskParams(params)
  }
}
