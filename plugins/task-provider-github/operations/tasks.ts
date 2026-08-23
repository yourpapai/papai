// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ListTasksParams, Task, TaskListItem, TaskSearchResult } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { classifyGitHubError } from '../classify-error.js'
import type { GitHubConfig } from '../client.js'
import { GitHubApiError, githubFetch, githubPaginate } from '../client.js'
import { mapIssueToListItem, mapIssueToSearchResult, mapIssueToTask } from '../mappers.js'
import type { GitHubIssue } from '../schemas/issue.js'
import { GitHubIssueSchema } from '../schemas/issue.js'

const log = logger.child({ scope: 'provider:github:tasks' })

const issuePageSchema = z.array(GitHubIssueSchema)
const searchPageSchema = z.object({ items: z.array(GitHubIssueSchema) })

/**
 * Normalized status onto the issue-state patch: closing sends the completed
 * close reason (canonical `closed (not_planned)` sends not_planned), reopening
 * sends only the state. Other status text is ignored.
 */
const statusPatch = (status: string): Record<string, string> | null => {
  if (status === 'open') return { state: 'open' }
  if (status === 'closed') return { state: 'closed', state_reason: 'completed' }
  if (status === 'closed (not_planned)') return { state: 'closed', state_reason: 'not_planned' }
  return null
}

/** List status filter → issue state param; absent filter uses GitHub's default. */
const stateOfStatus = (status: string | undefined): string | undefined => {
  if (status === undefined) return undefined
  if (status === 'open') return 'open'
  if (status.startsWith('closed')) return 'closed'
  return undefined
}

export interface GitHubCreateTaskParams {
  projectId: string
  title: string
  description?: string
  priority?: string
  status?: string
  startDate?: string
  dueDate?: string
  assignee?: string
}

export interface GitHubUpdateTaskParams {
  title?: string
  description?: string
  status?: string
  priority?: string
  startDate?: string
  dueDate?: string
  projectId?: string
  assignee?: string
}

export async function githubCreateTask(config: GitHubConfig, params: GitHubCreateTaskParams): Promise<Task> {
  log.debug({ repo: config.repo, title: params.title, hasAssignee: params.assignee !== undefined }, 'createTask')
  const body: Record<string, unknown> = { title: params.title }
  if (params.description !== undefined) body['body'] = params.description
  if (params.assignee !== undefined) body['assignees'] = [params.assignee]
  try {
    const raw = await githubFetch(config, 'POST', `/repos/${config.repo}/issues`, { body })
    const issue: GitHubIssue = GitHubIssueSchema.parse(raw)
    log.info({ taskId: String(issue.number) }, 'Task created')
    return mapIssueToTask(issue, config.repo)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create task')
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}

export async function githubGetTask(config: GitHubConfig, taskId: string): Promise<Task> {
  log.debug({ taskId }, 'getTask')
  try {
    const raw = await githubFetch(config, 'GET', `/repos/${config.repo}/issues/${taskId}`)
    const issue: GitHubIssue = GitHubIssueSchema.parse(raw)
    log.info({ taskId }, 'Task retrieved')
    return mapIssueToTask(issue, config.repo)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get task')
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubUpdateTask(
  config: GitHubConfig,
  taskId: string,
  params: GitHubUpdateTaskParams,
): Promise<Task> {
  log.debug({ taskId, hasTitle: params.title !== undefined, hasStatus: params.status !== undefined }, 'updateTask')
  const body: Record<string, unknown> = {}
  if (params.title !== undefined) body['title'] = params.title
  if (params.description !== undefined) body['body'] = params.description
  if (params.assignee !== undefined) body['assignees'] = [params.assignee]
  const statePatch = params.status === undefined ? null : statusPatch(params.status)
  if (statePatch !== null) {
    body['state'] = statePatch['state']
    if (statePatch['state_reason'] !== undefined) body['state_reason'] = statePatch['state_reason']
  }
  try {
    const raw = await githubFetch(config, 'PATCH', `/repos/${config.repo}/issues/${taskId}`, { body })
    const issue: GitHubIssue = GitHubIssueSchema.parse(raw)
    log.info({ taskId: String(issue.number) }, 'Task updated')
    return mapIssueToTask(issue, config.repo)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to update task')
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubListTasks(
  config: GitHubConfig,
  _projectId: string,
  params?: ListTasksParams,
): Promise<TaskListItem[]> {
  log.debug({ repo: config.repo, hasStatusFilter: params?.status !== undefined }, 'listTasks')
  const state = stateOfStatus(params?.status)
  try {
    const issues = await githubPaginate(config, `/repos/${config.repo}/issues`, {
      query: state === undefined ? {} : { state },
      extractPage: (data: unknown): GitHubIssue[] => issuePageSchema.parse(data),
    })
    // The list endpoint has no is:issue filter; PR-marked items are dropped here.
    const tasks = issues.filter((issue) => issue.pull_request === undefined).map(mapIssueToListItem)
    log.info({ count: tasks.length }, 'Tasks listed')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list tasks')
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}

export interface GitHubSearchTasksParams {
  query: string
  projectId?: string
  assigneeId?: string
  limit?: number
  offset?: number
}

/** GitHub's search API serves only the first 1000 results of any query. */
const GITHUB_SEARCH_MAX_RESULTS = 1000

const errorBodyMessage = (body: unknown): string => {
  if (typeof body === 'string') return body
  if (typeof body === 'object' && body !== null) {
    const message: unknown = (body as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

/** Matches the 422 GitHub answers once a search page would reach past the first 1000 results. */
const isSearchResultsExhausted = (error: unknown): boolean =>
  error instanceof GitHubApiError &&
  error.statusCode === 422 &&
  errorBodyMessage(error.body).includes('first 1000 search results')

export async function githubSearchTasks(
  config: GitHubConfig,
  params: GitHubSearchTasksParams,
): Promise<TaskSearchResult[]> {
  log.debug({ repo: config.repo, query: params.query, limit: params.limit, offset: params.offset }, 'searchTasks')
  const offset = params.offset ?? 0
  const limit = params.limit ?? Number.MAX_SAFE_INTEGER
  // Fetch only the pages covering [offset, offset + limit), never past GitHub's
  // 1000-result search ceiling: pages reaching beyond it fail the whole request.
  const needed = Math.min(offset + limit, GITHUB_SEARCH_MAX_RESULTS)
  if (needed <= offset) {
    log.info({ count: 0 }, 'Tasks searched')
    return []
  }
  try {
    const issues = await githubPaginate(config, '/search/issues', {
      query: { q: `repo:${config.repo} is:issue ${params.query}` },
      extractPage: (data: unknown): GitHubIssue[] => searchPageSchema.parse(data).items,
      maxItems: needed,
      isEndOfResults: isSearchResultsExhausted,
    })
    const results = issues.slice(offset, offset + limit).map((issue) => mapIssueToSearchResult(issue, config.repo))
    log.info({ count: results.length }, 'Tasks searched')
    return results
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to search tasks')
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}
