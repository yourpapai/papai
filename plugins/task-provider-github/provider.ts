// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AppError } from 'papai/plugin-types'
import type {
  Activity,
  Comment,
  Label,
  ListTasksParams,
  Project,
  Task,
  TaskListItem,
  TaskProvider,
  TaskSearchResult,
  TaskLabel,
} from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'

import { logger } from '../../src/logger.js'
import { classifyGitHubError, GitHubClassifiedError } from './classify-error.js'
import type { GitHubConfig } from './client.js'
import { GITHUB_CAPABILITIES, GITHUB_TRAITS } from './constants.js'
import { normalizeGitHubDueDateInput, normalizeGitHubListTaskParams } from './due-date.js'
import { createGitHubIdentityResolver } from './identity-resolver.js'
import { githubListTaskEvents } from './operations/activities.js'
import {
  githubCreateTaskComment,
  githubDeleteTaskComment,
  githubListTaskComments,
  githubUpdateTaskComment,
} from './operations/comments.js'
import { githubCountTasks } from './operations/count.js'
import {
  githubAddTaskLabels,
  githubCreateLabel,
  githubDeleteLabel,
  githubGetTaskLabels,
  githubListLabels,
  githubRemoveTaskLabel,
  githubUpdateLabel,
  resolveLabelName,
} from './operations/labels.js'
import { githubGetProject, githubListProjects } from './operations/projects.js'
import {
  githubCreateTask,
  githubGetTask,
  githubListTasks,
  githubSearchTasks,
  githubUpdateTask,
} from './operations/tasks.js'
import { GITHUB_PROMPT_ADDENDUM } from './prompt-addendum.js'
import { buildGitHubProjectUrl, buildGitHubTaskUrl } from './url-builder.js'

const log = logger.child({ scope: 'provider:github' })

/** GitHubProvider wraps the GitHub operation functions to implement TaskProvider. */
export class GitHubProvider implements TaskProvider {
  readonly name = 'github'
  readonly capabilities = GITHUB_CAPABILITIES
  readonly traits = GITHUB_TRAITS
  readonly preferredUserIdentifier = 'login' as const
  readonly identityResolver

  constructor(private readonly config: GitHubConfig) {
    log.debug({ repo: config.repo }, 'GitHubProvider created')
    this.identityResolver = createGitHubIdentityResolver(this.config)
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
    // One instance = one repository: task creation only targets the configured repo.
    if (params.projectId !== this.config.repo) {
      log.warn({ projectId: params.projectId }, 'createTask projectId does not match the configured repository')
      return Promise.reject(
        new GitHubClassifiedError(
          `Project ${params.projectId} is not the configured repository`,
          providerError.projectNotFound(params.projectId),
        ),
      )
    }
    return githubCreateTask(this.config, params)
  }

  getTask(taskId: string): Promise<Task> {
    return githubGetTask(this.config, taskId)
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
      customFields?: Array<{ name: string; value: string }>
    },
  ): Promise<Task> {
    // Closing/reopening is a status update — there is no separate close path.
    return githubUpdateTask(this.config, taskId, params)
  }

  listTasks(projectId: string, params?: ListTasksParams): Promise<TaskListItem[]> {
    return githubListTasks(this.config, projectId, params)
  }

  searchTasks(params: {
    query: string
    projectId?: string
    assigneeId?: string
    limit?: number
    offset?: number
  }): Promise<TaskSearchResult[]> {
    return githubSearchTasks(this.config, params)
  }

  getTaskHistory(
    taskId: string,
    params?: {
      categories?: string[]
      limit?: number
      offset?: number
      reverse?: boolean
      start?: string
      end?: string
      author?: string
    },
  ): Promise<Activity[]> {
    return githubListTaskEvents(this.config, taskId, params)
  }

  countTasks(params: { query: string; projectId?: string }): Promise<number> {
    return githubCountTasks(this.config, params)
  }

  getProject(projectId: string): Promise<Project> {
    return githubGetProject(this.config, projectId)
  }

  listProjects(): Promise<Project[]> {
    return githubListProjects(this.config)
  }

  getComments(taskId: string, params?: { limit?: number; offset?: number }): Promise<Comment[]> {
    return githubListTaskComments(this.config, taskId, params)
  }

  addComment(taskId: string, body: string): Promise<Comment> {
    return githubCreateTaskComment(this.config, taskId, body)
  }

  updateComment(params: { taskId: string; commentId: string; body: string }): Promise<Comment> {
    return githubUpdateTaskComment(this.config, params.taskId, params.commentId, params.body)
  }

  removeComment(params: { taskId: string; commentId: string }): Promise<{ id: string }> {
    return githubDeleteTaskComment(this.config, params.taskId, params.commentId)
  }

  listLabels(): Promise<Label[]> {
    return githubListLabels(this.config)
  }

  listTaskLabels(taskId: string): Promise<TaskLabel[]> {
    return githubGetTaskLabels(this.config, taskId)
  }

  async getLabelByName(labelName: string): Promise<Label[]> {
    const labels = await githubListLabels(this.config)
    return labels.filter((label) => label.name === labelName)
  }

  createLabel(params: { name: string; color?: string }): Promise<Label> {
    return githubCreateLabel(this.config, params)
  }

  async updateLabel(labelId: string, params: { name?: string; color?: string }): Promise<Label> {
    const name = await resolveLabelName(this.config, labelId)
    return githubUpdateLabel(this.config, name, params)
  }

  async removeLabel(labelId: string): Promise<{ id: string }> {
    const name = await resolveLabelName(this.config, labelId)
    return githubDeleteLabel(this.config, name)
  }

  async addTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    const name = await resolveLabelName(this.config, labelId)
    await githubAddTaskLabels(this.config, taskId, [name])
    return { taskId, labelId }
  }

  async removeTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    const name = await resolveLabelName(this.config, labelId)
    await githubRemoveTaskLabel(this.config, taskId, name)
    return { taskId, labelId }
  }

  buildTaskUrl(taskId: string, _projectId?: string): string {
    return buildGitHubTaskUrl(this.config.baseUrl, this.config.repo, taskId)
  }

  buildProjectUrl(_projectId: string): string {
    return buildGitHubProjectUrl(this.config.baseUrl, this.config.repo)
  }

  classifyError(error: unknown): AppError {
    return classifyGitHubError(error).appError
  }

  getPromptAddendum(): string {
    return GITHUB_PROMPT_ADDENDUM
  }

  normalizeDueDateInput(
    dueDate: Readonly<{ date: string; time?: string }> | undefined,
    _timezone: string,
  ): string | undefined {
    return normalizeGitHubDueDateInput(dueDate)
  }

  formatDueDateOutput(dueDate: string | null | undefined, _timezone: string): string | null | undefined {
    return dueDate
  }

  normalizeListTaskParams(params: Readonly<ListTasksParams>): ListTasksParams {
    return normalizeGitHubListTaskParams(params)
  }
}
