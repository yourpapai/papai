// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AppError } from 'papai/plugin-types'
import type { ListTasksParams, Project, Task, TaskListItem, TaskProvider, TaskSearchResult } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'

import { logger } from '../../src/logger.js'
import { classifyGitHubError, GitHubClassifiedError } from './classify-error.js'
import type { GitHubConfig } from './client.js'
import { GITHUB_CAPABILITIES, GITHUB_TRAITS } from './constants.js'
import { normalizeGitHubDueDateInput, normalizeGitHubListTaskParams } from './due-date.js'
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

  constructor(private readonly config: GitHubConfig) {
    log.debug({ repo: config.repo }, 'GitHubProvider created')
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

  getProject(projectId: string): Promise<Project> {
    return githubGetProject(this.config, projectId)
  }

  listProjects(): Promise<Project[]> {
    return githubListProjects(this.config)
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
