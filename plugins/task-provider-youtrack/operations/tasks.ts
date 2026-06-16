// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ListTasksParams, Task, TaskListItem, TaskSearchResult } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ISSUE_FIELDS, ISSUE_LIST_FIELDS, YOUTRACK_INLINE_LIST_CUSTOM_FIELDS } from '../constants.js'
import { mapIssueToListItem, mapIssueToSearchResult, mapIssueToTask } from '../mappers.js'
import { IssueListSchema, IssueSchema } from '../schemas/issue.js'
import {
  buildCreateCustomFields,
  buildCustomFields,
  buildYouTrackQuery,
  buildWriteSafeCustomFields,
  enrichTaskWithDueDate,
  validateRequiredCreateFields,
} from '../task-helpers.js'
import { fetchTasksWithPagination } from './task-list-fetch.js'

const log = logger.child({ scope: 'provider:youtrack:tasks' })

type CreateTaskParams = {
  projectId: string
  title: string
  description?: string
  priority?: string
  status?: string
  dueDate?: string
  assignee?: string
  customFields?: Array<{ name: string; value: string }>
}

const fallbackDueDate = (dueDate: string | undefined): string | undefined =>
  dueDate === undefined ? undefined : dueDate.slice(0, 10)

const buildCreateIssueBody = async (
  config: Readonly<YouTrackConfig>,
  project: Readonly<{ id: string }>,
  params: Readonly<CreateTaskParams>,
  projectCustomFields: Awaited<ReturnType<typeof validateRequiredCreateFields>>,
): Promise<Record<string, unknown>> => {
  const body: Record<string, unknown> = { project: { id: project.id }, summary: params.title }
  if (params.description !== undefined) body['description'] = params.description
  const customFields = await buildCreateCustomFields(config, params, projectCustomFields)
  if (customFields.length > 0) body['customFields'] = customFields
  log.debug(
    {
      projectId: project.id,
      projectFieldCount: projectCustomFields.length,
      sentCustomFields: customFields.map((f) => ({ name: f.name, $type: f.$type })),
    },
    'Submitting createTask POST /api/issues',
  )
  return body
}

const fetchIssueProjectId = async (config: Readonly<YouTrackConfig>, taskId: string): Promise<string> => {
  const issueRaw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'project(id)' },
  })
  const issueProject = z.object({ project: z.object({ id: z.string() }) }).parse(issueRaw)
  return issueProject.project.id
}

const buildUpdateCustomFields = async (
  config: Readonly<YouTrackConfig>,
  taskId: string,
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    projectId?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
): Promise<
  Array<ReturnType<typeof buildCustomFields>[number] | Awaited<ReturnType<typeof buildWriteSafeCustomFields>>[number]>
> => {
  const projectId = params.projectId ?? (await fetchIssueProjectId(config, taskId))
  const projectCustomFields = await buildWriteSafeCustomFields(config, projectId, params.customFields)
  return [...buildCustomFields(params), ...projectCustomFields]
}

export async function createYouTrackTask(config: YouTrackConfig, params: CreateTaskParams): Promise<Task> {
  log.debug(
    {
      projectId: params.projectId,
      title: params.title,
      hasCustomFields: params.customFields !== undefined && params.customFields.length > 0,
    },
    'createTask',
  )
  try {
    const projectRaw = await youtrackFetch(config, 'GET', `/api/admin/projects/${params.projectId}`, {
      query: { fields: 'id,shortName' },
    })
    const project = z.object({ id: z.string(), shortName: z.string() }).parse(projectRaw)
    const projectCustomFields = await validateRequiredCreateFields(config, project.id, project.shortName, params)
    const body = await buildCreateIssueBody(config, project, params, projectCustomFields)

    const raw = await youtrackFetch(config, 'POST', '/api/issues', {
      body,
      query: { fields: ISSUE_FIELDS },
    })
    const issue = IssueSchema.parse(raw)
    log.info({ issueId: issue.idReadable ?? issue.id }, 'Issue created')
    const task = await enrichTaskWithDueDate(config, mapIssueToTask(issue, config.baseUrl))
    return task.dueDate === null && params.dueDate !== undefined
      ? { ...task, dueDate: fallbackDueDate(params.dueDate) ?? null }
      : task
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        projectId: params.projectId,
      },
      'Failed to create task',
    )
    throw classifyYouTrackError(error, { projectId: params.projectId })
  }
}

export async function getYouTrackTask(config: YouTrackConfig, taskId: string): Promise<Task> {
  log.debug({ taskId }, 'getTask')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
      query: { fields: ISSUE_FIELDS },
    })
    const issue = IssueSchema.parse(raw)
    return await enrichTaskWithDueDate(config, mapIssueToTask(issue, config.baseUrl))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get task')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function updateYouTrackTask(
  config: YouTrackConfig,
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
  log.debug({ taskId, hasTitle: params.title !== undefined, hasStatus: params.status !== undefined }, 'updateTask')
  try {
    const body: Record<string, unknown> = {}
    if (params.title !== undefined) body['summary'] = params.title
    if (params.description !== undefined) body['description'] = params.description
    if (params.projectId !== undefined) body['project'] = { id: params.projectId }

    if (params.customFields !== undefined && params.customFields.length > 0) {
      const customFields = await buildUpdateCustomFields(config, taskId, params)
      if (customFields.length > 0) body['customFields'] = customFields
    } else {
      const customFields = buildCustomFields(params)
      if (customFields.length > 0) body['customFields'] = customFields
    }

    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}`, {
      body,
      query: { fields: ISSUE_FIELDS },
    })
    const issue = IssueSchema.parse(raw)
    log.info({ issueId: issue.idReadable ?? issue.id }, 'Issue updated')
    const task = await enrichTaskWithDueDate(config, mapIssueToTask(issue, config.baseUrl))
    return task.dueDate === null && params.dueDate !== undefined
      ? { ...task, dueDate: fallbackDueDate(params.dueDate) ?? null }
      : task
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to update task')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function listYouTrackTasks(
  config: YouTrackConfig,
  projectId: string,
  params?: ListTasksParams,
): Promise<TaskListItem[]> {
  log.debug({ projectId, params }, 'listTasks')
  try {
    const projectRaw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}`, {
      query: { fields: 'shortName' },
    })
    const project = z.object({ shortName: z.string() }).parse(projectRaw)

    const query = buildYouTrackQuery(params, project.shortName)
    const issues = await fetchTasksWithPagination(config, query, params)

    log.info({ projectId, count: issues.length, filters: params }, 'Tasks listed')
    return issues.map((issue) => mapIssueToListItem(issue, config.baseUrl))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to list tasks')
    throw classifyYouTrackError(error, { projectId })
  }
}

async function buildYouTrackSearchQuery(
  config: YouTrackConfig,
  params: { query: string; projectId?: string; assigneeId?: string },
): Promise<string> {
  let query = params.query
  if (params.projectId !== undefined) {
    // Fetch project to get shortName - YouTrack search queries require shortName, not internal ID
    const projectRaw = await youtrackFetch(config, 'GET', `/api/admin/projects/${params.projectId}`, {
      query: { fields: 'shortName' },
    })
    const project = z.object({ shortName: z.string() }).parse(projectRaw)
    query = `project: {${project.shortName}} ${query}`
  }
  // Add assignee filter to YouTrack query syntax
  if (params.assigneeId !== undefined) {
    query = `assignee: {${params.assigneeId}} ${query}`
  }
  return query
}

export async function searchYouTrackTasks(
  config: YouTrackConfig,
  params: {
    query: string
    projectId?: string
    assigneeId?: string
    limit?: number
    offset?: number
  },
): Promise<TaskSearchResult[]> {
  log.debug(
    {
      query: params.query,
      projectId: params.projectId,
      assigneeId: params.assigneeId,
      offset: params.offset,
    },
    'searchTasks',
  )
  try {
    const query = await buildYouTrackSearchQuery(config, params)
    const raw = await youtrackFetch(config, 'GET', '/api/issues', {
      query: {
        fields: ISSUE_LIST_FIELDS,
        query,
        $top: String(params.limit ?? 50),
        ...(params.offset === undefined ? {} : { $skip: String(params.offset) }),
        customFields: YOUTRACK_INLINE_LIST_CUSTOM_FIELDS,
      },
    })
    const issues = IssueListSchema.array().parse(raw)
    log.info({ query: params.query, assigneeId: params.assigneeId, count: issues.length }, 'Tasks searched')
    return issues.map((issue) => mapIssueToSearchResult(issue, config.baseUrl))
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        query: params.query,
        projectId: params.projectId,
        assigneeId: params.assigneeId,
      },
      'Failed to search tasks',
    )
    const context = params.projectId === undefined ? undefined : { projectId: params.projectId }
    throw classifyYouTrackError(error, context)
  }
}

export async function deleteYouTrackTask(config: YouTrackConfig, taskId: string): Promise<{ id: string }> {
  log.debug({ taskId }, 'deleteTask')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}`)
    log.info({ taskId }, 'Issue deleted')
    return { id: taskId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to delete task')
    throw classifyYouTrackError(error, { taskId })
  }
}
